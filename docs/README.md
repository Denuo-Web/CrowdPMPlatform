# Documentation Index

CrowdPM documentation is organized by audience and environment. Avoid copying the same setup steps into multiple files; link back to the canonical guide instead.

## Environments

- `local development`: Vite plus Firebase emulators, using local project ID `crowdpm-local`.
- `deployed`: the real Firebase project used by Hosting, Functions, Firestore, Storage, and Auth.

## Guides

| File | Audience | Purpose |
| --- | --- | --- |
| `../README.md` | Everyone | Project overview, quick start, architecture, core commands. |
| `development.md` | Contributors | Local emulator setup, env files, device checks, daily workflow. |
| `deployment.md` | Maintainers | Deployed Firebase release checklist and rollback process. |
| `hardware-builder.md` | Hardware builders | Device pairing, DPoP, access tokens, ingest payload contract. |
| `openapi-swagger-ui.md` | API users | View `functions/src/openapi.yaml` in hosted or local Swagger UI. |
| `test-plan.txt` | Capstone team | Sprint test scope, methods, ownership, and Kanban evidence. |
| `INSTALL-openjdk25-linux.md` | Linux contributors | JDK 25 setup notes for Firebase emulators. |
| `INSTALL-openjdk25-mac.md` | macOS contributors | JDK 25 setup notes for Firebase emulators. |

Package-level notes:

- `../frontend/README.md`
- `../functions/README.md`
- `../shared-types/README.md`
- `../scripts/README.md`

## Assets

- `CrowdPMPlatform.png`: project image used in presentations or external docs.
- `CrowdPMPlatform_UserGuide.pdf`: user-facing guide snapshot.
- `2026.ExpoPoster.CS100.ppt`: presentation artifact.

Binary artifacts should be regenerated from their source material when possible. Markdown files are the canonical developer documentation.
