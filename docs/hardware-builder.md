# CrowdPM Hardware Builder Guide

This note targets anyone assembling or flashing third‑party measurement nodes. It explains every HTTPS endpoint a node must call, the payloads that flow through them, and the cryptography the platform enforces. You do **not** need access to the CrowdPM source tree or Firebase console—only the public API base URL (`https://<region>-<project>.cloudfunctions.net/crowdpmApi`) and ingest gateway URL (`https://<region>-<project>.cloudfunctions.net/ingestGateway`).

---

## Lifecycle Overview

1. **Generate DPoP key material** – Each node boots with an Ed25519 key pair (`pub_ke`) used to sign DPoP proofs while it is unregistered.
2. **Start pairing** – Call `POST /device/start` to mint a `device_code`/`user_code` pair and show the `verification_uri` in the device UI.
3. **Human approval** – The node owner visits the activation site, enters the code, reviews metadata, and approves the request.
4. **Poll for authorization** – The device calls `POST /device/token` (with DPoP) until the platform returns a short‑lived `registration_token`.
5. **Register hardware key** – Exchange the registration token at `POST /device/register`, presenting the node’s long‑term Ed25519 key (`jwk_pub_kl`) that will guard ingest traffic. The response returns the canonical `device_id`.
6. **Mint access tokens** – Use `POST /device/access-token` to obtain ten‑minute JWTs (token_type `DPoP`) bound to the ingest key.
7. **Stream measurements** – Submit readings to the HTTPS ingest gateway with the access token + DPoP header. The platform writes Cloud Storage batches and processes them into Firestore measurements through the shared ingest service.

The sections below expand each call so you can wire the firmware without reverse‑engineering the codebase.

---

## Endpoint Reference

> Replace `https://api.example.net` with the actual CrowdPM API host. The same payloads work against the Firebase emulator (`http://127.0.0.1:5001/<project>/<region>/crowdpmApi`).

### 1. `POST /device/start`

Bootstraps a pairing session. No authentication required.

```http
POST /device/start HTTP/1.1
Content-Type: application/json

{
  "pub_ke": "<base64url 32 byte Ed25519 public key>",
  "model": "ACME-AIR-MK1",
  "version": "1.4.2",
  "nonce": "optional-repeatable-device-serial"
}
```

- `pub_ke` is the Ed25519 public key used to sign DPoP proofs while the device is unpaired.
- `nonce` is optional but lets the API deduplicate repeated pair attempts from the same hardware.

Example response:

```json
{
  "device_code": "DEVICE-ABC123",
  "user_code": "ABCD-EFGH-J",
  "verification_uri": "https://crowdpmplatform.web.app/activate",
  "verification_uri_complete": "https://crowdpmplatform.web.app/activate?code=ABCD-EFGH-J",
  "poll_interval": 5,
  "expires_in": 900
}
```

Display the `user_code` and `verification_uri` in the device UI so the owner can finish activation.

### 2. `POST /device/token`

Polls for approval using the same `pub_ke` DPoP key. The `htu` must be the exact origin + path of this endpoint.

```http
POST /device/token HTTP/1.1
Content-Type: application/json
DPoP: <jwt signed with pub_ke>

{ "device_code": "DEVICE-ABC123" }
```

Responses:
- `200 OK` with `{ "registration_token": "<JWT>", "expires_in": 60 }` once the owner approves.
- `400` with `authorization_pending` until approval.
- `400` with `slow_down` if you poll faster than `poll_interval` seconds (the server will tell you the next allowed interval).
- `400` with `expired_token` when the pairing session ages out (start over).

The registration token is a JWT signed by CrowdPM (`iss` = `crowdpm`, `aud` = `device_register`, `kind` = `registration`). Store it briefly—it expires after ~60 seconds by default.

### 3. `POST /device/register`

Trades the registration token for a permanent `device_id` and uploads the ingest key.

```http
POST /device/register HTTP/1.1
Authorization: Bearer <registration_token>
Content-Type: application/json
DPoP: <jwt signed with jwk_pub_kl>

{
  "jwk_pub_kl": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "<base64url public key that will protect ingest traffic>"
  }
}
```

Requirements:
- DPoP proof **must** be signed by the same key you are registering (`jwk_pub_kl`).
- Send the request before the registration token expires.

Successful response:

```json
{
  "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76",
  "jwk_pub_kl": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
  "issued_at": 1731195542
}
```

Record `device_id`; you will move all future API calls to this identifier.

