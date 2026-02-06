# CrowdPM Platform – Production Release Guide

This guide describes the controlled process for deploying the CrowdPM stack to the **production Firebase project**. Only the release manager (team lead or on-call engineer) should follow these steps. Do not proceed if prerequisites are unmet.

---

## 1. Release Prerequisites
- Release window approved and communicated to stakeholders.
- All relevant pull requests merged and demo environment validated.
- CI green on `main` and release notes drafted.
- Backups/restore plan verified (e.g. last Firestore export timestamp).
- IAM access: Editor + Firebase Admin on the production project.
- Local repo is clean and matches the release commit:
  ```bash
  git checkout main
  git pull --rebase
  git status
  ```

---

## 2. Switch Firebase Context to Production
```bash
firebase use production
firebase projects:list | grep $(firebase use --project)
```
Double-check the project ID. Abort immediately if the wrong project appears.

---

## 3. Verify Cloud Function Secrets
Production secrets should already exist, but confirm before deploying.
```bash
firebase functions:secrets:access DEVICE_TOKEN_PRIVATE_KEY --project production --version latest
```
Ensure the Ed25519 PEM matches the ops playbook. Update only if officially rotated:
```bash
printf '%s\n' "-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----" \
  | firebase functions:secrets:set DEVICE_TOKEN_PRIVATE_KEY --project production --data-file -
```
Document any change in the release notes and access log.

---

## 4. Build Fresh Artifacts
Always rebuild from scratch to match production output.
```bash
pnpm install                   # run if dependencies changed
pnpm lint
pnpm store prune               # optional: trim pnpm cache before release
pnpm --filter frontend build
pnpm --filter functions build
```
Review build output for warnings.

---

## 5. Deploy to Production
Deploy hosting and functions together. Add Firestore rules only when the ruleset changed and has been vetted in demo.
```bash
firebase deploy --only hosting,functions --project production
# Append ,firestore:rules when deploying an approved ruleset
```
Monitor the CLI output carefully. If any deploy step fails, stop and resolve before retrying.

---

## 6. Post-Deploy Validation Checklist
1. **Frontend availability** – Open `https://<prod-host>/` and check for console errors.
2. **API health** –
   ```bash
   curl https://<region>-<prod-project>.cloudfunctions.net/crowdpmApi/health
   ```
3. **Ingest verification** – Coordinate with the data team to send a single signed payload (or replay a known message). Confirm:
   - HTTP 202 response with batch ID
   - Cloud Storage entry under `ingest/<deviceId>/<batchId>.json`
   - Firestore documents under the expected device collections
4. **Cloud Logging** – Inspect the first 15 minutes of logs for `crowdpmApi` and `ingestGateway` for elevated error rates.
5. **Monitoring dashboards** – Check any external monitors (uptime, error tracking) for alerts.

Record results in the release notes.

---

## 7. Communicate Release Status
Send an update to stakeholders (Slack/Teams/email) containing:
- Release version or commit SHA
- Summary of features/fixes
- Validation checklist status
- Any post-release tasks or follow-up investigations

Update the changelog and incident tracker accordingly.

---

## 8. Rollback Procedure
If critical issues appear and rollback is required:
1. Identify the last known good commit/tag.
2. Deploy it immediately:
   ```bash
   git checkout <previous-good-tag>
   pnpm --filter frontend build
   pnpm --filter functions build
   firebase deploy --only hosting,functions --project production
   ```
3. Notify stakeholders of the rollback, document the root cause effort, and create an incident ticket if severity warrants.

Optionally use `firebase hosting:rollback` if you only need to revert the static site and functions are healthy.

---

## 9. Post-Release Tasks
- Tag the release in Git:
  ```bash
  git tag -a vX.Y.Z -m "Production release"
  git push origin vX.Y.Z
  ```
- Archive release notes in the knowledge base.
- Schedule a retro if the release introduced incidents.

---

## 10. Useful Commands
```bash
firebase functions:log --project production --only crowdpmApi
firebase firestore:indexes:list --project production
firebase deploy --only firestore:rules --project production   # run only after approval
```

Keep this guide up to date whenever the production release process changes.
