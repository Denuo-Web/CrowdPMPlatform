# Hardware Builder Guide

This guide is for firmware or gateway code that sends PM2.5 measurements to CrowdPM. You only need the deployed API base, the ingest gateway URL, and a way for the device owner to open the activation page.

## Base URLs

Local emulator:

```text
API_BASE=http://127.0.0.1:5001/crowdpm-local/us-central1/crowdpmApi
INGEST_URL=http://127.0.0.1:5001/crowdpm-local/us-central1/ingestGateway
ACTIVATION_URL=http://localhost:5173/activate
```

Deployed environment:

```text
API_BASE=https://us-central1-<firebase-project-id>.cloudfunctions.net/crowdpmApi
INGEST_URL=https://us-central1-<firebase-project-id>.cloudfunctions.net/ingestGateway
ACTIVATION_URL=https://<hosting-site>/activate
```

## Device Lifecycle

1. Generate an Ed25519 key pair for pairing (`Ke`).
2. Call `POST /device/start` with `Ke` and hardware metadata.
3. Show the returned `user_code` and activation URL to the owner.
4. Poll `POST /device/token` with DPoP proofs signed by `Ke`.
5. After approval, call `POST /device/register` and register the long-term ingest key (`Kl`).
6. Call `POST /device/access-token` with DPoP proofs signed by `Kl`.
7. Send measurement batches to `INGEST_URL` with the access token and a DPoP proof signed by `Kl`.

CrowdPM stores accepted batches as gzipped JSON in Cloud Storage and writes one Firestore metadata document for each batch.

## Endpoint Contract

### `POST /device/start`

Starts a pairing session. No bearer token is required.

```http
POST /device/start HTTP/1.1
Content-Type: application/json

{
  "pub_ke": "<base64url Ed25519 public key>",
  "model": "ACME-AIR-MK1",
  "version": "1.4.2",
  "nonce": "optional-device-serial"
}
```

Successful response:

```json
{
  "device_code": "DEVICE-ABC123",
  "user_code": "ABCD-EFGH-J",
  "verification_uri": "https://<hosting-site>/activate",
  "verification_uri_complete": "https://<hosting-site>/activate?code=ABCD-EFGH-J",
  "poll_interval": 5,
  "expires_in": 900
}
```

Display `user_code` and `verification_uri` until activation completes or expires.

### `POST /device/token`

Polls for owner approval. Include a DPoP proof signed by the pairing key (`Ke`).

```http
POST /device/token HTTP/1.1
Content-Type: application/json
DPoP: <jwt signed by Ke>

{ "device_code": "DEVICE-ABC123" }
```

Expected responses:

- `200 OK`: returns `{ "registration_token": "<jwt>", "expires_in": 60 }`.
- `400 authorization_pending`: owner has not approved yet.
- `400 slow_down`: polling too quickly; respect the returned interval.
- `400 expired_token`: start pairing again.

### `POST /device/register`

Registers the long-term ingest key (`Kl`) and returns the canonical `device_id`.

```http
POST /device/register HTTP/1.1
Authorization: Bearer <registration_token>
Content-Type: application/json
DPoP: <jwt signed by Kl>

{
  "jwk_pub_kl": {
    "kty": "OKP",
    "crv": "Ed25519",
    "x": "<base64url Ed25519 public key>"
  }
}
```

Successful response:

```json
{
  "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76",
  "jwk_pub_kl": { "kty": "OKP", "crv": "Ed25519", "x": "..." },
  "issued_at": 1731195542
}
```

Persist `device_id` and the private half of `Kl`. CrowdPM cannot recover the private key for you.

### `POST /device/access-token`

Mints a short-lived DPoP-bound access token for ingest.

```http
POST /device/access-token HTTP/1.1
Content-Type: application/json
DPoP: <jwt signed by Kl>

{
  "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76",
  "scope": ["ingest.write"]
}
```

Successful response:

```json
{
  "token_type": "DPoP",
  "access_token": "<jwt>",
  "expires_in": 600,
  "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76"
}
```

Request a fresh token before expiry. The default lifetime is 10 minutes.

### `POST /ingestGateway`

Submits a measurement batch. This is the separate ingest HTTPS Function, not a path under `crowdpmApi`.

```http
POST /ingestGateway HTTP/1.1
Authorization: Bearer <access_token>
DPoP: <jwt signed by Kl>
Content-Type: application/json

{
  "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76",
  "points": [
    {
      "device_id": "dev_01HZZ1A8S9G1DWW2FWP6C2JJ76",
      "pollutant": "pm25",
      "value": 7.2,
      "unit": "ug/m3",
      "lat": 37.78083,
      "lon": -122.40903,
      "altitude": 18.1,
      "precision": 4.0,
      "timestamp": "2026-05-11T03:45:00Z",
      "flags": 0
    }
  ]
}
```

Rules:

- Root `device_id` or point-level `device_id` must match the access token.
- `points` must contain at least one item.
- `visibility` may be set to `public` or `private` using the query string or `x-batch-visibility` header.
- Successful ingest returns `202 Accepted` with `batchId`, `deviceId`, `storagePath`, and `visibility`.

## DPoP Requirements

- Use Ed25519 keys and `alg: "EdDSA"`.
- Include the public JWK in the DPoP header.
- Set `htm` to the uppercase HTTP method.
- Set `htu` to the absolute URL expected by the server.
- Set `iat` close to current UTC time; the server allows a small clock skew.
- Set a unique `jti` per request.

Clock drift is the most common firmware-side failure. Keep device time synchronized before pairing or ingesting.

## Error Handling

All API errors are JSON with an `error` field and optional `message`.

| Endpoint | Common condition | Response |
| --- | --- | --- |
| `/device/start` | Bad key or malformed body | `400 invalid_request` |
| `/device/token` | Not approved yet | `400 authorization_pending` |
| `/device/token` | Polling too quickly | `400 slow_down` |
| `/device/register` | Expired registration token | `400 expired_token` |
| `/device/register` | DPoP key mismatch | `401 invalid_token` |
| `/device/access-token` | Suspended or revoked device | `403 forbidden` |
| `/ingestGateway` | Payload token mismatch | `400 device_id_mismatch` |
| `/ingestGateway` | Bad token or DPoP proof | `401 invalid_token` |

Use `scripts/README.md` for local emulator scripts that exercise the same flow.