### 4. `POST /device/access-token`

Requests a short‑lived DPoP-bound JWT for ingest or admin scopes.

```http
POST /device/access-token HTTP/1.1
Content-Type: application/json
DPoP: <jwt signed with jwk_pub_kl>

{
  "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76",
  "scope": ["ingest.write"]
}
```

Response:

```json
{
  "token_type": "DPoP",
  "access_token": "<JWT>",
  "expires_in": 600,
  "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76"
}
```

- Default TTL is ten minutes (`DEVICE_ACCESS_TOKEN_TTL_SECONDS`).
- `scope` is optional; today only `ingest.write` is meaningful.
- You can refresh the token at any time; requests are rate-limited (12/min per device).

### 5. `POST https://<region>-<project>.cloudfunctions.net/ingestGateway`

This HTTPS Cloud Function ingests measurement batches. It lives outside the Fastify API but enforces the same DPoP contract.

```http
POST /ingestGateway HTTP/1.1
Authorization: Bearer <access_token>
DPoP: <jwt signed with jwk_pub_kl>
Content-Type: application/json

{
  "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76",
  "points": [
    {
      "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76",
      "pollutant": "pm25",
      "value": 7.2,
      "unit": "µg/m³",
      "lat": 37.78083,
      "lon": -122.40903,
      "altitude": 18.1,
      "precision": 4.0,
      "timestamp": "2024-11-10T03:45:00Z",
      "flags": 0
    }
  ]
}
```

Guidelines:
- `device_id` in the payload (or on each point) must match the identity embedded in the access token.
- Set `Content-Type: application/json`; the API preserves the raw body for auditing.
- Optional query/header `visibility`/`x-batch-visibility` lets trusted devices override the default publication level (`private`, `account`, `public`).
- The gateway returns `202 Accepted` with `{ "batchId": "...", "storagePath": "...", "visibility": "..." }`.

---

## Cryptography Expectations

- **DPoP algorithm** – All proofs must use `EdDSA` with Ed25519 keys. The server rejects other curves/algorithms.
- **Proof claims** – `htm` must match the HTTP method (uppercase), `htu` must equal the absolute URL (scheme, host, path, query), `iat` must be within ±5 seconds of the server clock and not older than 120 seconds, `jti` must be unique per request, and `ath` is required when attesting to an access token hash.
- **Key material** – Provide keys as JWK objects (`kty: "OKP"`, `crv: "Ed25519"`, `x: base64url`). Store private keys in a secure element if possible; CrowdPM never stores your private half.
- **Token chains** – Registration tokens embed the DPoP thumbprint from `/device/start`. Access tokens embed the thumbprint from `/device/register`. The ingest gateway refuses requests if the presented DPoP proof does not match the `cnf.jkt` in the JWT.
- **Clock skew** – Keep your device clock within a few seconds of UTC or use an RTC synced over NTP. Large skews will cause DPoP validation failures.

---

## Error Handling Cheat Sheet

| Endpoint | Condition | Response |
| --- | --- | --- |
| `/device/start` | invalid key/shape | `400 invalid_request` |
| `/device/token` | polling too fast | `400 slow_down` with `poll_interval` |
| `/device/token` | owner hasn’t approved | `400 authorization_pending` |
| `/device/register` | registration token expired | `400 expired_token` |
| `/device/register` | DPoP key mismatch | `401 invalid_token` |
| `/device/access-token` | device revoked/suspended | `403 forbidden` |
| `/ingestGateway` | payload device mismatch | `400 device_id mismatch` |
| `/ingestGateway` | bad DPoP/access token | `401/403` JSON error payload |

All errors now return JSON with a required `error` code and optional `message`.
The `error_description` field is a deprecated compatibility alias for `message`.
Back off and restart the pairing flow when you see persistent `expired_token` or `rate_limited` responses.

---

## Testing Tips

- The web app exposes a **Smoke Test Lab** that exercises the entire pairing + ingest flow. Point your dev hardware at the local emulator to trace every step.
- Use `pnpm --filter crowdpm-functions emulate` to run the API locally; the same endpoints are available at `http://localhost:5001/demo-crowdpm/us-central1/crowdpmApi`.
- Capture and persist the DPoP private keys you burn into each device. You cannot recover them from CrowdPM later.

Ping the platform team if you need additional scopes or batch metadata fields for your hardware. This doc should stay in sync with any API changes—submit a PR if you spot a mismatch.
