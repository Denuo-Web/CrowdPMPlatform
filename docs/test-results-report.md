# CrowdPM Platform Test Results Report

CS463 | Spring 2026 | Oregon State University  
Jaron Rosenau, Jack Armstrong, Mark Sparhawk, Skylar Soon

Last verification run: 2026-05-30 20:41 PDT  
Runtime: Node.js 24.15.0, pnpm 10.18.1

## Purpose

This report summarizes the testing methods used for CrowdPM and the testing information most useful to future maintainers.

## Summary of Testing Methods

| Method | What it tested | Experience / result |
| --- | --- | --- |
| Backend unit tests | Vitest tests for Firebase Functions and backend logic. | Useful for regression checks before deploys. |
| Shared-types tests | Runtime/helper tests for shared TypeScript contracts. | Helps keep frontend/backend data contracts stable. |
| Frontend smoke tests | Playwright tests using mocked API responses and test auth/map shims. | Good for checking that the React app loads and main screens still work. |
| Manual emulator testing | Firebase Emulator Suite, device emulator, activation flow, ingest, map inspection. | Most important end-to-end validation path. |
| Manual hardware testing | Real node support was added late; emulator testing covered most development. | Future teams should continue real-device validation. |

## Standard Test Commands

| Command | Purpose | Latest result |
| --- | --- | --- |
| `pnpm lint` | Workspace ESLint check. | Passed on 2026-05-30. |
| `pnpm typecheck` | Frontend TypeScript no-emit check. | Passed on 2026-05-30. |
| `pnpm test` | Functions Vitest suite plus shared-types tests. | Passed on 2026-05-30: shared-types 5 tests passed; functions 164 tests passed. |
| `pnpm test:frontend` | Playwright frontend smoke tests. | Passed on 2026-05-30: 4 Chromium tests passed. |
| `pnpm build` | Full workspace build. | Passed on 2026-05-30. |

## Latest Test Run Details

All commands were run from the repository root after executing:

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
```

Results:

| Command | Outcome | Notes |
| --- | --- | --- |
| `pnpm lint` | Passed | ESLint completed with no reported errors. |
| `pnpm typecheck` | Passed | `crowdpm-frontend` TypeScript no-emit check completed successfully. |
| `pnpm test` | Passed | `@crowdpm/types`: 1 file, 5 tests passed. `crowdpm-functions`: 27 files, 164 tests passed. |
| `pnpm test:frontend` | Passed | 4 Playwright Chromium smoke tests passed. Playwright emitted non-failing `NO_COLOR` / `FORCE_COLOR` warnings. |
| `pnpm build` | Passed | Shared types, functions, and frontend production builds completed. Vite emitted non-failing warnings about large chunks and plugin timings. |

## Coverage

Previous coverage: No prior numeric line-coverage percentage was recorded in the handoff materials.

Current coverage: No current numeric line-coverage percentage was calculated because the repository handoff uses pass/fail test commands rather than a committed coverage report.

Formula for future reports: Coverage % = (executed lines / total lines) * 100.

## End-to-End Validation Path

1. Start the local stack with `pnpm dev`.
2. Sign in to the local emulator account.
3. Start the device emulator and approve the pairing code in the activation UI.
4. Send an ingest batch and confirm an accepted response.
5. Verify that batch metadata appears in Firestore and the payload is stored in Cloud Storage.
6. Open the map/dashboard and confirm the PM2.5 route renders with the time slider.

## Notes for Future Testing

The Firebase Emulator Suite was the most useful testing environment because it allowed authentication, functions, Firestore, and Storage to be exercised locally.

The frontend smoke tests are intentionally isolated from live Firebase, Google Maps, and Stripe credentials.

The most important future improvement is to add an automated line-coverage report and continue real-node hardware testing.

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:frontend`, and `pnpm build` before deployment or major handoff changes.
