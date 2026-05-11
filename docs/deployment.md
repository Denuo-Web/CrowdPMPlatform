# Deployed Environment

This guide covers the single deployed Firebase environment. Use explicit project IDs in every deploy command so local emulator aliases cannot be deployed by mistake.

## Prerequisites

- Firebase project access with permission to deploy Hosting, Functions, Firestore rules/indexes, and Storage rules.
- Firebase CLI authenticated with `firebase login`.
- Clean `main` checkout at the commit being released.
- CI green or equivalent local checks passing.
- Frontend environment values ready for the deployed Firebase project.
- Functions runtime environment values ready, especially `DEVICE_TOKEN_PRIVATE_KEY`.
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

## Runtime Configuration

The functions code reads runtime values from `process.env`.

Required deployed value:

- `DEVICE_TOKEN_PRIVATE_KEY`: Ed25519 PKCS8 PEM used to sign device registration and access tokens.

Common optional values:

- `DEVICE_ACTIVATION_URL`
- `DEVICE_VERIFICATION_URI`
- `DEVICE_TOKEN_ISSUER`
- `DEVICE_TOKEN_AUDIENCE`
- `DEVICE_ACCESS_TOKEN_TTL_SECONDS`
- `DEVICE_REGISTRATION_TOKEN_TTL_SECONDS`
- `SMOKE_TEST_USER_EMAILS`
- `PUBLIC_APP_BASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

Keep secrets out of git. If using Firebase dotenv files for deploy-time environment variables, keep project-specific `.env.*` files local or in the deployment secret store. If migrating to Cloud Secret Manager-backed parameters, update the functions code to bind those secrets before relying on `firebase functions:secrets:set`.

## Build And Deploy

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm build
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

For functions runtime config, the workflow now writes `functions/.env.$FIREBASE_PROJECT_ID` during CI from GitHub secrets plus `FRONTEND_URL`. That file should provide:

- `DEVICE_TOKEN_PRIVATE_KEY`
- `DEVICE_ACTIVATION_URL`
- `DEVICE_VERIFICATION_URI`
- `DEVICE_TOKEN_ISSUER`
- `DEVICE_TOKEN_AUDIENCE`
- `DEVICE_ACCESS_TOKEN_TTL_SECONDS`
- `DEVICE_REGISTRATION_TOKEN_TTL_SECONDS`
- `SMOKE_TEST_USER_EMAIL` or `SMOKE_TEST_USER_EMAILS`
- `PUBLIC_APP_BASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`

## Post-Deploy Validation

```bash
curl "https://us-central1-${FIREBASE_PROJECT_ID}.cloudfunctions.net/crowdpmApi/health"
firebase functions:log --project "$FIREBASE_PROJECT_ID" --only crowdpmApi
```

Manual checks:

- Open the deployed Hosting URL and confirm the app loads without console errors.
- Sign in with a valid Firebase Auth user.
- Run or replay one known ingest flow and confirm a `202` response.
- Confirm raw storage under `ingest/<deviceId>/<batchId>.json`.
- Confirm Firestore batch metadata and measurement rows were written.
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
