# Functions

Firebase Functions package for the CrowdPM API, device pairing, DPoP validation, ingest gateway, batch processing, and admin workflows.

## Commands

Run from the repository root:

```bash
pnpm --filter crowdpm-functions build
pnpm --filter crowdpm-functions build:watch
pnpm --filter crowdpm-functions test
pnpm --filter crowdpm-functions emulate
pnpm --filter crowdpm-functions payments:seed-catalog
```

`pnpm dev` at the repository root builds functions once, starts the Firebase Emulator Suite, and watches TypeScript output into `functions/lib/`.

## Runtime Configuration

Create `functions/.env.local` from `functions/.env.example` for local development.

Important values:

- `DEVICE_TOKEN_PRIVATE_KEY`: Ed25519 PKCS8 PEM used to sign registration and device access tokens.
- `DEVICE_ACTIVATION_URL`: activation URL displayed to users.
- `DEVICE_VERIFICATION_URI`: optional pairing verification URI override.
- `DEVICE_TOKEN_ISSUER`: JWT issuer, default `crowdpm`.
- `DEVICE_TOKEN_AUDIENCE`: device access-token audience, default `crowdpm_device_api`.
- `DEVICE_ACCESS_TOKEN_TTL_SECONDS`: access-token lifetime, default `600`.
- `DEVICE_REGISTRATION_TOKEN_TTL_SECONDS`: registration-token lifetime, default `60`.
- `PUBLIC_APP_BASE_URL`: base URL used for Stripe Checkout success and cancel redirects.
- `STRIPE_SECRET_KEY`: Stripe secret key for creating the node hardware Checkout session.
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret for `checkout.session.completed`.
- `FIRST_SUPER_ADMIN_EMAIL`, `FIRST_SUPER_ADMIN_PASSWORD`, `FIRST_SUPER_ADMIN_DISPLAY_NAME`: local Auth emulator super-admin seed user.

The code reads these values from `process.env`. In deployed Firebase Functions, `DEVICE_TOKEN_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` are expected to come from Secret Manager via each function's `secrets` binding, while the remaining runtime values can come from dotenv-backed env files.

The public node page currently uses `POST /v1/node-reservation-pledges` to collect non-binding waitlist interest without payment. Submissions are stored in Firestore `nodeReservationPledges` records deduplicated by normalized email.

The retained node purchase flow relies on Stripe Checkout shipping-address collection plus Stripe Tax. Configure Stripe Tax in the Stripe Dashboard so the physical-goods product can add US sales tax on top of the `$375` base node price after the buyer enters a US shipping address before re-enabling paid checkout. Power source and USB-A-to-micro-USB cable are not included with node hardware.

Stripe Checkout can still show `$0.00` tax for a valid US address when the Stripe account is not registered to collect tax in that jurisdiction. In Stripe's tax breakdown, that appears as `taxability_reason=not_collecting`. This is expected account configuration behavior, not a missing `automatic_tax` integration parameter.

## Stripe Catalog Seeding

Production checkout expects Firestore `paymentCatalog` documents to exist for each live Stripe product + default price. Seed them with:

```bash
pnpm --filter crowdpm-functions payments:seed-catalog
```

By default the seeding script loads `functions/.env.local` when present and syncs all known Stripe-backed products:

- `nodeHardware`
- `themeSaveUnlock`
- `subscriptionProMonthly`
- `subscriptionProYearly`

To seed only specific entries:

```bash
pnpm --filter crowdpm-functions payments:seed-catalog -- --only nodeHardware
```

To seed a deployed Firebase project, provide credentials with Firestore access plus a live `STRIPE_SECRET_KEY`. Cloud Function Secret Manager bindings are not visible to this local script, so export the live key or load it from an env file explicitly:

```bash
FIREBASE_PROJECT_ID=crowdpmplatform STRIPE_SECRET_KEY=sk_live_... \
pnpm --filter crowdpm-functions payments:seed-catalog -- --project crowdpmplatform
```

## API Surface

`crowdpmApi` is a Fastify app exported as an HTTPS Function:

- `GET /health`
- Pairing: `POST /device/start`, `/device/token`, `/device/register`, `/device/access-token`
- Activation: `GET /v1/device-activation`, `POST /v1/device-activation/authorize`
- User APIs: `/v1/devices`, `/v1/batches`, `/v1/user/settings`
- Public APIs: `/v1/public/batches`
- Admin APIs: `/v1/admin/devices/:id/suspend`, `/v1/admin/submissions`, `/v1/admin/users`

`ingestGateway` is a separate HTTPS Function that validates device access tokens and DPoP proofs, stores gzipped batch payloads, and writes batch metadata.

The OpenAPI document lives at `src/openapi.yaml`.

## Data Layout

- Firestore device records: `devices/{deviceId}`
- Firestore batch metadata: `batches/{batchId}`
- Gzipped ingest payloads: Cloud Storage `ingest/v2/{primaryOwnerUserId}/{deviceId}/{batchId}.json.gz`

## Tests

Vitest tests should stay close to the code they cover:

- `test/lib/`: pure helpers.
- `test/services/`: business logic with mocked dependencies.
- `test/routes/`: Fastify route tests with injected requests.

Avoid emulator-dependent tests unless a behavior cannot be verified with unit tests.
