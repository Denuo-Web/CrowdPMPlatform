# CrowdPM PM2.5 Microservice (`atm-service`)

This package provides a standalone Fastify server that pulls CAMS (Copernicus Atmosphere Monitoring Service) global atmospheric composition forecasts, extracts PM2.5 grids from NetCDF payloads, and publishes compressed point clouds that the CrowdPM frontend renders as deck.gl heatmaps.

> **Highlights**
>
> - Scheduled downloader that hydrates cached PM2.5 grids for every batch the UI references.
> - On-demand refresh: the first request for a batch triggers a Copernicus download if the dataset is stale or missing.
> - Gzipped JSON storage (`var/pm25/*.json.gz`) keeps response payloads small while allowing offline reuse.
> - Fastify API with CORS + compression enabled by default. Intended to run alongside the Firebase emulator stack.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Environment Configuration](#environment-configuration)
4. [Running the Service](#running-the-service)
5. [Architecture Overview](#architecture-overview)
6. [NetCDF Processing Pipeline](#netcdf-processing-pipeline)
7. [Cache Layout](#cache-layout)
8. [HTTP API](#http-api)
9. [Cron Scheduling & Refresh Policy](#cron-scheduling--refresh-policy)
10. [Logging](#logging)
11. [Development Tips](#development-tips)
12. [Testing & Linting](#testing--linting)
13. [Deployment Considerations](#deployment-considerations)
14. [Troubleshooting](#troubleshooting)

---

## Prerequisites

- **Node.js 24.x** (monorepo engines constraint). Use `nvm` or `fnm` to manage versions.
- **pnpm 10.x** (`corepack enable pnpm` recommended).
- A **Copernicus Atmosphere Data Store (ADS)** account with API key (`uid:secret` format).
- Optional: access to a blob/object store (S3/MinIO/GCS) if you plan to externalise the cache directory.

> ⚠️ Network access is required for downloading CAMS datasets. If you are working offline, you can populate `var/pm25` manually with test fixtures.

---

## Installation

From the monorepo root:

```bash
pnpm install                # installs shared and atm-service dependencies
pnpm --filter crowdpm-atm-service build   # type-checks the service
```

If you only want this workspace’s dependencies:

```bash
pnpm install --filter crowdpm-atm-service
```

---

## Environment Configuration

Copy the example file and fill in secrets:

```bash
cp atm-service/.env.example atm-service/.env.local
```

Environment variables (`.env.local` is loaded automatically):

| Variable | Description | Default |
| --- | --- | --- |
| `CAMS_API_KEY` | ADS API key in `uid:secret` format. | **required** |
| `CAMS_API_URL` | ADS endpoint base URL. | `https://ads.atmosphere.copernicus.eu/api/v2` |
| `CAMS_DATASET_ID` | Dataset to request. | `cams-global-atmospheric-composition-forecasts` |
| `CAMS_PM_VARIABLE` | Variable name inside the NetCDF file. | `pm2p5` |
| `CRON_SCHEDULE` | Cron expression for periodic refresh. | `0 * * * *` (hourly) |
| `CACHE_TTL_MINUTES` | Minutes before cached datasets are considered stale. | `90` |
| `API_TIMEOUT_MS` | Max wait time for job completion + download. | `600000` (10 minutes) |
| `MAX_PARALLEL_JOBS` | Concurrent refresh workers during cron runs. | `2` |
| `PORT` | HTTP port. | `4010` |
| `HOST` | Bind address. | `0.0.0.0` |
| `DATA_DIR` | Cache directory for gzipped payloads + index. | `var/pm25` |
| `LOG_LEVEL` | Pino log level (`info`, `debug`, etc.). | `info` |

These values can also be supplied via process environment when deploying.

---

## Running the Service

### Dev Watch Mode

```bash
pnpm --filter crowdpm-atm-service dev
```

This starts Fastify with `tsx` in watch mode. Logs stream to STDOUT.

### Production Mode

```bash
pnpm --filter crowdpm-atm-service start
```

This runs the compiled TypeScript directly via `tsx`’s ESM loader. For container deployments, set `NODE_ENV=production` so Fastify disables pretty logging.

### Combined Monorepo Dev

The root `pnpm dev` script now runs the Firebase emulator stack, the frontend, and this microservice simultaneously. Make sure `VITE_PM25_API_BASE_URL` in `frontend/.env.local` points to `http://127.0.0.1:4010`.

---

## Architecture Overview

```
┌────────────┐     fetch (cron/on-demand)      ┌──────────┐
│ Batch info │ ───────────────────────────────▶│ CAMS ADS │
│ (Firestore │                               └──────────┘
│  metadata) │                                      │
└────────────┘                                      ▼
                         NetCDF response      ┌──────────────┐
                                              │ netcdfjs     │
                                          ───▶│ parser       │
                                              └──────────────┘
                                                    │
                                                    ▼
                  ┌────────────────────────────┐   gzip   ┌──────────────┐
                  │ `{lat, lon, value}` points │ ───────▶│ var/pm25/*.gz │
                  └────────────────────────────┘          └──────────────┘
                             ▲                                   │
                             │ serve JSON                        ▼
                         ┌──────────┐                     ┌───────────────┐
                         │ Fastify  │◀────────────────────│ /pm25 endpoint │
                         └──────────┘                     └───────────────┘
```

Key components:

- **`src/index.ts`** – bootstraps Fastify, attaches the PM2.5 routes, schedules refresh jobs, and performs an eager refresh at startup.
- **`src/camsClient.ts`** – wraps the Copernicus API (submit job → poll status → download NetCDF).
- **`src/netcdf.ts`** – uses `netcdfjs` to extract latitude/longitude grids and PM2.5 values, filters missing values, and normalises longitude.
- **`src/storage.ts`** – handles gzipped JSON persistence plus the `index.json` metadata catalogue.
- **`src/processor.ts`** – orchestrates cache lookup, invalidation, downloading, extraction, and writing results.
- **`src/routes/pm25.ts`** – Fastify route module exposing `GET /pm25`.

---

## NetCDF Processing Pipeline

1. **Download:** `camsClient.downloadForecast` creates a CAMS job, polls until completion, and fetches the NetCDF file (respecting `API_TIMEOUT_MS`).
2. **Parse:** `netcdf.ts` instantiates `NetCDFReader` (via CommonJS `require`), detects variable/dimension names, and resolves fill values.
3. **Filter:** The processor walks through the lat/lon grid, removes values outside the requested bounding box, and skips missing-value sentinels.
4. **Normalise:** Longitude values greater than 180° are wrapped into the [-180, 180] range for compatibility with deck.gl.
5. **Serialize:** The filtered points are saved as `{ points: Pm25Point[] }`, gzipped to conserve disk and response size.

---

## Cache Layout

```
atm-service/
├── var/
│   ├── pm25/
│   │   ├── index.json        # metadata catalogue
│   │   ├── <sha1>.json.gz    # compressed point cloud
│   │   └── ...               # one per distinct batch descriptor
│   └── .gitignore
```

- `index.json` contains a map of `batchId -> metadata`, including bounding box, time range, file hash, and last update timestamp.
- Filenames are SHA-1 digests derived from batch descriptors, ensuring deterministic cache keys.
- `StorageManager.safeUnlink` cleans up stale files when descriptors change.

You can bind `DATA_DIR` to another volume (e.g., `/data/pm25`) when running in Docker.

---

## HTTP API

### `GET /pm25`

Retrieves the cached PM2.5 grid for a specific batch, refreshing the cache if required.

**Query Parameters**

| Name | Required | Description |
| --- | --- | --- |
| `batchId` | ✅ | Identifier of the measurement batch (matches Firebase batch ID). |
| `deviceId` | optional | Device ID owning the batch. Improves cache-key uniqueness. |
| `start` | ✅ | ISO-8601 timestamp (inclusive) representing earliest measurement time. |
| `end` | ✅ | ISO-8601 timestamp (inclusive) representing latest measurement time. |
| `bbox` | ✅ | Comma-separated bounding box `south,west,north,east` in degrees. |
| `allowStale` | optional | `1`/`true` to allow returning a stale cache entry (skips refresh). |
| `force` | optional | `1`/`true` to force a fresh download regardless of cache TTL. |

**Response**

```json
{
  "batchId": "batch-123",
  "deviceId": "device-456",
  "bbox": { "south": 42.8, "west": -124.0, "north": 46.1, "east": -121.5 },
  "startTime": "2024-02-20T18:00:00.000Z",
  "endTime": "2024-02-21T00:00:00.000Z",
  "updatedAt": "2024-02-21T01:15:42.123Z",
  "points": [
    { "lat": 45.512, "lon": -122.658, "value": 6.54 },
    { "lat": 45.500, "lon": -122.700, "value": 7.02 }
    // ...
  ]
}
```

**Status Codes**

- `200 OK` – cache hit or refreshed data returned.
- `400 Bad Request` – validation failed (missing params, malformed bbox, non-ISO timestamps).
- `502 Bad Gateway` – Copernicus API error or download failure.
- `504 Gateway Timeout` – job did not complete before `API_TIMEOUT_MS`.

The response includes `Cache-Control: public, max-age=300, stale-while-revalidate=600` to encourage client-side caching.

---

## Cron Scheduling & Refresh Policy

- `CRON_SCHEDULE` uses `node-cron` syntax. Example: `*/30 * * * *` refreshes twice per hour.
- On each tick, the processor:
  1. Reads all cached metadata.
  2. Sorts entries by age (oldest first).
  3. Refreshes any dataset older than `CACHE_TTL_MINUTES`, up to `MAX_PARALLEL_JOBS` concurrent downloads.
- At startup, `processor.refreshAll()` runs once to warm the cache; failures are logged but non-fatal.

You can disable scheduled refresh by clearing the env value (`CRON_SCHEDULE=`) and rely on request-triggered downloads.

---

## Logging

Fastify uses Pino under the hood:

- Default level: `info`. Set `LOG_LEVEL=debug` for richer diagnostics.
- Each refresh includes structured data (batch ID, byte counts, point counts).
- Errors bubble with stack traces.
- In dev, enabling `NODE_ENV=development` keeps logs human-readable via `pino-pretty`.

---

## Development Tips

- **Manual refresh:** send `GET /pm25?force=1` to bypass the cache when testing extraction changes.
- **Bounding boxes:** the frontend computes bounding boxes from measurement trails; for manual testing, use a simple BBox around your area of interest (e.g., `bbox=43,-125,47,-121`).
- **Alternative datasets:** change `CAMS_DATASET_ID` / `CAMS_PM_VARIABLE` to experiment with other pollutants (e.g., `pm10`). Ensure the NetCDF structure matches expectations.
- **Mocking:** Replace `downloadForecast` in `processor.ts` with a fixture loader when offline.

---

## Testing & Linting

Currently the project relies on TypeScript and ESLint checks:

```bash
pnpm --filter crowdpm-atm-service build   # type-check
pnpm --filter crowdpm-atm-service lint    # eslint (ts-aware)
```

Potential future enhancements:

- Add Vitest suites to validate NetCDF parsing against sample files.
- Introduce integration tests that stub the ADS API (`nock`/`msw`) to simulate job lifecycle.

---

## Deployment Considerations

- **Containerisation:** mount `DATA_DIR` to a persistent volume. Provide `.env` values via secret manager or orchestrator.
- **Horizontal scaling:** if you run multiple replicas, consider externalising the cache to shared storage to avoid redundant downloads.
- **Rate limiting:** ADS imposes per-user quotas. Keep `MAX_PARALLEL_JOBS` conservative and avoid aggressive cron schedules.
- **Security:** the API currently has no authentication. Place it behind an internal network or reverse proxy if public exposure isn’t desired.
- **Monitoring:** ship logs to your preferred aggregator and alert on 5xx spikes or repeated ADS failures.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
| --- | --- | --- |
| `Failed to resolve CAMS API URL` | Missing or malformed `CAMS_API_URL`. | Double-check `.env`. |
| `Copernicus job ... failed` | ADS quota exceeded or invalid request parameters. | Verify API key, reduce request frequency, confirm dataset availability. |
| `NetCDF: variable pm2p5 not found` | Dataset variable name differs. | Update `CAMS_PM_VARIABLE` to the correct field (e.g., `pm2p5_rv`). |
| `PM2.5 response malformed` | Cache file corrupted or truncated. | Delete `var/pm25/index.json` and retry; service will rebuild cache. |
| `EADDRINUSE: address already in use` | Port 4010 occupied. | Set `PORT` to another free port in `.env.local`. |

---

## Reference Commands

```bash
# Warm cache for a specific batch (replace ids / bbox / timestamps)
curl "http://localhost:4010/pm25?batchId=batch-123&deviceId=device-456&start=2024-02-21T01:00:00Z&end=2024-02-21T02:00:00Z&bbox=43.0,-125.0,47.0,-121.0&force=1"

# Inspect cached files
ls -lh atm-service/var/pm25
gzip -dc atm-service/var/pm25/<hash>.json.gz | jq '.points | length'
```

---

## Contributing

When updating this service:

1. Run `pnpm lint` to catch TypeScript/ESLint issues.
2. Document new environment variables and endpoints here.
3. Ensure the frontend’s `VITE_PM25_API_BASE_URL` remains accurate.
4. Add fixtures/sample NetCDF files to a developer-only bucket; do **not** commit production data.

Happy hacking! Let the CAMS data light up your maps. 🚀
