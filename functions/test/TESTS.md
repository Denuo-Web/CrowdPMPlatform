# Functions Tests

## Methodology by folder
- `lib/` — Pure unit tests for small helpers (time, formatting, validation). No Fastify, no Firebase; deterministic inputs/outputs.
- `services/` — Unit tests for business logic classes/functions. Mock Firestore, auth, or other deps; avoid emulator.
- `routes/` — Route-level tests using Fastify `inject()` with mocked guards/services. Assert status codes, payload shapes, and error mapping.

## How to run
```bash
# Use Node 24 for this repo
source ~/.nvm/nvm.sh && nvm use 24

# All functions tests
pnpm --filter crowdpm-functions test

# All workspace tests
pnpm -r test
```
