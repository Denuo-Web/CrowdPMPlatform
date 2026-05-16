# Deployed Environment

This guide covers the single deployed Firebase environment. Use explicit project IDs in every deploy command so local emulator aliases cannot be deployed by mistake.

## Prerequisites

- Firebase project access with permission to deploy Hosting, Functions, Firestore rules/indexes, and Storage rules.
- Firebase CLI authenticated with `firebase login`.
- Clean `main` checkout at the commit being released.
- CI green or equivalent local checks passing: `pnpm lint`, `pnpm typecheck`, `pnpm --filter crowdpm-functions test`, and `pnpm build`.
- Frontend environment values ready for the deployed Firebase project.
- Functions runtime configuration ready, especially the Firebase secrets used by deployed functions.
- Stripe runtime values ready for node checkout: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and a public app base URL.

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
git checkout main
git pull --ff-only
git status --short
```

Do not release if `git status --short` prints any local changes, if the checkout is not `main`, or if local `main` is not the commit intended for release.

## Project Selection

Set the real Firebase project ID explicitly:

```bash
export FIREBASE_PROJECT_ID=crowdpmplatform
firebase projects:list | grep "$FIREBASE_PROJECT_ID"
```

Do not deploy `crowdpm-local`; that project ID is reserved for local emulators.
The `.firebaserc` file keeps `default` on `crowdpm-local` so bare Firebase commands fail safe during local work. It also exposes a `deployed` alias for the real Firebase project, but release commands should still prefer explicit `--project "$FIREBASE_PROJECT_ID"`.

## First-Time Project Setup

For a new deployed Firebase project, verify these services before the first release:

- Firestore API is enabled and the default Firestore database exists in Native mode.
- Default Firebase Storage bucket exists.
- Firebase Auth sign-in providers required by the app are enabled.
- Google Maps API key and vector map ID are configured for the deployed frontend.
- Hosting site is attached to the intended Firebase project.
- Stripe Tax is enabled in the Stripe account, with product tax behavior configured for US sales-tax collection.

## Runtime Configuration

The functions code reads runtime values from `process.env`.

The repository and CI are pinned to Node.js 24.15.0, while the Firebase Functions runtime remains on the `nodejs24` major runtime. Do not deploy a Functions runtime with Node.js 22 while building or testing on Node.js 24.15.0.

Required deployed Firebase secrets:

- `DEVICE_TOKEN_PRIVATE_KEY`: Ed25519 PKCS8 PEM used to sign device registration and access tokens.
- `STRIPE_SECRET_KEY`: Stripe secret key for creating node checkout sessions.
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret for `checkout.session.completed`.

Stripe Checkout uses catalog records stored in Firestore `paymentCatalog`. Do not rely on request-time catalog mutation in production: create the live Stripe products/prices deliberately, then seed matching `paymentCatalog` documents before exposing purchase links. `STRIPE_CATALOG_AUTO_CREATE=true` is only for local/emulator/test setup.

Common optional values:

- `DEVICE_ACTIVATION_URL`
- `DEVICE_VERIFICATION_URI`
- `DEVICE_TOKEN_ISSUER`
- `DEVICE_TOKEN_AUDIENCE`
- `DEVICE_ACCESS_TOKEN_TTL_SECONDS`
- `DEVICE_REGISTRATION_TOKEN_TTL_SECONDS`
- `CORS_ALLOWED_ORIGINS`: comma-separated additional browser origins allowed to call non-public APIs. Public read APIs under `/v1/public/` allow browser reads from any origin; admin, user, payment, pairing, and ingest APIs only emit CORS headers for configured first-party origins.
- `FIRST_SUPER_ADMIN_EMAIL`: optional post-deploy bootstrap target for the first super admin.
- `FIRST_SUPER_ADMIN_PASSWORD`: optional one-time password used only if the bootstrap user does not already exist.
- `FIRST_SUPER_ADMIN_DISPLAY_NAME`: optional display name for a created bootstrap user.
- `PUBLIC_APP_BASE_URL`

Keep secrets out of git. Deployed functions use Firebase Secret Manager for `DEVICE_TOKEN_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. The CI workflow syncs those three secrets from GitHub Actions into Firebase, then writes only non-secret runtime env vars into `functions/.env.$FIREBASE_PROJECT_ID`. Keep project-specific `.env.*` files local or in the deployment secret store.

## Pre-Launch Release Gates

Before inviting unknown public traffic, confirm each item outside the repo:

