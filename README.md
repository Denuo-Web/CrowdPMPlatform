[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Denuo-Web/CrowdPMPlatform)

[![Deploy Demo Firebase](https://github.com/Denuo-Web/CrowdPMPlatform/actions/workflows/demo-deploy.yml/badge.svg?branch=main)](https://github.com/Denuo-Web/CrowdPMPlatform/actions/workflows/demo-deploy.yml)
# CrowdPM Platform
Crowd-sourced PM2.5 air quality monitoring stack combining Firebase microservices with a WebGL Google Maps client.
## Highlights
- DPoP-bound ingest gateway validates short-lived device tokens, persists raw payloads in Cloud Storage, and publishes batch metadata to Google Cloud Pub/Sub for asynchronous processing.
- Pub/Sub-driven worker normalises and calibrates measurements before writing device hourly buckets in Firestore for fast queries.
- Fastify-based HTTPS API (`crowdpmApi`) exposes device, measurement, and admin endpoints consumed by the frontend and integration partners.
- React + Vite client renders Google Maps WebGL overlays via deck.gl to visualise particulate data and provides a basic admin table for device management.
- pnpm-managed TypeScript monorepo keeps frontend and backend code in sync, with shared tooling for linting, builds, and testing.

## System Architecture
- **Ingest** (`functions/src/services/ingestGateway.ts`): Firebase HTTPS Function that validates DPoP proofs plus device access tokens, persists raw JSON to `ingest/{deviceId}/{batchId}.json` in Cloud Storage, and publishes `{deviceId, batchId, path}` to the `ingest.raw` Pub/Sub topic.
- **Processing** (`functions/src/services/ingestWorker.ts`): Firebase Pub/Sub Function downloads batches, applies calibration data from `devices/{deviceId}` (if present), and writes measurements to `devices/{deviceId}/measures/{hourBucket}/rows/{doc}` with deterministic sorting.
- **Pairing API** (`functions/src/routes/pairing.ts` + `functions/src/routes/activation.ts`): Implements the device authorization grant (device start/token/register/access-token) using Ed25519 keys, DPoP, and the `/activate` UI for human approval with MFA enforcement.
- **API** (`functions/src/index.ts`): Fastify server packaged as an HTTPS Function with CORS + rate limiting, mounting `/health`, `/v1/devices`, `/v1/measurements`, pairing endpoints, and `/v1/device-activation`. OpenAPI scaffold lives in `functions/src/openapi.yaml`.
- **Frontend** (`frontend/`): React 19.2 app built with Vite that toggles between a Google Maps 3D visualisation (`MapPage`) and a user dashboard (`UserDashboard`). Uses the Maps JavaScript API with a deck.gl overlay for rendering.

## Tech Stack
- [Firebase Cloud Functions](https://firebase.google.com/docs/functions) with [Fastify](https://fastify.dev/)
- [Google Cloud Pub/Sub](https://cloud.google.com/pubsub/docs) and [Cloud Storage](https://cloud.google.com/storage/docs) backends
- [Cloud Firestore](https://firebase.google.com/docs/firestore) for device + measurement persistence
- [React 19.2](https://react.dev/), [Vite 5](https://vitejs.dev/), [deck.gl](https://deck.gl), and [Google Maps Platform](https://developers.google.com/maps/documentation) on the client
- [pnpm 10](https://pnpm.io/), [TypeScript 5](https://www.typescriptlang.org/), [ESLint 9](https://eslint.org/), and [Vitest 2](https://vitest.dev/) for tooling
- [GitHub Actions](https://github.com/features/actions) workflow (`infra/github-ci.yml`) running workspace builds on push and PR

## Repository Layout
- `frontend/` – Vite + React client, Google Maps visualisation, admin UI
- `atm-service/` – Fastify microservice that downloads CAMS PM2.5 forecasts, converts NetCDF to points, and serves heatmap payloads
- `functions/` – Firebase Functions (REST API, ingest gateway, Pub/Sub worker), shared auth/lib utilities, Vitest suites
- `docs/` – Developer guides (`development.md` and supporting installation notes)
- `infra/` – CI configuration and automation assets
- `firestore.rules`, `storage.rules`, `firebase.json` – Emulator and deployment rules + targets

## Prerequisites
Install these once per workstation:
- [Node.js 24.x](https://nodejs.org/) and [pnpm 10.x](https://pnpm.io/installation)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`) with `firebase login`
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) for Pub/Sub emulator tooling (optional but recommended)
- [Python 3.12](https://www.python.org/), [Java 25 JDK](https://adoptium.net/temurin/releases/), and [Git 2.34+](https://git-scm.com/)

Verify installations:
```bash
node -v
pnpm -v
firebase --version
gcloud -v
java --version
```

## Local Setup
1. Clone the repository and enter the workspace.
   ```bash
   git clone git@github.com:denuoweb/CrowdPMPlatform.git
   cd CrowdPMPlatform
   ```
2. Install dependencies for all workspaces.
   ```bash
   pnpm install
   ```
3. Seed local configuration files (never commit the `.env.local` outputs).
   ```bash
   cp .firebaserc.example .firebaserc
   cp frontend/.env.example frontend/.env.local
   cp functions/.env.example functions/.env.local
   cp atm-service/.env.example atm-service/.env.local
  ```
4. Supply real secrets:
   - `frontend/.env.local`: Google Maps API key + vector map ID, API base URL (emulator or deployed).
   - `functions/.env.local`: device token signing key, activation URL overrides, and optional ingest topic.

### Environment Variables

`frontend/.env.local`

| Name | Purpose | Example |
| --- | --- | --- |
| `VITE_API_BASE` | Base URL for the Firebase HTTPS API. | `http://127.0.0.1:5001/demo-crowdpm/us-central1/crowdpmApi` |
| `VITE_GOOGLE_MAPS_API_KEY` | Maps JavaScript API key with WebGL overlay access. | `AIza...` |
| `VITE_GOOGLE_MAP_ID` | Vector map style ID for WebGL overlay (required). | `test-map-id` |
| `VITE_PM25_API_BASE_URL` | Base URL for the PM2.5 microservice (`atm-service`). | `http://127.0.0.1:4010` |

`functions/.env.local`

| Name | Purpose | Example |
| --- | --- | --- |
| `DEVICE_TOKEN_PRIVATE_KEY` | PEM-encoded Ed25519 private key for signing registration + access tokens. | `-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIP...\n-----END PRIVATE KEY-----` |
| `DEVICE_ACTIVATION_URL` | Base URL surfaced to users during pairing. | `https://crowdpmplatform.web.app/activate` |
| `DEVICE_VERIFICATION_URI` | Optional override for the verification URI sent to devices. | `https://example.com/activate` |
| `DEVICE_TOKEN_ISSUER` | JWT issuer claim for device tokens. | `crowdpm` |
| `DEVICE_TOKEN_AUDIENCE` | JWT audience for runtime access tokens. | `crowdpm_device_api` |
| `DEVICE_ACCESS_TOKEN_TTL_SECONDS` | Access token lifetime (default 600). | `600` |
| `DEVICE_REGISTRATION_TOKEN_TTL_SECONDS` | Registration token lifetime (default 60). | `60` |
| `INGEST_TOPIC` | Pub/Sub topic name for ingest batches (defaults to `ingest.raw`). | `ingest.raw` |

`atm-service/.env.local`

| Name | Purpose | Example |
| --- | --- | --- |
| `CAMS_API_KEY` | Copernicus Atmosphere Data Store API key (`uid:secret`). | `12345:abcdef...` |
| `CAMS_API_URL` | ADS API base URL. | `https://ads.atmosphere.copernicus.eu/api/v2` |
| `CAMS_DATASET_ID` | Dataset identifier to request. | `cams-global-atmospheric-composition-forecasts` |
| `CAMS_PM_VARIABLE` | Variable name within the NetCDF file. | `pm2p5` |
| `CRON_SCHEDULE` | Cron string for periodic refresh. | `0 * * * *` |
| `CACHE_TTL_MINUTES` | Minutes before cached batches are reprocessed. | `90` |
| `PORT` | Local port for the microservice. | `4010` |
| `HOST` | Bind address. | `0.0.0.0` |
| `DATA_DIR` | Directory for cached JSON.gz payloads. | `var/pm25` |

## Running Locally
Launch the entire stack from the repo root:
```bash
pnpm dev
```
- `crowdpm-frontend`: Vite dev server at `http://localhost:5173`
- `crowdpm-functions emulate`: Firebase Emulator Suite (Functions, Firestore, Storage, Auth, Pub/Sub, Emulator UI at `http://localhost:4000`)
- `crowdpm-functions build:watch`: TypeScript compiler emitting to `functions/lib/`
- `crowdpm-atm-service`: Fastify PM2.5 microservice at `http://localhost:4010`

Keep this terminal open; rebuilds stream into the emulator automatically.

## CAMS PM2.5 Microservice
The `atm-service` workspace is a standalone Fastify server that periodically requests CAMS atmospheric composition forecasts, converts PM2.5 NetCDF payloads into `{lat, lon, value}` samples, and exposes them to the frontend:

- `GET /pm25?batchId=ID&start=ISO&end=ISO&bbox=south,west,north,east[&deviceId=ID]` – returns the most recent cached grid for the supplied batch metadata. If the cache is missing or expired, the service downloads the NetCDF file on-demand before responding.
- Responses are gzipped JSON and cached to `atm-service/var/pm25`. Refresh cadence is controlled by `CRON_SCHEDULE` and `CACHE_TTL_MINUTES`.
- Schedule and dataset identifiers are configurable through `atm-service/.env.local`. Keep the Copernicus API key private and never commit the generated `.env.local`.

The frontend points to this service via `VITE_PM25_API_BASE_URL` and uses SWR to refresh heatmap overlays whenever a batch selection changes.

## Testing & Quality Gates
- Unit tests: `pnpm --filter crowdpm-functions test`
- Linting: `pnpm lint` (workspace-wide ESLint on TS/TSX sources)
- Type + build checks: `pnpm -r build`
- CI mirrors the build command; run locally before pushing to keep `infra/github-ci.yml` green.

## API Surface
The REST contract is documented in `functions/src/openapi.yaml` and implemented in `functions/src/index.ts`:
- `GET /health` – environment probe
- `GET /v1/devices` – list devices (auth optional in emulator)
- `POST /v1/devices` – create device (requires Firebase ID token)
- `GET /v1/measurements` – query PM2.5 readings by device, time window, and limit
- `POST /v1/admin/devices/:id/suspend` – mark device as suspended (requires authenticated user)

Set a Firebase ID token in the `Authorization: Bearer <token>` header to satisfy `requireUser`.

## Data Model & Storage
- Firestore: `devices/{deviceId}` documents store device metadata and optional `calibration` fields; measurements live under `measures/{hourBucket}/rows/{doc}` with UTC bucket IDs computed via `hourBucket`.
- Firestore: `devices/{deviceId}/batches/{batchId}` records ingest batch metadata (`count`, `processedAt`).
- Cloud Storage: raw ingest payloads saved to `ingest/{deviceId}/{batchId}.json` for auditing and replay.
- Pub/Sub: default `ingest.raw` topic triggers `ingestWorker` for eventual consistency processing.

## Security Considerations
- Devices must complete the `/device/start → /activate → /device/token → /device/register` flow and retrieve DPoP-bound access tokens before ingesting.
- All pairing, registration, and ingest calls require DPoP proofs whose thumbprints match the Ed25519 keys declared during onboarding; mismatches are rejected immediately.
- Firebase Auth tokens gate device creation and admin routes via `requireUser`.
- Firestore and Storage rules ship locked-down defaults: device and measurement data are read-only to external clients, ingest blobs are entirely private.

## Deployment
Use the Firebase CLI once credentials and target project are configured:
```bash
firebase deploy
```
Ensure `.firebaserc` points to the intended project (avoid using the `demo-` alias outside emulator workflows). Configure runtime secrets (e.g., `DEVICE_TOKEN_PRIVATE_KEY`) through Firebase environment configuration or Cloud Secret Manager before deploying.

## Further Reading
- `docs/development.md` – end-to-end local development workflow, emulator smoke tests, and ingest pipeline walkthrough
- `functions/src/openapi.yaml` – canonical REST contract
- `storage.rules`, `firestore.rules` – production security posture
