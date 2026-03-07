#!/usr/bin/env bash

set -euo pipefail

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
  # Match the repo's required runtime before invoking node helpers.
  # shellcheck disable=SC1090
  source "${HOME}/.nvm/nvm.sh"
  nvm use 24 >/dev/null 2>&1 || {
    nvm install 24 >/dev/null
    nvm use 24 >/dev/null
  }
fi

API_BASE="${CROWDPM_API_BASE:-https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi}"
ACTIVATION_URL="${CROWDPM_ACTIVATION_URL:-https://crowdpmplatform.web.app/activate}"
FIREBASE_API_KEY="${CROWDPM_FIREBASE_API_KEY:-AIzaSyCy1MRJVmBCHQoIoSNXTpaMzjmKE3ME_2I}"
AUTH_URL="${CROWDPM_AUTH_URL:-https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}}"
KEY_FILE="${CROWDPM_KEY_FILE:-.crowdpm-live-device-key.json}"
DEVICE_ID_FILE="${CROWDPM_DEVICE_ID_FILE:-.crowdpm-live-device-id}"
ACCESS_TOKEN_FILE="${CROWDPM_ACCESS_TOKEN_FILE:-.crowdpm-live-access-token}"
MODEL="${CROWDPM_MODEL:-curl-live-node}"
VERSION="${CROWDPM_VERSION:-0.0.1}"
NONCE="${CROWDPM_NONCE:-curl-live-$(date +%s)}"
AUTO_AUTHORIZE="${CROWDPM_AUTO_AUTHORIZE:-0}"
OPEN_BROWSER="${CROWDPM_OPEN_BROWSER:-0}"
SEND_INGEST="${CROWDPM_SEND_INGEST:-0}"
EMAIL="${CROWDPM_EMAIL:-}"
PASSWORD="${CROWDPM_PASSWORD:-}"
SCOPE="${CROWDPM_SCOPE:-ingest.write}"
PAIR_TIMEOUT_SECONDS="${CROWDPM_PAIR_TIMEOUT_SECONDS:-900}"

TMP_DIR="$(mktemp -d -t crowdpm-live-device.XXXXXX)"
trap 'rm -rf "${TMP_DIR}"' EXIT

usage() {
  cat <<'EOF'
Usage:
  scripts/live-device-registration.sh

Defaults target the live CrowdPM deployment:
  API base: https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi
  Activation UI: https://crowdpmplatform.web.app/activate

Environment variables:
  CROWDPM_API_BASE             Override the live API base.
  CROWDPM_ACTIVATION_URL       Override the activation UI URL.
  CROWDPM_FIREBASE_API_KEY     Override the Firebase Web API key used for auth.
  CROWDPM_AUTH_URL             Override the Firebase email/password sign-in endpoint.
  CROWDPM_KEY_FILE             Path to the Ed25519 JWK pair file.
  CROWDPM_DEVICE_ID_FILE       Path where the device_id is persisted.
  CROWDPM_ACCESS_TOKEN_FILE    Path where the access token is persisted.
  CROWDPM_MODEL                Model sent to /device/start.
  CROWDPM_VERSION              Firmware version sent to /device/start.
  CROWDPM_NONCE                Optional pairing nonce/serial.
  CROWDPM_AUTO_AUTHORIZE=1     Use the activation API directly instead of browser/manual approval.
  CROWDPM_EMAIL                Live CrowdPM account email for auto-authorization.
  CROWDPM_PASSWORD             Live CrowdPM account password for auto-authorization.
  CROWDPM_OPEN_BROWSER=1       Open the activation URL automatically when possible.
  CROWDPM_SEND_INGEST=1        Push one sample ingest batch after registration.
  CROWDPM_SCOPE                Scope requested from /device/access-token. Default: ingest.write
  CROWDPM_PAIR_TIMEOUT_SECONDS Overall polling timeout. Default: 900

Notes:
  - Auto-authorization only works for accounts that can complete sign-in with a single
    email/password step. If your account enforces MFA, use the browser approval path.
  - The current server implementation validates /device/register against the pairing key
    from /device/start. This script follows the running code path.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

require_command curl
require_command node

endpoint_url() {
  local path="$1"
  printf '%s/%s' "${API_BASE%/}" "${path#/}"
}

derive_ingest_url() {
  node --input-type=module - "${API_BASE}" <<'NODE'
const [apiBase] = process.argv.slice(2);
const url = new URL(apiBase);
url.pathname = url.pathname.replace(/crowdpmApi\/?$/u, "ingestGateway");
process.stdout.write(url.toString());
NODE
}

INGEST_URL="${CROWDPM_INGEST_URL:-$(derive_ingest_url)}"

json_get_file() {
  local file="$1"
  local field="$2"

  node --input-type=module - "${file}" "${field}" <<'NODE'
import { readFileSync } from "node:fs";

const [file, field] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, "utf8"));
let value = data;
for (const part of field.split(".")) {
  value = value?.[part];
}
if (value === undefined || value === null) {
  process.exit(2);
}
process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
NODE
}

