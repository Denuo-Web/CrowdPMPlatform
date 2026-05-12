# Deployed Environment

This guide covers the single deployed Firebase environment. Use explicit project IDs in every deploy command so local emulator aliases cannot be deployed by mistake.

## Prerequisites

- Firebase project access with permission to deploy Hosting, Functions, Firestore rules/indexes, and Storage rules.
- Firebase CLI authenticated with `firebase login`.
- Clean `main` checkout at the commit being released.
- CI green or equivalent local checks passing.
- Frontend environment values ready for the deployed Firebase project.
- Functions runtime configuration ready, especially the Firebase secrets used by deployed functions.
- Stripe runtime values ready for node checkout: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and a public app base URL.

```bash
source ~/.nvm/nvm.sh && nvm use 24
git checkout main
git pull --rebase
git status
```

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

Required deployed Firebase secrets:

- `DEVICE_TOKEN_PRIVATE_KEY`: Ed25519 PKCS8 PEM used to sign device registration and access tokens.
- `STRIPE_SECRET_KEY`: Stripe secret key for creating node checkout sessions.
- `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret for `checkout.session.completed`.

Common optional values:

- `DEVICE_ACTIVATION_URL`
- `DEVICE_VERIFICATION_URI`
- `DEVICE_TOKEN_ISSUER`
- `DEVICE_TOKEN_AUDIENCE`
- `DEVICE_ACCESS_TOKEN_TTL_SECONDS`
- `DEVICE_REGISTRATION_TOKEN_TTL_SECONDS`
- `SMOKE_TEST_USER_EMAIL`
- `SMOKE_TEST_USER_EMAILS`
- `PUBLIC_APP_BASE_URL`

Keep secrets out of git. Deployed functions use Firebase Secret Manager for `DEVICE_TOKEN_PRIVATE_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. The CI workflow syncs those three secrets from GitHub Actions into Firebase, then writes only non-secret runtime env vars into `functions/.env.$FIREBASE_PROJECT_ID`. Keep project-specific `.env.*` files local or in the deployment secret store.

## Build And Deploy

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
printf '%s' "$DEVICE_TOKEN_PRIVATE_KEY" | firebase functions:secrets:set DEVICE_TOKEN_PRIVATE_KEY --project "$FIREBASE_PROJECT_ID" --data-file=-
printf '%s' "$STRIPE_SECRET_KEY" | firebase functions:secrets:set STRIPE_SECRET_KEY --project "$FIREBASE_PROJECT_ID" --data-file=-
printf '%s' "$STRIPE_WEBHOOK_SECRET" | firebase functions:secrets:set STRIPE_WEBHOOK_SECRET --project "$FIREBASE_PROJECT_ID" --data-file=-
firebase deploy --only hosting,functions --project "$FIREBASE_PROJECT_ID"
```

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
- `SMOKE_TEST_USER_EMAIL` or `SMOKE_TEST_USER_EMAILS`
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
- Start a node checkout and confirm Stripe Checkout only accepts US shipping addresses and shows tax added on top of the `$350` node price for a jurisdiction where the Stripe account has an active tax registration.
- If Checkout shows `$0.00` tax with a valid address, inspect the Stripe transaction tax breakdown. `taxability_reason=not_collecting` means the account is not registered to collect tax in that jurisdiction.
- Run or replay one known ingest flow and confirm a `202` response.
- Confirm gzipped storage under `ingest/v2/<ownerUserId>/<deviceId>/<batchId>.json.gz`.
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
