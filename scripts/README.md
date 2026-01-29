# Device Emulator Scripts

Utilities that mimic a hardware device pairing against the local/emulated API.

## Prerequisites

- Run the Firebase Functions emulator (`pnpm dev` from repo root starts everything).
- Ensure `functions/.env.local` and `functions/.secret.local` are populated per the root README.
- Node 24+ installed.

## Start a Pairing Session (auto-poll + register)

```bash
pnpm device:pair -- --key .device-key.json --interval 3
```

- Saves/reuses the Ed25519 keypair at `.device-key.json`.
- Calls `/device/start`, prints `device_code` and `user_code`, then polls `/device/token` and auto-posts `jwk_pub_kl` to `/device/register` when a `registration_token` arrives.
- Default API: `http://localhost:5001/demo-crowdpm/us-central1/crowdpmApi`. Override with `--api <url>`.
- Other flags:
  - `--model <name>` (default `CLI-EMU`)
  - `--version <ver>` (default `0.0.1`)
  - `--nonce <value>` (optional idempotency)
  - `--device-code <code>` (poll an existing session)

## Poll Token Only (for an existing code)

```bash
pnpm device:poll-token -- --device-code <code> --key .device-key.json --interval 3
```

- Uses the same keypair to generate DPoP proofs.
- Stops on success or hard error; respects `authorization_pending`/`slow_down`.

## Notes

- Keep the private key file out of git.
- If you see HTML responses, your `--api` is pointing at Hosting; switch to the Functions base.
