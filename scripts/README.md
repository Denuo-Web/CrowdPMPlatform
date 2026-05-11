# Scripts

Scripts in this directory emulate sensor devices, seed local smoke data, and support deployed-device checks. Run them from the repository root after selecting Node 24.

```bash
source ~/.nvm/nvm.sh && nvm use 24
```

## Local Device Emulator

The main emulator is exposed through the root script:

```bash
pnpm device:pair -- --help
```

Default local targets:

- API: `http://localhost:5001/crowdpm-local/us-central1/crowdpmApi`
- Ingest: `http://localhost:5001/crowdpm-local/us-central1/ingestGateway`
- Device ID file: `.device-id`

Start the local stack first:

```bash
pnpm dev
```

Pair a device:

```bash
pnpm device:pair -- --key .device-key.json --interval 3
```

The script starts `/device/start`, prints the user code, polls `/device/token`, registers the key after approval, and writes the registered device ID to `.device-id`.

Send ingest with the saved key and device ID:

```bash
pnpm device:pair -- --mode ingest --key .device-key.json
```

Useful options:

- `--api <url>`: override the API base.
- `--ingest-url <url>`: override the ingest gateway URL.
- `--device-id <id>`: override the saved device ID.
- `--device-id-file <path>`: change where the registered ID is read or written.
- `--batches <n>`: send multiple batches.
- `--minutes <n>`: points per batch, one point per minute.
- `--start-value <n>` and `--value-step <n>`: shape PM2.5 values.
- `--lat <n>`, `--lon <n>`, `--altitude <n>`, `--precision <n>`: shape location metadata.

## Local OSU Bike Simulation

Seeds multiple public smoke-test batches through `/v1/admin/ingest-smoke-test`.

```bash
pnpm device:simulate:osu -- --count 20 --minutes 36
```

Defaults sign in to the Auth emulator as `smoke-tester@crowdpm.dev` with password `crowdpm-dev`.

Useful options:

- `--prefix <text>`
- `--start-index <n>`
- `--delay-ms <n>`
- `--visibility <public|private>`
- `--api <url>`
- `--auth-url <url>`

## Deployed Device Helpers

Register or refresh a deployed test device:

```bash
scripts/deployed-device-registration.sh
```

Send one deployed ingest batch with the saved device artifacts:

```bash
scripts/deployed-device-send-batch.sh [batch.json]
```

Common environment overrides:

- `CROWDPM_API_BASE`
- `CROWDPM_INGEST_URL`
- `CROWDPM_KEY_FILE`
- `CROWDPM_DEVICE_ID_FILE`
- `CROWDPM_ACCESS_TOKEN_FILE`
- `CROWDPM_BATCH_VISIBILITY`

Keep generated key, device ID, and access-token files out of git. They are already ignored by `.gitignore`.

## Troubleshooting

- HTML response from an API call usually means the API base points at Firebase Hosting instead of the Functions URL.
- `invalid_token` during ingest usually means the saved key does not match the registered device.
- `authorization_pending` during pairing means the owner has not approved the user code yet.
