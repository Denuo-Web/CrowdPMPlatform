[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Denuo-Web/CrowdPMPlatform)

[![Deploy Demo Firebase](https://github.com/Denuo-Web/CrowdPMPlatform/actions/workflows/demo-deploy.yml/badge.svg?branch=main)](https://github.com/Denuo-Web/CrowdPMPlatform/actions/workflows/demo-deploy.yml)
# CrowdPM Platform
Crowd-sourced PM2.5 air quality monitoring stack combining Firebase microservices with a WebGL Google Maps client.
## Highlights
- DPoP-bound ingest gateway validates short-lived device tokens, persists raw payloads in Cloud Storage, and processes batches through a shared ingest pipeline.
- The shared batch processor normalises and calibrates measurements before writing device hourly buckets in Firestore for fast queries.
- Fastify-based HTTPS API (`crowdpmApi`) exposes device, measurement, and admin endpoints consumed by the frontend and integration partners.
- React + Vite client renders Google Maps WebGL overlays via deck.gl to visualise particulate data and provides a basic admin table for device management.
- pnpm-managed TypeScript monorepo keeps frontend and backend code in sync, with shared tooling for linting, builds, and testing.

## System Architecture
- **Ingest** (`functions/src/services/ingestGateway.ts` + `functions/src/services/ingestService.ts`): Firebase HTTPS Function path that validates DPoP proofs plus device access tokens, persists raw JSON to `ingest/{deviceId}/{batchId}.json` in Cloud Storage, and runs the shared processor.
- **Processing** (`functions/src/services/ingestBatchProcessor.ts`): Shared processing module that applies calibration data from `devices/{deviceId}` (if present), writes measurements to `devices/{deviceId}/measures/{hourBucket}/rows/{doc}`, and updates batch status.
- **Pairing API** (`functions/src/routes/pairing.ts` + `functions/src/routes/activation.ts`): Implements the device authorization grant (device start/token/register/access-token) using Ed25519 keys, DPoP, and the `/activate` UI for human approval with MFA enforcement.
- **API** (`functions/src/index.ts`): Fastify server packaged as an HTTPS Function with CORS + rate limiting, mounting `/health`, `/v1/devices`, `/v1/measurements`, pairing endpoints, and `/v1/device-activation`. OpenAPI scaffold lives in `functions/src/openapi.yaml`.
- **Frontend** (`frontend/`): React 19.2 app built with Vite that toggles between a Google Maps 3D visualisation (`MapPage`) and a user dashboard (`UserDashboard`). Uses the Maps JavaScript API with a deck.gl overlay for rendering.

## Tech Stack
- [Firebase Cloud Functions](https://firebase.google.com/docs/functions) with [Fastify](https://fastify.dev/)
- [Cloud Storage](https://cloud.google.com/storage/docs) backend for raw ingest payload retention
- [Cloud Firestore](https://firebase.google.com/docs/firestore) for device + measurement persistence
- [React 19.2](https://react.dev/), [Vite 5](https://vitejs.dev/), [deck.gl](https://deck.gl), and [Google Maps Platform](https://developers.google.com/maps/documentation) on the client
- [pnpm 10](https://pnpm.io/), [TypeScript 5](https://www.typescriptlang.org/), [ESLint 9](https://eslint.org/), and [Vitest 2](https://vitest.dev/) for tooling
- [GitHub Actions](https://github.com/features/actions) workflow (`infra/github-ci.yml`) running workspace builds on push and PR

## Repository Layout
- `frontend/` – Vite + React client, Google Maps visualisation, admin UI
- `functions/` – Firebase Functions (REST API and ingest processing), shared auth/lib utilities, Vitest suites
- `docs/` – Developer guides (`development.md` and supporting installation notes)
- `infra/` – CI configuration and automation assets
- `firestore.rules`, `storage.rules`, `firebase.json` – Emulator and deployment rules + targets

## Prerequisites
Install these once per workstation:
- [Node.js 24.x](https://nodejs.org/) and [pnpm 10.x](https://pnpm.io/installation)
- [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`) with `firebase login`
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (optional, used for broader Google Cloud tooling)
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
   - `functions/.env.local`: device token signing key and activation URL overrides.
   - `functions/.secret.local` (not committed): secrets declared via `defineSecret`, e.g. `DEVICE_TOKEN_PRIVATE_KEY`. The Firebase Functions emulator refuses to start without local overrides, so copy the private key from `.env.local` into this file as `DEVICE_TOKEN_PRIVATE_KEY=...`.

### Environment Variables

`frontend/.env.local`

| Name | Purpose | Example |
| --- | --- | --- |
| `VITE_API_BASE` | Base URL for the Firebase HTTPS API. | `http://127.0.0.1:5001/demo-crowdpm/us-central1/crowdpmApi` |
| `VITE_GOOGLE_MAPS_API_KEY` | Maps JavaScript API key with WebGL overlay access. | `AIza...` |
| `VITE_GOOGLE_MAP_ID` | Vector map style ID for WebGL overlay (required). | `test-map-id` |

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

### Firebase Secret Overrides

Functions that declare secrets with `defineSecret` must be supplied locally through `functions/.secret.local`. Without this file the emulator attempts to read Secret Manager and fails with 403 errors (`Unable to access secret environment variables...`). Populate the file with shell-style assignments; multiline PEM values can stay escaped exactly like `.env.local`.

```bash
cat > functions/.secret.local <<'EOF'
DEVICE_TOKEN_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\\nMC4CAQAwBQYDK2VwBCIEIPreplace-me-with-a-real-key\\n-----END PRIVATE KEY-----
EOF
```

The file is ignored via `.gitignore`, so it is safe to keep real credentials there for local testing.

## Running Locally
Launch the entire stack from the repo root:
```bash
pnpm dev
```
- `crowdpm-frontend`: Vite dev server at `http://localhost:5173`
- `crowdpm-functions emulate`: Firebase Emulator Suite (Functions, Firestore, Storage, Auth, Emulator UI at `http://localhost:4000`)
- `crowdpm-functions build:watch`: TypeScript compiler emitting to `functions/lib/`

Keep this terminal open; rebuilds stream into the emulator automatically.

### Send an ingest batch without re-pairing
Use the device emulator in ingest-only mode with the key you registered:
```bash
pnpm device:pair -- --mode ingest --device-id <device-id> --key ./emu-key.json --api http://localhost:5001/demo-crowdpm/us-central1/crowdpmApi
```
- Replace `<device-id>` with the registered ID and `./emu-key.json` with the same Ed25519 key used during registration.
- Defaults send 60 points (1-minute spacing, +2 per minute); override with `--minutes`, `--start-value`, or `--value-step`.

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

### Error Responses
- API and gateway failures return normalized JSON with required `error` (lower_snake_case) and optional `message`.
- `error_description` is emitted as a temporary compatibility alias for `message` and is deprecated.
- Some endpoints include metadata fields such as `details`, `poll_interval`, `retry_after`, and `forbiddenDeviceIds`.

## Data Model & Storage
- Firestore: `devices/{deviceId}` documents store device metadata and optional `calibration` fields; measurements live under `measures/{hourBucket}/rows/{doc}` with UTC bucket IDs computed via `hourBucket`.
- Firestore: `devices/{deviceId}/batches/{batchId}` records ingest batch metadata (`count`, `processedAt`, `visibility`, and error states when applicable).
- Cloud Storage: raw ingest payloads saved to `ingest/{deviceId}/{batchId}.json` for auditing and replay.

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
