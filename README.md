[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Denuo-Web/CrowdPMPlatform)

[![Deploy Demo Firebase](https://github.com/Denuo-Web/CrowdPMPlatform/actions/workflows/demo-deploy.yml/badge.svg?branch=main)](https://github.com/Denuo-Web/CrowdPMPlatform/actions/workflows/demo-deploy.yml)
# CrowdPM Platform
Crowd-sourced PM2.5 air quality monitoring stack combining Firebase microservices with a WebGL Google Maps client.
## Highlights
- Per-device HMAC ingest gateway stores raw payloads in Cloud Storage, validates signatures with device-scoped secrets, and pushes batch metadata to Google Cloud Pub/Sub for asynchronous processing.
- Pub/Sub-driven worker normalises and calibrates measurements before writing device hourly buckets in Firestore for fast queries.
- Fastify-based HTTPS API (`crowdpmApi`) exposes device, measurement, and admin endpoints consumed by the frontend and integration partners.
- React + Vite client renders Google Maps WebGL overlays via deck.gl to visualise particulate data and provides a basic admin table for device management.
- pnpm-managed TypeScript monorepo keeps frontend and backend code in sync, with shared tooling for linting, builds, and testing.

## System Architecture
- **Ingest** (`functions/src/services/ingestGateway.ts`): Firebase HTTPS Function guarded by `verifyHmac`, persists raw JSON to `ingest/{deviceId}/{batchId}.json` in Cloud Storage and publishes `{deviceId, batchId, path}` to the `ingest.raw` Pub/Sub topic.
- **Processing** (`functions/src/services/ingestWorker.ts`): Firebase Pub/Sub Function downloads batches, applies calibration data from `devices/{deviceId}` (if present), and writes measurements to `devices/{deviceId}/measures/{hourBucket}/rows/{doc}` with deterministic sorting.
- **API** (`functions/src/index.ts`): Fastify server packaged as an HTTPS Function with CORS + rate limiting, mounting `/health`, `/v1/devices`, `/v1/devices/claim`, `/v1/devices/bootstrap`, `/v1/measurements`, `/v1/admin/devices/:id/suspend`, and `/v1/admin/devices/unclaimed`. OpenAPI scaffold lives in `functions/src/openapi.yaml`.
- **Frontend** (`frontend/`): React 19.2 app built with Vite that toggles between a Google Maps 3D visualisation (`MapPage`) and an admin table (`AdminPage`). Uses the Maps JavaScript API with a deck.gl overlay for rendering.

## Tech Stack
- [Firebase Cloud Functions](https://firebase.google.com/docs/functions) with [Fastify](https://fastify.dev/)
- [Google Cloud Pub/Sub](https://cloud.google.com/pubsub/docs) and [Cloud Storage](https://cloud.google.com/storage/docs) backends
- [Cloud Firestore](https://firebase.google.com/docs/firestore) for device + measurement persistence
- [React 19.2](https://react.dev/), [Vite 5](https://vitejs.dev/), [deck.gl](https://deck.gl), and [Google Maps Platform](https://developers.google.com/maps/documentation) on the client
- [pnpm 10](https://pnpm.io/), [TypeScript 5](https://www.typescriptlang.org/), [ESLint 9](https://eslint.org/), and [Vitest 2](https://vitest.dev/) for tooling
- [GitHub Actions](https://github.com/features/actions) workflow (`infra/github-ci.yml`) running workspace builds on push and PR

## Repository Layout
- `frontend/` – Vite + React client, Google Maps visualisation, admin UI
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
   ```
4. Supply real secrets:
   - `frontend/.env.local`: Google Maps API key + vector map ID, API base URL (emulator or deployed).
   - `functions/.env.local`: claim passphrase pepper, device-secret encryption key, and optional custom Pub/Sub topic.

### Environment Variables

`frontend/.env.local`

| Name | Purpose | Example |
| --- | --- | --- |
| `VITE_API_BASE` | Base URL for the Firebase HTTPS API. | `http://127.0.0.1:5001/demo-crowdpm/us-central1/crowdpmApi` |
| `VITE_GOOGLE_MAPS_API_KEY` | Maps JavaScript API key with WebGL overlay access. | `AIza...` |
| `VITE_GOOGLE_MAP_ID` | Vector map style ID for WebGL overlay (required). | `test-map-id` |
| `VITE_FIREBASE_API_KEY` | Firebase Web API key for email/password login. | `AIza...` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase Auth domain. | `demo-crowdpm.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | Firebase project ID used by the stack. | `demo-crowdpm` |
| `VITE_FIREBASE_APP_ID` *(optional)* | Firebase web app ID (needed for some Auth features). | `1:123:web:abc` |
| `VITE_FIREBASE_AUTH_EMULATOR_HOST` *(optional)* | Host for Firebase Auth emulator when running locally. | `localhost:9099` |

`functions/.env.local`

| Name | Purpose | Example |
| --- | --- | --- |
| `CLAIM_PASSPHRASE_PEPPER` | Secret pepper appended to device claim passphrases before hashing. Use a long, random string and rotate centrally. | `my-super-secret-pepper` |
| `DEVICE_SECRET_ENCRYPTION_KEY` | 32-byte key (base64 or hex encoded) used to encrypt per-device ingest secrets stored in Firestore. | `AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=` |
| `INGEST_TOPIC` | Pub/Sub topic name for ingest batches (defaults to `ingest.raw`). | `ingest.raw` |

## Running Locally
Launch the entire stack from the repo root:
```bash
pnpm dev
```
- `crowdpm-frontend`: Vite dev server at `http://localhost:5173`
- `crowdpm-functions emulate`: Firebase Emulator Suite (Functions, Firestore, Storage, Auth, Pub/Sub, Emulator UI at `http://localhost:4000`)
- `crowdpm-functions build:watch`: TypeScript compiler emitting to `functions/lib/`

Keep this terminal open; rebuilds stream into the emulator automatically.

## Testing & Quality Gates
- Unit tests: `pnpm --filter crowdpm-functions test`
- Linting: `pnpm lint` (workspace-wide ESLint on TS/TSX sources)
- Type + build checks: `pnpm -r build`
- CI mirrors the build command; run locally before pushing to keep `infra/github-ci.yml` green.

## API Surface
The REST contract is documented in `functions/src/openapi.yaml` and implemented in `functions/src/index.ts`:
- `GET /health` – environment probe
- `GET /v1/devices` – list devices (auth optional in emulator)
- `POST /v1/devices` – create device and return a fresh ingest secret (requires Firebase ID token)
- `POST /v1/devices/claim` – claim an unclaimed device using its passphrase (requires Firebase ID token)
- `GET /v1/devices/claims` – list devices claimed by the authenticated user
- `DELETE /v1/devices/claims/:deviceId` – revoke a device claim owned by the authenticated user
- `POST /v1/devices/bootstrap` – exchange a passphrase for claim status or a one-time ingest secret delivery
- `GET /v1/measurements` – query PM2.5 readings by device, time window, and limit
- `POST /v1/admin/devices/:id/suspend` – mark device as suspended (requires authenticated user)
- `POST /v1/admin/devices/unclaimed` – provision an unclaimed device with a passphrase and server-generated ingest secret

Set a Firebase ID token in the `Authorization: Bearer <token>` header to satisfy `requireUser`.

## Data Model & Storage
- Firestore: `devices/{deviceId}` documents store device metadata (status, owner, claim timestamps), encrypted ingest secrets (`deviceSecret`), and optional `calibration` fields; measurements live under `measures/{hourBucket}/rows/{doc}` with UTC bucket IDs computed via `hourBucket`.
- Firestore: `devices/{deviceId}/batches/{batchId}` records ingest batch metadata (`count`, `processedAt`).
- Cloud Storage: raw ingest payloads saved to `ingest/{deviceId}/{batchId}.json` for auditing and replay.
- Pub/Sub: default `ingest.raw` topic triggers `ingestWorker` for eventual consistency processing.

## Security Considerations
- Device secrets are generated and encrypted server-side. Ingest clients sign payloads with their individual `deviceSecret`; unsigned or mismatched signatures are rejected (`verifyHmac`).
- Device claim passphrases are hashed with a server-held pepper, rate limited, and fully audited. Secrets are only returned once via the claim response or first bootstrap exchange.
- Firebase Auth tokens gate device creation and admin routes via `requireUser`.
- Firestore and Storage rules ship locked-down defaults: device and measurement data are read-only to external clients, ingest blobs are entirely private.

## Deployment
Use the Firebase CLI once credentials and target project are configured:
```bash
firebase deploy
```
Ensure `.firebaserc` points to the intended project (avoid using the `demo-` alias outside emulator workflows). Configure runtime secrets (e.g., `CLAIM_PASSPHRASE_PEPPER`, `DEVICE_SECRET_ENCRYPTION_KEY`) through Firebase environment configuration or Cloud Secret Manager before deploying.

## Further Reading
- `docs/development.md` – end-to-end local development workflow, emulator smoke tests, and ingest pipeline walkthrough
- `functions/src/openapi.yaml` – canonical REST contract
- `storage.rules`, `firestore.rules` – production security posture
