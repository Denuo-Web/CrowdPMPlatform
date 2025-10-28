# CrowdPM Platform – Local Development Guide

This document is the single place to learn how to clone the repository, configure required keys, and run the full CrowdPM stack **locally using the Firebase Emulator Suite**. Everything here is sequential—start at Step 1 and work down.

---

## 1. What You Will Accomplish
1. Prepare your workstation with the required tooling.
2. Clone the repo and install dependencies.
3. Configure local environment variables (.env files only).
4. Launch the emulator + frontend stack with `pnpm dev`.
5. Verify the API, frontend, and ingest pipeline.
6. Run tests before opening a pull request.

Remote demo/production deploys are intentionally excluded.

---

## 2. Prerequisites (install once on your machine)
- **Python 3.12**
- **Node.js 24.x** – install with nvm, Volta, fnm, Homebrew, or download from nodejs.org.
- **pnpm 10.x** – `npm install -g pnpm@10`.
- **Firebase CLI** – `npm install -g firebase-tools`; authenticate with `firebase login`.
- **Google Cloud CLI** – `curl -fsS https://sdk.cloud.google.com | bash`, then `gcloud auth login` if you plan to inspect Pub/Sub emulator logs.
- **Git** – any modern version (2.34+).
- **Java JDK 25** – required by Firebase emulators. Visit [Install guide](docs/INSTALL-openjdk25-linux.md)

Once installed, confirm versions:
```bash
node -v              # expect v24.x
pnpm -v              # expect 10.x
firebase --version   # expect 14.x
gcloud -v            # expect Google Cloud SDK 542.x + others
java --version       # expect openjdk 25 + others
```

---

## 3. Clone the Repository
```bash
git clone git@github.com:denuoweb/CrowdPMPlatform.git
cd CrowdPMPlatform
```
(Use HTTPS if you prefer: `git clone https://github.com/denuoweb/CrowdPMPlatform.git`.)

Optional Git configuration for this repo:
```bash
git config user.name "Full Name"
git config user.email "you@email.com"
```

---

## 4. Configure Firebase CLI for Local Emulators Only
The emulator needs a project ID to namespace data. Use a fake local project so you never point at real Firebase projects by accident.

1. Copy the provided example and tweak it if you already have other projects configured:
   ```bash
   cp .firebaserc.example .firebaserc
   ```
2. Login to firebase (one time):
   ```bash
   firebase login
   ```

The example `.firebaserc` maps `local` to `demo-crowdpm`, satisfying Firebase's guidance to use IDs prefixed with `demo-` so the CLI treats it as a safe fake project.

All subsequent commands in this guide assume the `local` alias is active.

> **Important:** Never deploy using this alias. It is solely for emulator usage and will not map to a real Firebase project.

---

## 5. Install Workspace Dependencies
```bash
pnpm install
```
This installs the dependencies for `frontend` and `functions` in a single step. Expect the first run to take a few minutes.

---

## 6. Create Local Environment Files
You need two `.env.local` files—one for the frontend and one for Cloud Functions. Do not commit these files. 

We will be using individual API keys (should be within the free tier of use).

### 6.1 `frontend/.env.local`
```bash
cp frontend/.env.example frontend/.env.local
```
- Update `VITE_GOOGLE_MAPS_API_KEY` with your valid key.
- Set `VITE_GOOGLE_MAP_ID` to a vector map style ID from the Google Cloud Console (required for WebGL overlays). See below for specifics.
   - In the Google Maps Platform -> Map management -> Create map ID
   - Fill in the name and optional description.
   - Map type: Javascript -> Vector.
   - Optionally allow Tilt and Rotation.
   - Save and copy the Map ID (looks like abcd1234efgh5678).


- Restart the Vite dev server after editing; Vite reads env variables only at startup.

### 6.2 `functions/.env.local`
```bash
cp functions/.env.example functions/.env.local
```
- Fill in `INGEST_HMAC_SECRET` with the value shared with the ingest simulator, keep it private, and adjust `INGEST_TOPIC` only when testing custom Pub/Sub topics.