json_error_or_message() {
  local file="$1"

  node --input-type=module - "${file}" <<'NODE'
import { readFileSync } from "node:fs";

const [file] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file, "utf8"));
const msg = typeof data.error === "string"
  ? data.error
  : typeof data.message === "string"
    ? data.message
    : JSON.stringify(data);
process.stdout.write(msg);
NODE
}

ensure_keypair() {
  local key_file="$1"

  node --input-type=module - "${key_file}" <<'NODE'
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";

const [keyFile] = process.argv.slice(2);

function isPublicJwk(value) {
  return Boolean(value && value.kty === "OKP" && value.crv === "Ed25519" && typeof value.x === "string");
}

function isPrivateJwk(value) {
  return isPublicJwk(value) && typeof value.d === "string";
}

if (existsSync(keyFile)) {
  const parsed = JSON.parse(readFileSync(keyFile, "utf8"));
  if (!isPublicJwk(parsed.publicJwk) || !isPrivateJwk(parsed.privateJwk)) {
    throw new Error(`Key file at ${keyFile} is not an Ed25519 JWK pair`);
  }
  process.exit(0);
}

const kp = generateKeyPairSync("ed25519");
writeFileSync(keyFile, JSON.stringify({
  publicJwk: kp.publicKey.export({ format: "jwk" }),
  privateJwk: kp.privateKey.export({ format: "jwk" }),
}, null, 2));
NODE
}

key_field() {
  local key_file="$1"
  local field="$2"

  node --input-type=module - "${key_file}" "${field}" <<'NODE'
import { readFileSync } from "node:fs";

const [keyFile, field] = process.argv.slice(2);
const data = JSON.parse(readFileSync(keyFile, "utf8"));
let value = data;
for (const part of field.split(".")) {
  value = value?.[part];
}
if (value === undefined || value === null) {
  process.exit(2);
}
process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));
NODE
}

derive_htu() {
  local target_url="$1"
  local base_url="$2"

  node --input-type=module - "${target_url}" "${base_url}" <<'NODE'
const [targetUrlRaw, baseUrlRaw] = process.argv.slice(2);
const target = new URL(targetUrlRaw);
let basePath = "";
try {
  basePath = new URL(baseUrlRaw).pathname.replace(/\/$/u, "");
}
catch {
  basePath = "";
}
const trimmedPath = target.pathname.startsWith(basePath)
  ? (target.pathname.slice(basePath.length) || "/")
  : target.pathname;
process.stdout.write(`${target.protocol}//${target.host}${trimmedPath}`);
NODE
}

url_proto() {
  local raw_url="$1"
  node --input-type=module - "${raw_url}" <<'NODE'
const [rawUrl] = process.argv.slice(2);
process.stdout.write(new URL(rawUrl).protocol.replace(":", ""));
NODE
}