- Firebase project: `FIREBASE_PROJECT_ID` points to the intended production project, Hosting and Functions URLs are correct, Firestore/Storage/Auth are enabled, and Firebase budget alerts are active.
- GitHub `deployed` environment: required variables and secrets are set, environment protection/review rules are enabled, and deploy credentials use either Workload Identity Federation or the intended service account key.
- Stripe live mode: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are live-mode values for the intended account, the webhook endpoint is monitored, and failed webhook alerts are enabled.
- Google Maps: browser API keys are restricted to deployed origins and required Maps APIs, and the vector map ID is for the production project.
- First admin bootstrap: `FIRST_SUPER_ADMIN_EMAIL` identifies the initial operator account, the account uses a strong password and MFA, and bootstrap credentials are removed after use.
- Edge and abuse controls: Cloud Armor, API Gateway, Firebase/App Check, or equivalent edge controls are configured where applicable; rate and cost alerts have owners.
- Incident playbooks: document owners and steps for API abuse, credential leakage, runaway Firebase cost, Stripe webhook failure, payment/refund failure, public data takedown, and admin account compromise.
- Admin readiness: keep super-admin membership minimal, rehearse role changes, user disable/enable, submission quarantine/approval, device suspension/revocation, and moderation audit review.
- Payments and fulfillment: run live-mode checkout and webhook tests end to end, verify tax and US shipping behavior, refunds/cancellations, subscription lifecycle, receipt records, and node fulfillment SOPs before exposing public purchase links.
- Legal/data policy: Terms and Privacy text must be reviewed against actual behavior for retention, export/deletion, geolocation precision, public approved batches, and non-regulatory/non-medical/non-safety disclaimers.

## Build And Deploy

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm --filter crowdpm-functions test
pnpm build
printf '%s' "$DEVICE_TOKEN_PRIVATE_KEY" | firebase functions:secrets:set DEVICE_TOKEN_PRIVATE_KEY --project "$FIREBASE_PROJECT_ID" --data-file=-
printf '%s' "$STRIPE_SECRET_KEY" | firebase functions:secrets:set STRIPE_SECRET_KEY --project "$FIREBASE_PROJECT_ID" --data-file=-
printf '%s' "$STRIPE_WEBHOOK_SECRET" | firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project "$FIREBASE_PROJECT_ID" --data-file=-
firebase deploy --only hosting,functions --project "$FIREBASE_PROJECT_ID"
```

To grant the first deployed super admin after a release, set `FIRST_SUPER_ADMIN_EMAIL` and run:

```bash
pnpm --filter crowdpm-functions admin:bootstrap-super-admin
```

If the Firebase Auth user does not exist yet, also set `FIRST_SUPER_ADMIN_PASSWORD` for that one run so the script can create it.

Deploy rules and indexes only when changed:

```bash
firebase deploy --only firestore:indexes --project "$FIREBASE_PROJECT_ID"
firebase deploy --only firestore:rules,storage --project "$FIREBASE_PROJECT_ID"
```

The GitHub Actions workflow at `.github/workflows/deploy.yml` also deploys from `main` using the `deployed` GitHub environment. It resolves `FIREBASE_PROJECT_ID` from GitHub secrets or variables first, then falls back to the committed `deployed` alias in `.firebaserc`. Required GitHub authentication configuration is one of these options:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `FIREBASE_WORKLOAD_IDENTITY_PROVIDER` plus `FIREBASE_SERVICE_ACCOUNT_EMAIL`

For functions runtime config, the workflow now follows one model:

- GitHub Actions secrets are the source of truth for Firebase function secrets.
- CI syncs `DEVICE_TOKEN_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` into Firebase Secret Manager.
- CI writes `functions/.env.$FIREBASE_PROJECT_ID` only for non-secret function env vars.
- Frontend build config is resolved from GitHub secrets or variables.

The generated `functions/.env.$FIREBASE_PROJECT_ID` file should provide:

- `DEVICE_ACTIVATION_URL`
- `DEVICE_VERIFICATION_URI`
- `DEVICE_TOKEN_ISSUER`
- `DEVICE_TOKEN_AUDIENCE`
- `DEVICE_ACCESS_TOKEN_TTL_SECONDS`
- `DEVICE_REGISTRATION_TOKEN_TTL_SECONDS`
- `CORS_ALLOWED_ORIGINS`
- `PUBLIC_APP_BASE_URL`

The three function secrets must exist in Firebase Secret Manager and are referenced by deployed functions through the `secrets` option.

## Post-Deploy Validation

```bash
curl "https://us-central1-${FIREBASE_PROJECT_ID}.cloudfunctions.net/crowdpmApi/health"
firebase functions:log --project "$FIREBASE_PROJECT_ID" --only crowdpmApi
```

Manual checks:

- Open the deployed Hosting URL and confirm the app loads without console errors.
- Sign in with a valid Firebase Auth user.
- Start a node checkout and confirm Stripe Checkout only accepts US shipping addresses and shows tax added on top of the `$375` base node price for a jurisdiction where the Stripe account has an active tax registration.
- If Checkout shows `$0.00` tax with a valid address, inspect the Stripe transaction tax breakdown. `taxability_reason=not_collecting` means the account is not registered to collect tax in that jurisdiction.
- Run or replay one known ingest flow and confirm a `202` response.
- Confirm gzipped storage under `ingest/v2/<primaryOwnerUserId>/<deviceId>/<batchId>.json.gz`.
- Confirm Firestore batch metadata was written under `batches/{batchId}`.
- Check early Cloud Logging entries for `crowdpmApi` and `ingestGateway`.

## Rollback

For static Hosting-only issues, use Firebase Hosting rollback when suitable.

For application or function issues, redeploy the last known good commit:

```bash
git checkout <previous-good-commit>
pnpm install --frozen-lockfile
pnpm build
firebase deploy --only hosting,functions --project "$FIREBASE_PROJECT_ID"
```

Record the deployed commit, validation result, and any rollback reason in the release notes.
