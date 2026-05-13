# Shared Types

Workspace package published internally as `@crowdpm/types`. It contains TypeScript contracts shared by the frontend and functions packages.

## Commands

```bash
pnpm --filter @crowdpm/types build
```

The root build also compiles this package:

```bash
pnpm build
```

## Exports

The package exports:

- Batch visibility and moderation types.
- Device, measurement, batch, public batch, admin, and user-settings contracts.
- Ingest payload/result types.
- Timestamp normalization helpers.

Keep cross-package API shapes here when both frontend and functions need the same contract. Keep package-local implementation details in their owning package.