make_dpop() {
  local htu="$1"
  local method="${2:-POST}"
  local key_file="${3:-${KEY_FILE}}"

  node --input-type=module - "${htu}" "${method}" "${key_file}" <<'NODE'
import { readFileSync } from "node:fs";
import { createPrivateKey, randomUUID, sign as edSign } from "node:crypto";

const [htu, method, keyFile] = process.argv.slice(2);
const { publicJwk, privateJwk } = JSON.parse(readFileSync(keyFile, "utf8"));

const base64url = (value) => Buffer.from(
  Buffer.isBuffer(value)
    ? value
    : (typeof value === "string" ? value : JSON.stringify(value))
)
  .toString("base64")
  .replace(/=+$/u, "")
  .replace(/\+/gu, "-")
  .replace(/\//gu, "_");

const header = {
  alg: "EdDSA",
  typ: "dpop+jwt",
  jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x },
};

const payload = {
  htm: method.toUpperCase(),
  htu,
  iat: Math.floor(Date.now() / 1000),
  jti: randomUUID(),
};

const signingInput = `${base64url(header)}.${base64url(payload)}`;
const key = createPrivateKey({ format: "jwk", key: privateJwk });
const signature = edSign(null, Buffer.from(signingInput), key);

process.stdout.write(`${signingInput}.${base64url(signature)}`);
NODE
}

http_request() {
  local method="$1"
  local url="$2"
  local body="$3"
  local output_file="$4"
  shift 4

  local headers=()
  local header
  for header in "$@"; do
    headers+=(-H "${header}")
  done

  if [[ -n "${body}" ]]; then
    curl -sS -o "${output_file}" -w '%{http_code}' -X "${method}" "${url}" "${headers[@]}" --data "${body}"
  else
    curl -sS -o "${output_file}" -w '%{http_code}' -X "${method}" "${url}" "${headers[@]}"
  fi
}

pretty_print_file() {
  local file="$1"
  if command -v jq >/dev/null 2>&1; then
    jq . "${file}" 2>/dev/null || cat "${file}"
  else
    cat "${file}"
  fi
}

maybe_open_browser() {
  local url="$1"
  [[ "${OPEN_BROWSER}" == "1" ]] || return 0

  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "${url}" >/dev/null 2>&1 || true
    return 0
  fi

  if command -v open >/dev/null 2>&1; then
    open "${url}" >/dev/null 2>&1 || true
  fi
}

print_section() {
  printf '\n== %s ==\n' "$1"
}

build_start_body() {
  node --input-type=module - "${PUB_KE}" "${MODEL}" "${VERSION}" "${NONCE}" <<'NODE'
const [pubKe, model, version, nonce] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  pub_ke: pubKe,
  model,
  version,
  nonce,
}));
NODE
}

build_auth_body() {
  node --input-type=module - "${EMAIL}" "${PASSWORD}" <<'NODE'
const [email, password] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  email,
  password,
  returnSecureToken: true,
}));
NODE
}

build_authorize_body() {
  node --input-type=module - "${USER_CODE}" <<'NODE'
const [userCode] = process.argv.slice(2);
process.stdout.write(JSON.stringify({ user_code: userCode }));
NODE
}

build_token_body() {
  node --input-type=module - "${DEVICE_CODE}" <<'NODE'
const [deviceCode] = process.argv.slice(2);
process.stdout.write(JSON.stringify({ device_code: deviceCode }));
NODE
}

build_access_body() {
  node --input-type=module - "${DEVICE_ID}" "${SCOPE}" <<'NODE'
const [deviceId, scope] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  device_id: deviceId,
  scope: [scope],
}));
NODE
}

build_ingest_body() {
  node --input-type=module - "${DEVICE_ID}" "${INGEST_TIMESTAMP}" <<'NODE'
const [deviceId, timestamp] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  device_id: deviceId,
  points: [{
    device_id: deviceId,
    pollutant: "pm25",
    value: 12.4,
    unit: "µg/m³",
    lat: 45.5231,
    lon: -122.6765,
    timestamp,
    precision: 6,
    altitude: 12,
  }],
}));
NODE
}

ensure_keypair "${KEY_FILE}"
PUB_KE="$(key_field "${KEY_FILE}" "publicJwk.x")"
PUB_KL_JSON="$(key_field "${KEY_FILE}" "publicJwk")"

