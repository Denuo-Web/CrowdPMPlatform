# Functions Tests

Use Vitest for functions tests.

```bash
source ~/.nvm/nvm.sh && nvm use 24
pnpm --filter crowdpm-functions test
```

Test scope:

- `lib/`: pure helper tests with deterministic inputs and outputs.
- `services/`: business logic with mocked Firestore, Auth, Storage, or token dependencies.
- `routes/`: Fastify `inject()` tests for status codes, payload shape, auth guards, and error mapping.

Prefer unit tests over emulator tests. Add emulator-backed tests only when the Firebase runtime behavior is the subject under test.