---

## 7. Start the Local Stack
From the repo root:
```bash
pnpm dev
```
What happens:
- `pnpm --filter frontend dev` starts Vite on `http://localhost:5173`.
- `pnpm --filter functions emulate` runs `firebase emulators:start` (Functions, Firestore, Storage, Auth, Pub/Sub, Emulator UI).
- `pnpm --filter functions build:watch` compiles TypeScript sources into `functions/lib/` so the emulator loads fresh code as you save files.

> **Heads-up:** The Storage rules runtime currently prints `sun.misc.Unsafe::arrayBaseOffset` deprecation warnings when running on newer JDKs. Firebase has not shipped a patched runtime yet; you can safely ignore these messages while developing.

Leave this terminal open while you develop. Watch for immediate red errors—most failures are missing env vars or bad imports.

---

## 8. Verify Everything Is Running
Perform these checks each time you start the stack.

### 8.1 Frontend
Open `http://localhost:5173` in the browser. The React app should load without console errors.

### 8.2 REST API Health Check
From another terminal:
```bash
curl http://127.0.0.1:5001/demo-crowdpm/us-central1/crowdpmApi/health
```
Expected JSON: `{ "ok": true }`.

### 8.3 Emulator UI
Visit `http://localhost:4000` to inspect Firestore documents, Pub/Sub messages, Storage files, and emulator logs.

If any of these steps fail, stop the stack (`Ctrl+C` twice) and restart after fixing the issue.

---

## 9. Optional: Ingest Pipeline Smoke Test
Run this whenever you change ingest code or schemas.

1. Launch the local stack with `pnpm dev` (Functions emulator must have `INGEST_HMAC_SECRET` in `functions/.env.local`).
2. Visit `http://localhost:5173`, open the **Admin** tab, and click **Run Smoke Test**.
3. The UI seeds `device-123`, submits a signed payload with a 1-minute trail of points (including altitude/accuracy) to `ingestGateway`, and shows the resulting batch metadata. The Map tab auto-selects the device, draws the path, and renders a timeline slider that moves a single sphere along the route sized to GPS accuracy and elevated per the sample altitude.
4. Open the Firebase Emulator UI (`http://localhost:4000`) if you want to double-check:
   - Storage: `ingest/device-123/<batchId>.json`.
   - Firestore: `devices/device-123/measures/<hourBucket>/rows`.
   - Functions logs: look for `ingestWorker` processing the batch.

> Prefer a raw cURL workflow or custom payload? Call `POST /v1/admin/ingest-smoke-test` from the API directly with your overrides, or adapt the previous manual script (kept in repo history) for advanced debugging.

Need to reset the environment? Use **Delete Smoke Test Data** in the Admin tab, which clears the seeded device, storage batches, and map state so you can run the scenario again.

---

## 10. Run Tests Before You Push
Keep the repository healthy by running these regularly:
```bash
# All workspace tests
pnpm -r test

# Static analysis
pnpm lint

# Build TypeScript outputs (catches compile errors)
pnpm -r build
```
Add Vitest suites in `functions/` and `frontend/` as new behaviour is introduced.

---

## 11. Daily Workflow Checklist
1. Pull latest changes: `git pull --rebase`.
2. Start stack: `pnpm dev`.
3. Make code changes.
4. Keep emulator UI open for quick data inspection.
5. Run `pnpm -r test` + `pnpm -r build`.
6. Stop stack with `Ctrl+C` when done.

---

## 12. Quick Reference Commands
```bash
# Start everything
pnpm dev

# Only frontend (useful when API is already running elsewhere)
pnpm --filter frontend dev

# Only functions emulator
pnpm --filter functions dev

# Firestore emulator host for scripts (run in new shell)
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080

# Pub/Sub emulator host
export PUBSUB_EMULATOR_HOST=127.0.0.1:8085
```

Keep any new discoveries in this guide so the next teammate can onboard even faster.