print_section "Live Target"
echo "API base: ${API_BASE}"
echo "Activation UI: ${ACTIVATION_URL}"
echo "Ingest URL: ${INGEST_URL}"
echo "Key file: ${KEY_FILE}"

START_URL="$(endpoint_url "/device/start")"
START_BODY="$(build_start_body)"
START_OUT="${TMP_DIR}/start.json"

print_section "Start Pairing"
START_STATUS="$(http_request "POST" "${START_URL}" "${START_BODY}" "${START_OUT}" \
  "content-type: application/json")"

if [[ "${START_STATUS}" != "200" ]]; then
  echo "Pairing start failed with HTTP ${START_STATUS}" >&2
  pretty_print_file "${START_OUT}" >&2
  exit 1
fi

DEVICE_CODE="$(json_get_file "${START_OUT}" "device_code")"
USER_CODE="$(json_get_file "${START_OUT}" "user_code")"
VERIFICATION_URI="$(json_get_file "${START_OUT}" "verification_uri" || printf '%s' "${ACTIVATION_URL}")"
VERIFICATION_URI_COMPLETE="$(json_get_file "${START_OUT}" "verification_uri_complete" || printf '%s?code=%s' "${ACTIVATION_URL}" "${USER_CODE}")"
POLL_INTERVAL="$(json_get_file "${START_OUT}" "poll_interval" || echo 5)"
EXPIRES_IN="$(json_get_file "${START_OUT}" "expires_in" || echo "${PAIR_TIMEOUT_SECONDS}")"

echo "device_code: ${DEVICE_CODE}"
echo "user_code: ${USER_CODE}"
echo "verification_uri: ${VERIFICATION_URI}"
echo "verification_uri_complete: ${VERIFICATION_URI_COMPLETE}"
echo "poll_interval: ${POLL_INTERVAL}s"
echo "expires_in: ${EXPIRES_IN}s"

maybe_open_browser "${VERIFICATION_URI_COMPLETE}"

if [[ "${AUTO_AUTHORIZE}" == "1" ]]; then
  print_section "Auto Authorize"

  if [[ -z "${EMAIL}" || -z "${PASSWORD}" ]]; then
    echo "CROWDPM_AUTO_AUTHORIZE=1 requires CROWDPM_EMAIL and CROWDPM_PASSWORD." >&2
    exit 1
  fi

  AUTH_OUT="${TMP_DIR}/auth.json"
  AUTH_BODY="$(build_auth_body)"
  AUTH_STATUS="$(http_request "POST" "${AUTH_URL}" "${AUTH_BODY}" "${AUTH_OUT}" \
    "content-type: application/json")"

  if [[ "${AUTH_STATUS}" != "200" ]]; then
    echo "Live sign-in failed with HTTP ${AUTH_STATUS}" >&2
    pretty_print_file "${AUTH_OUT}" >&2
    echo "If this account requires MFA, switch to browser approval instead." >&2
    exit 1
  fi

  ID_TOKEN="$(json_get_file "${AUTH_OUT}" "idToken")"

  LOOKUP_URL="$(endpoint_url "/v1/device-activation?user_code=${USER_CODE}")"
  LOOKUP_OUT="${TMP_DIR}/activation-get.json"
  LOOKUP_STATUS="$(http_request "GET" "${LOOKUP_URL}" "" "${LOOKUP_OUT}" \
    "Authorization: Bearer ${ID_TOKEN}")"

  if [[ "${LOOKUP_STATUS}" != "200" ]]; then
    echo "Activation lookup failed with HTTP ${LOOKUP_STATUS}" >&2
    pretty_print_file "${LOOKUP_OUT}" >&2
    exit 1
  fi

  echo "Activation session:"
  pretty_print_file "${LOOKUP_OUT}"

  AUTHORIZE_URL="$(endpoint_url "/v1/device-activation/authorize")"
  AUTHORIZE_OUT="${TMP_DIR}/activation-authorize.json"
  AUTHORIZE_BODY="$(build_authorize_body)"
  AUTHORIZE_STATUS="$(http_request "POST" "${AUTHORIZE_URL}" "${AUTHORIZE_BODY}" "${AUTHORIZE_OUT}" \
    "content-type: application/json" \
    "Authorization: Bearer ${ID_TOKEN}")"

  if [[ "${AUTHORIZE_STATUS}" != "200" ]]; then
    echo "Activation authorize failed with HTTP ${AUTHORIZE_STATUS}" >&2
    pretty_print_file "${AUTHORIZE_OUT}" >&2
    echo "If the response mentions MFA or recent authentication, use browser approval." >&2
    exit 1
  fi

  echo "Authorization complete."
