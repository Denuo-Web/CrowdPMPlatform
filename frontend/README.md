# Frontend

React 19 + Vite client for the CrowdPM map, activation flow, user dashboard, and moderation UI.

## Commands

Run from the repository root:

```bash
pnpm --filter crowdpm-frontend dev
pnpm --filter crowdpm-frontend typecheck
pnpm --filter crowdpm-frontend test:e2e
pnpm --filter crowdpm-frontend test:e2e:ui
pnpm --filter crowdpm-frontend build
pnpm --filter crowdpm-frontend preview
```

`pnpm dev` at the repository root starts this app together with the Firebase emulators and functions build watcher.

## Testing

The frontend uses Playwright for a small smoke/regression suite. The tests cover public routing, protected-route gating, mocked dashboard data, admin access, sign-out, and the node checkout redirect contract.

Run from the repository root:

```bash
source ~/.nvm/nvm.sh && nvm use 24.15.0
pnpm test:frontend
```

The suite starts Vite through `frontend/playwright.config.ts`, mocks `/api/v1/*` in `frontend/e2e/fixtures.ts`, and enables test-only auth/map shims through Vite env vars. It should not require Firebase emulators, Google Maps, or Stripe credentials.

Install the Playwright Chromium browser once on a fresh machine:

```bash
pnpm --filter crowdpm-frontend exec playwright install chromium
```

For local debugging with Playwright's UI:

```bash
pnpm --filter crowdpm-frontend test:e2e:ui
```

Playwright traces and screenshots are kept only for failures and are ignored by git.

## Environment

Create `frontend/.env.local` from `frontend/.env.example`.

Required values:

- `VITE_API_BASE`: recommended value is `/api`, which the local Vite dev server proxies to `crowdpmApi` and Firebase Hosting rewrites to the same function in deployed environments. A full Functions base URL also works.
- `VITE_GOOGLE_MAPS_API_KEY`: Google Maps JavaScript API key.
- `VITE_GOOGLE_MAP_ID`: vector map ID for WebGL overlays.
- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Local-only value:

- `VITE_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`

Vite reads environment variables at startup, so restart the dev server after changing `.env.local`.

## Structure

- `src/App.tsx`: top-level navigation, lazy-loaded pages, auth-gated tabs.
- `src/pages/`: map, dashboard, activation, public info, and moderation pages.
- `src/components/`: shared UI components.
- `src/lib/api.ts`: typed API client for `crowdpmApi`.
- `src/lib/firebase.ts`: Firebase app and Auth emulator wiring.
- `src/providers/`: Auth and user settings state.
- `src/types/`: frontend-only type declarations.

Shared API/data types come from `@crowdpm/types`.
