# Device Emulator Scripts

Utilities that mimic a hardware device pairing against the local/emulated API.

## Prerequisites

- Run the Firebase Functions emulator (`pnpm dev` from repo root starts everything).
- Ensure `functions/.env.local` and `functions/.secret.local` are populated per the root README.
- Node 24+ installed.

### Local emulator configuration (required)

Create the secret file with a real Ed25519 PKCS8 private key (note the real newlines, not `\n` escapes):

```bash
tmp_key="$(mktemp -t crowdpm-device-key.XXXXXX)"
openssl genpkey -algorithm ED25519 -out "$tmp_key"
printf 'DEVICE_TOKEN_PRIVATE_KEY="%s"\n' "$(cat "$tmp_key")" > functions/.secret.local
rm -f "$tmp_key"
```

Copy the same `DEVICE_TOKEN_PRIVATE_KEY="..."` line into `functions/.env.local`.

Set activation URLs in `functions/.env.local` so pairing links stay local:

```bash
DEVICE_VERIFICATION_URI=http://localhost:5173/activate
DEVICE_ACTIVATION_URL=http://localhost:5173/activate
```

## Start a Pairing Session (auto-poll + register)

```bash
pnpm device:pair -- --key .device-key.json --interval 3
```

- Saves/reuses the Ed25519 keypair at `.device-key.json`.
- Calls `/device/start`, prints `device_code` and `user_code`, then polls `/device/token` and auto-posts `jwk_pub_kl` to `/device/register` when a `registration_token` arrives.
- Persists the registered `device_id` to `.device-id` (override with `--device-id-file`).
- Default API: `http://localhost:5001/demo-crowdpm/us-central1/crowdpmApi`. Override with `--api <url>`.
- Other flags:
  - `--model <name>` (default `CLI-EMU`)
  - `--version <ver>` (default `0.0.1`)
  - `--nonce <value>` (optional idempotency)
  - `--device-code <code>` (poll an existing session)

## Send ingest batches without a device code

After pairing once, you can send batches without re-pairing or pasting a device id:

```bash
pnpm device:pair -- --mode ingest --key .device-key.json --minutes 5
```

- Uses the `device_id` saved in `.device-id` (or whatever you passed to `--device-id-file`).
- Add `--device-id <id>` if you want to override the stored value.

## Advanced

### Poll Token Only (for an existing code)

```bash
pnpm device:poll-token -- --device-code <code> --key .device-key.json --interval 3
```

- Uses the same keypair to generate DPoP proofs.
- Stops on success or hard error; respects `authorization_pending`/`slow_down`.

## Notes

- Keep the private key file out of git.
- If you see HTML responses, your `--api` is pointing at Hosting; switch to the Functions base.