else
  print_section "Manual Approval"
  echo "Open this URL and approve the device:"
  echo "${VERIFICATION_URI_COMPLETE}"
  echo "The script will keep polling while you approve it in the browser."
fi

TOKEN_URL="$(endpoint_url "/device/token")"
TOKEN_HTU="$(derive_htu "${TOKEN_URL}" "${API_BASE}")"
TOKEN_PROTO="$(url_proto "${TOKEN_URL}")"
TOKEN_OUT="${TMP_DIR}/token.json"

POLL_SECONDS="${CROWDPM_POLL_INTERVAL_SECONDS:-${POLL_INTERVAL}}"
DEADLINE="$(( $(date +%s) + PAIR_TIMEOUT_SECONDS ))"
REGISTRATION_TOKEN=""

print_section "Poll For Registration Token"
while :; do
  if (( "$(date +%s)" >= DEADLINE )); then
    echo "Timed out waiting for device authorization." >&2
    exit 1
  fi

  TOKEN_BODY="$(build_token_body)"
  TOKEN_STATUS="$(http_request "POST" "${TOKEN_URL}" "${TOKEN_BODY}" "${TOKEN_OUT}" \
    "content-type: application/json" \
    "x-forwarded-proto: ${TOKEN_PROTO}" \
    "DPoP: $(make_dpop "${TOKEN_HTU}" "POST" "${KEY_FILE}")")"

  if [[ "${TOKEN_STATUS}" == "200" ]]; then
    REGISTRATION_TOKEN="$(json_get_file "${TOKEN_OUT}" "registration_token")"
    TOKEN_TTL="$(json_get_file "${TOKEN_OUT}" "expires_in" || echo 60)"
    echo "registration_token received (expires_in=${TOKEN_TTL}s)"
    break
  fi

  if [[ "${TOKEN_STATUS}" == "400" ]]; then
    TOKEN_ERROR="$(json_error_or_message "${TOKEN_OUT}")"
    case "${TOKEN_ERROR}" in
      authorization_pending)
        echo "authorization_pending; waiting ${POLL_SECONDS}s"
        sleep "${POLL_SECONDS}"
        ;;
      slow_down)
        NEXT_INTERVAL="$(json_get_file "${TOKEN_OUT}" "poll_interval" || echo "${POLL_SECONDS}")"
        POLL_SECONDS="${NEXT_INTERVAL}"
        echo "slow_down; next poll_interval=${POLL_SECONDS}s"
        sleep "${POLL_SECONDS}"
        ;;
      expired_token)
        echo "Pairing session expired before approval." >&2
        pretty_print_file "${TOKEN_OUT}" >&2
        exit 1
        ;;
      *)
        echo "Polling failed with HTTP ${TOKEN_STATUS}" >&2
        pretty_print_file "${TOKEN_OUT}" >&2
        exit 1
        ;;
    esac
    continue
  fi

  echo "Polling failed with HTTP ${TOKEN_STATUS}" >&2
  pretty_print_file "${TOKEN_OUT}" >&2
  exit 1
done

REGISTER_URL="$(endpoint_url "/device/register")"
REGISTER_HTU="$(derive_htu "${REGISTER_URL}" "${API_BASE}")"
REGISTER_PROTO="$(url_proto "${REGISTER_URL}")"
REGISTER_OUT="${TMP_DIR}/register.json"
REGISTER_BODY="$(printf '{"jwk_pub_kl":%s}' "${PUB_KL_JSON}")"

