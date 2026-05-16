# Local Development

This guide is the canonical local workflow. It runs the frontend and Firebase services against emulators only.

## 1. Runtime

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
corepack enable
corepack prepare pnpm@10.18.1 --activate
pnpm install
```

Required tools:

- Node.js 24.15.0
- pnpm 10.x
- Firebase CLI
- Java JDK 25 for the Firebase emulators
- Python 3.x for helper snippets
- Git
- Google Maps JavaScript API key and vector map ID

Linux and macOS JDK notes are in `INSTALL-openjdk25-linux.md` and `INSTALL-openjdk25-mac.md`.

## 2. Firebase Local Project

Local development uses the Firebase project ID `crowdpm-local`.

Do not deploy `crowdpm-local`. It is reserved for emulator workflows. The deployed environment uses a real Firebase project ID and is covered in `deployment.md`.

## 3. Environment Files

Create local copies:

```bash
cp frontend/.env.example frontend/.env.local
cp functions/.env.example functions/.env.local
```

Frontend values that normally need editing:

- `VITE_API_BASE=/api`
- `VITE_GOOGLE_MAPS_API_KEY`
- `VITE_GOOGLE_MAP_ID`
- `VITE_FIREBASE_*` web app values
- `VITE_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`

Functions values that normally need editing:

- `DEVICE_TOKEN_PRIVATE_KEY`: Ed25519 PKCS8 PEM used to sign registration and access tokens.
- `DEVICE_ACTIVATION_URL=http://localhost:5173/activate`
- `DEVICE_VERIFICATION_URI=http://localhost:5173/activate`
- `FIRST_SUPER_ADMIN_*`: optional local Auth emulator super-admin seed user override.

Generate a local device token key when needed:

```bash
openssl genpkey -algorithm ED25519 -out /tmp/crowdpm-device-token-key.pem
python3 - <<'PY'
from pathlib import Path
key = Path('/tmp/crowdpm-device-token-key.pem').read_text().replace('\n', '\\n')
print(f'DEVICE_TOKEN_PRIVATE_KEY={key}')
PY
```

Paste the printed line into `functions/.env.local`. Keep all `.env.local` files out of git.

## 4. Start The Stack

```bash
pnpm dev
```

This runs:

- `crowdpm-frontend dev`: Vite at `http://localhost:5173`
- Firebase emulators: Functions, Firestore, Storage, Auth, and Emulator UI
- `crowdpm-functions build:watch`: TypeScript output into `functions/lib/`

Health checks:

```bash
curl http://127.0.0.1:5001/crowdpm-local/us-central1/crowdpmApi/health
open http://localhost:4000
```

The Functions emulator seeds `admin@crowdpm.dev` with password `crowdpm-dev` and the `super_admin` role unless overridden in `functions/.env.local`.

## 5. Device Checks

Use the web app first:

1. Open `http://localhost:5173`.
2. Sign in with the seeded super-admin account or another Firebase Auth emulator user.
3. Approve a device pairing request from the activation UI.
4. Send a test ingest batch from the device emulator and confirm it appears on the map and in the dashboard.

Use the device emulator when testing pairing or DPoP behavior:

```bash
pnpm device:pair -- --key .device-key.json --interval 3
pnpm device:pair -- --mode ingest --key .device-key.json
```

The first command starts pairing, prints the user code, polls for approval, registers the key, and saves the device ID. The second command reuses the saved key and device ID to send an ingest batch.

## 6. Quality Gates

Run these before opening a pull request:

```bash
pnpm lint
pnpm --filter crowdpm-functions test
pnpm build
```

## 7. Daily Workflow

```bash
git checkout main
git pull --rebase
git checkout -b "$USER/short-description"
pnpm dev
```

Keep documentation changes close to the code they describe. Root-level setup belongs in `README.md` or this file; package-specific details belong in the package README.
