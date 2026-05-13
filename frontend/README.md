# Frontend

React 19 + Vite client for the CrowdPM map, activation flow, user dashboard, and moderation UI.

## Commands

Run from the repository root:

```bash
pnpm --filter crowdpm-frontend dev
pnpm --filter crowdpm-frontend build
pnpm --filter crowdpm-frontend preview
```

`pnpm dev` at the repository root starts this app together with the Firebase emulators and functions build watcher.

## Environment

Create `frontend/.env.local` from `frontend/.env.example`.

Required values:

- `VITE_API_BASE`: `crowdpmApi` Functions base URL, not the Hosting URL.
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
