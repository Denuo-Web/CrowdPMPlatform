# CrowdPM Platform – Demo Deployment Guide

This guide explains how to deploy the CrowdPM stack to the shared **demo Firebase project** after code review. Follow the steps in order and stop if any step fails.

---

## 1. Prerequisites
- IAM access to the demo Firebase project (Editor + Firebase Admin).
- All changes merged to `main`; CI green on the merge commit.
- Local repo clean and up to date:
  ```bash
  git checkout main
  git pull --rebase
  ```
- Node 24, pnpm 10, Firebase CLI installed and authenticated (`firebase login`).
- Secrets for the demo environment available (see team password manager).

### Service Account for GitHub Deployments
1. Open the Google Cloud Console for the demo project: *IAM & Admin → Service Accounts → Create Service Account*.
2. Name the account (for example `demo-deployer`) and grant it at minimum the `Editor` and `Firebase Admin` roles. Add `Service Account Token Creator` only if you later switch to Workload Identity.
3. After creation, choose *Manage keys → Add key → JSON*. Download the JSON once and store it in a secure location.
4. In GitHub, go to *Settings → Secrets and variables → Actions → New secret*, name it `DEMO_SERVICE_ACCOUNT_JSON`, and paste the JSON content.
5. Delete the downloaded JSON file locally. If the key is ever exposed, revoke and recreate it immediately.

---

## 2. Select the Demo Project
```bash
firebase use demo
firebase projects:list | grep $(firebase use --project)
```
Confirm the active project ID matches the expected demo project. If it does not, stop and investigate before deploying.

---

## 3. Update Cloud Function Secrets (first deployment and rotations)
Smoke tests and ingest flows require the shared HMAC secret. Run these commands before the first deploy on a new project **and** whenever the secret rotates. If you need to confirm the current value, inspect it with `firebase functions:config:get ingest --project demo`.
```bash
firebase functions:config:set ingest.hmac_secret="<demo-secret>" --project demo
firebase functions:config:set ingest.topic="ingest.raw" --project demo
```
Record any secret changes in the team changelog.

---

## 4. Ensure Pub/Sub Topic Exists
This command is idempotent and safe to run on every deploy.
```bash
gcloud pubsub topics create ingest.raw --project $(firebase use --project)
```
If you do not have `gcloud`, verify the topic via the Firebase Console instead.

### Enable Cloud Firestore (first run only)
For a new demo project you must enable the Firestore API before any Functions call will succeed. Visit https://console.cloud.google.com/flows/enableapi?apiid=firestore.googleapis.com&project=crowdpmplatform and enable the API (or enable it via **Firebase Console → Build → Firestore Database**). Give the change a minute or two to propagate before continuing.

### Provision the Firestore database
After the API is enabled, open **Firebase Console → Build → Firestore Database** and click **Create database**. Use *Native* mode and confirm the location (the default is usually fine). Wait until the database finishes provisioning—Functions will return 5 NOT_FOUND errors until this step is complete.

### Create the default Storage bucket
The ingest smoke test writes raw payloads to Cloud Storage. Open **Firebase Console → Build → Storage**, click **Get started**, choose the same region used for Functions/Firestore (for example `us-central`), and finish the wizard. This provisions the default Firebase Storage bucket (either `gs://<project-id>.appspot.com` or the newer `gs://<project-id>.firebasestorage.app`). The smoke test will time out with 504 errors until this bucket exists.

---

## 5. Build Fresh Artifacts
Always build from a clean workspace so deploys match CI output.
```bash
pnpm install                   # only if dependencies changed
pnpm lint
pnpm --filter frontend build
pnpm --filter functions build
```

---

## 6. Deploy Hosting and Functions
Deploy hosting and Cloud Functions together. Append Firestore rules only when the ruleset changed in this release.
```bash
firebase deploy --only hosting,functions --project demo
# Add ,firestore:rules when rule updates were approved.
```
Watch for warnings or failures and resolve them before proceeding.

---

## 7. Post-Deploy Validation Checklist
1. **Frontend smoke test** – Open `https://<demo-host>/` (replace with the actual URL). Check for console errors.
2. **API health** –
   ```bash
   curl https://<region>-<demo-project>.cloudfunctions.net/crowdpmApi/health
   ```
3. **Ingest pipeline** – Send a signed ingest payload using the demo HMAC secret. Confirm:
   - HTTP 202 response with a batch ID.
   - Cloud Storage file created under `ingest/<deviceId>/<batchId>.json`.
   - Firestore documents under `devices/<deviceId>/measures/...`.
4. **Logs** – `firebase functions:log --project demo --only crowdpmApi` to ensure startup logs are healthy.

Document the results in release notes.

---

## 8. Notify Stakeholders
Post in Slack/Teams with:
- Commit SHA deployed
- Summary of features/fixes
- Validation checklist status
- Any follow-up actions or known issues

---

## 9. Rollback Plan
If you need to revert quickly:
```bash
git checkout <previous-good-commit>
pnpm --filter frontend build
pnpm --filter functions build
firebase deploy --only hosting,functions --project demo
```
Inform the team immediately and document the reason for rollback.

---

## 10. Helpful Commands
```bash
firebase hosting:channel:deploy pr-<id> --project demo   # temporary preview channel for QA
firebase functions:config:get ingest --project demo      # inspect runtime config
firebase functions:log --project demo --only ingestWorker
```

Keep this file updated whenever the demo deployment process changes.