print_section "Register Device"
REGISTER_STATUS="$(http_request "POST" "${REGISTER_URL}" "${REGISTER_BODY}" "${REGISTER_OUT}" \
  "Authorization: Bearer ${REGISTRATION_TOKEN}" \
  "content-type: application/json" \
  "x-forwarded-proto: ${REGISTER_PROTO}" \
  "DPoP: $(make_dpop "${REGISTER_HTU}" "POST" "${KEY_FILE}")")"

if [[ "${REGISTER_STATUS}" != "200" ]]; then
  echo "Device registration failed with HTTP ${REGISTER_STATUS}" >&2
  pretty_print_file "${REGISTER_OUT}" >&2
  exit 1
fi

DEVICE_ID="$(json_get_file "${REGISTER_OUT}" "device_id")"
printf '%s\n' "${DEVICE_ID}" > "${DEVICE_ID_FILE}"
echo "device_id: ${DEVICE_ID}"
echo "saved: ${DEVICE_ID_FILE}"

ACCESS_URL="$(endpoint_url "/device/access-token")"
ACCESS_HTU="$(derive_htu "${ACCESS_URL}" "${API_BASE}")"
ACCESS_PROTO="$(url_proto "${ACCESS_URL}")"
ACCESS_OUT="${TMP_DIR}/access.json"
ACCESS_BODY="$(build_access_body)"

print_section "Mint Access Token"
ACCESS_STATUS="$(http_request "POST" "${ACCESS_URL}" "${ACCESS_BODY}" "${ACCESS_OUT}" \
  "content-type: application/json" \
  "x-forwarded-proto: ${ACCESS_PROTO}" \
  "DPoP: $(make_dpop "${ACCESS_HTU}" "POST" "${KEY_FILE}")")"

if [[ "${ACCESS_STATUS}" != "200" ]]; then
  echo "Access token request failed with HTTP ${ACCESS_STATUS}" >&2
  pretty_print_file "${ACCESS_OUT}" >&2
  exit 1
fi

ACCESS_TOKEN="$(json_get_file "${ACCESS_OUT}" "access_token")"
ACCESS_TOKEN_TTL="$(json_get_file "${ACCESS_OUT}" "expires_in" || echo 600)"
printf '%s\n' "${ACCESS_TOKEN}" > "${ACCESS_TOKEN_FILE}"
echo "access_token saved: ${ACCESS_TOKEN_FILE}"
echo "access_token expires_in: ${ACCESS_TOKEN_TTL}s"

if [[ "${SEND_INGEST}" == "1" ]]; then
  INGEST_PROTO="$(url_proto "${INGEST_URL}")"
  INGEST_HTU="$(derive_htu "${INGEST_URL}" "${INGEST_URL}")"
  INGEST_OUT="${TMP_DIR}/ingest.json"
  INGEST_TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  INGEST_BODY="$(build_ingest_body)"

  print_section "Send Sample Ingest"
  INGEST_STATUS="$(http_request "POST" "${INGEST_URL}" "${INGEST_BODY}" "${INGEST_OUT}" \
    "Authorization: Bearer ${ACCESS_TOKEN}" \
    "content-type: application/json" \
    "x-forwarded-proto: ${INGEST_PROTO}" \
    "DPoP: $(make_dpop "${INGEST_HTU}" "POST" "${KEY_FILE}")")"

  if [[ "${INGEST_STATUS}" != "202" ]]; then
    echo "Sample ingest failed with HTTP ${INGEST_STATUS}" >&2
    pretty_print_file "${INGEST_OUT}" >&2
    exit 1
  fi

  pretty_print_file "${INGEST_OUT}"
fi

print_section "Done"
echo "device_id=${DEVICE_ID}"
echo "device_id_file=${DEVICE_ID_FILE}"
echo "access_token_file=${ACCESS_TOKEN_FILE}"
echo "key_file=${KEY_FILE}"
