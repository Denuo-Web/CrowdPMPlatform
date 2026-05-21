# CrowdPM Platform

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Denuo-Web/CrowdPMPlatform)

CrowdPM is a TypeScript/Firebase platform for crowd-sourced PM2.5 measurements. It pairs sensor nodes with Firebase users, accepts DPoP-bound ingest batches, stores compressed payloads in Cloud Storage, tracks batch metadata in Firestore, and renders public or owned batches on a React/WebGL map.

The project has two supported environments:

- `local development`: Vite plus the Firebase Emulator Suite using the local project ID `crowdpm-local`.
- `deployed`: Firebase Hosting, Cloud Functions, Firestore, Storage, and Auth in the configured Firebase project.

## Architecture

| Area | Path | Responsibility |
| --- | --- | --- |
| Frontend | `frontend/` | React 19 + Vite app, Google Maps/deck.gl map, activation UI, dashboards, moderation UI. |
| Functions | `functions/` | Firebase HTTPS Functions, Fastify REST API, pairing, DPoP validation, ingest processing, admin routes. |
| Shared types | `shared-types/` | Workspace package consumed by the frontend and functions for API/data contracts. |
| Scripts | `scripts/` | Local device emulator, deployed-device helpers, and workspace packaging utilities. |
| Firebase config | `firebase.json`, `firestore.rules`, `storage.rules` | Emulator ports, Hosting rewrites, deploy targets, and security rules. |

## Project History

CrowdPM Platform originated as an Oregon State University EECS Capstone project proposed by Jaron Rosenau / Denuo Web LLC. The project is now maintained and operated by Denuo Web LLC.

The repository includes contributions from multiple project contributors. See AUTHORS.md and the Git commit history for attribution.

## Quick Start

Use Node.js 24.15.0 before running project commands:

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
corepack enable
corepack prepare pnpm@10.18.1 --activate
pnpm install
```

Create local environment files:

```bash
cp frontend/.env.example frontend/.env.local
cp functions/.env.example functions/.env.local
```

Edit `frontend/.env.local` with a Google Maps JavaScript API key, vector map ID, Firebase web app config, and the local API base:

```bash
VITE_API_BASE=/api
VITE_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
```

Edit `functions/.env.local` with a real Ed25519 PKCS8 private key for `DEVICE_TOKEN_PRIVATE_KEY`. The local emulator also supports generated ephemeral keys, but a stable key is required when testing device registration and repeat ingest.

Start the full local stack:

```bash
pnpm dev
```

Local URLs:

- Frontend: `http://localhost:5173`
- API health: `http://127.0.0.1:5001/crowdpm-local/us-central1/crowdpmApi/health`
- Firebase Emulator UI: `http://localhost:4000`

## Common Commands

```bash
pnpm dev                                  # frontend, functions emulator, TS watch
pnpm lint                                 # workspace ESLint
pnpm typecheck                            # frontend TypeScript no-emit check
pnpm test                                 # workspace test suites: functions + shared-types
pnpm test:frontend                        # frontend Playwright smoke tests
pnpm test:shared-types                    # shared runtime helper tests
pnpm --filter crowdpm-functions test      # functions Vitest suite
pnpm build                                # build all workspaces
pnpm --filter crowdpm-frontend build      # frontend only
pnpm --filter crowdpm-functions build     # functions only
```

## Testing

Use Node.js 24.15.0 before running test commands:

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
```

The main regression command is:

```bash
pnpm test
```

That runs the backend Functions Vitest suite and the `@crowdpm/types` runtime helper tests. The frontend has a separate Playwright smoke suite because it starts a Vite server and browser:

```bash
pnpm test:frontend
```

The frontend smoke tests mock `/api/v1/*` responses and use test-only auth/map shims, so they do not require Firebase emulators, Google Maps, or Stripe credentials. On a fresh machine, install the Playwright Chromium browser once:

```bash
pnpm --filter crowdpm-frontend exec playwright install chromium
```

For interactive frontend debugging:

```bash
pnpm --filter crowdpm-frontend test:e2e:ui
```

Device emulator examples:

```bash
pnpm device:pair -- --key .device-key.json --interval 3
pnpm device:pair -- --mode ingest --key .device-key.json
```

## API And Data Flow

Primary Fastify routes are exported through the `crowdpmApi` HTTPS Function. The ingest gateway is a separate HTTPS Function for DPoP-bound device upload and batch persistence.

- Pairing: `POST /device/start`, `/device/token`, `/device/register`, `/device/access-token`
- Activation UI support: `GET /v1/device-activation`, `POST /v1/device-activation/authorize`
- User APIs: `/v1/devices`, `/v1/batches`, `/v1/user/settings`
- Public data: `/v1/public/batches`
- Admin and moderation: `/v1/admin/*`
- Ingest gateway: `POST /ingestGateway`

Ingest batches are stored as gzipped JSON in Cloud Storage at `ingest/v2/{primaryOwnerUserId}/{deviceId}/{batchId}.json.gz`. Firestore stores one metadata document per batch at `batches/{batchId}`; individual measurement points are not duplicated into Firestore.

## Documentation

- `docs/README.md` - documentation index and conventions
- `docs/development.md` - local setup and daily workflow
- `docs/deployment.md` - deployed Firebase release process
- `docs/hardware-builder.md` - hardware pairing and ingest contract
- `docs/openapi-swagger-ui.md` - local Swagger UI for `functions/src/openapi.yaml`
- `frontend/README.md`, `functions/README.md`, `shared-types/README.md`, `scripts/README.md` - package-specific notes

## Deployment

Use `docs/deployment.md` for the deployed environment. Always deploy with an explicit Firebase project ID and never deploy the local fake project:

```bash
FIREBASE_PROJECT_ID=crowdpmplatform
pnpm lint
pnpm build
firebase deploy --only hosting,functions --project "$FIREBASE_PROJECT_ID"
```

Deploy Firestore indexes and Firestore or Storage rules only when those files changed and have been reviewed.

## License

CrowdPM Platform is licensed under GNU AGPLv3-or-later unless otherwise stated.

Copyright © 2025–2026 Denuo Web LLC and contributors.

The hosted service, hardware node sales, support, fulfillment, and related commercial services are operated by Denuo Web LLC.

Commercial licensing may be available from Denuo Web LLC for portions of the project owned by, assigned to, or otherwise licensed to Denuo Web LLC for that purpose. Contributor-owned portions remain subject to their applicable license terms unless separate written permission has been obtained.

See LICENSE.md, NOTICE.md, AUTHORS.md, CONTRIBUTING.md, and CLA.md.

## Portfolio Case Study

This repository is part of Jaron Rosenau's implementation, developer-support, and integration engineering portfolio. The public case study summarizes the problem, delivery scope, architecture, and operational result.

- Case study: [CrowdPM Platform implementation case study](https://rosenau.info/projects/th58yUyKnQCs4CnrHZe6)
- Full portfolio: [Jaron Rosenau](https://rosenau.info)
- Summary: Secure PM2.5 ingest, calibrated storage, partner APIs, and WebGL map operations in one Firebase-backed platform.
