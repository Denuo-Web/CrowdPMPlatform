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
KEY_FILE="${CROWDPM_KEY_FILE:-.crowdpm-live-device-key.json}"
DEVICE_ID_FILE="${CROWDPM_DEVICE_ID_FILE:-.crowdpm-live-device-id}"
ACCESS_TOKEN_FILE="${CROWDPM_ACCESS_TOKEN_FILE:-.crowdpm-live-access-token}"
SCOPE="${CROWDPM_SCOPE:-ingest.write}"
DEVICE_ID_OVERRIDE="${CROWDPM_DEVICE_ID:-}"
ACCESS_TOKEN_OVERRIDE="${CROWDPM_ACCESS_TOKEN:-}"
BATCH_FILE_ENV="${CROWDPM_BATCH_FILE:-}"
BATCH_JSON="${CROWDPM_BATCH_JSON:-}"
BATCH_VISIBILITY="${CROWDPM_BATCH_VISIBILITY:-}"
DEFAULT_TIMESTAMP="${CROWDPM_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
SAMPLE_POLLUTANT="${CROWDPM_POLLUTANT:-pm25}"
SAMPLE_VALUE="${CROWDPM_VALUE:-12.4}"
SAMPLE_UNIT="${CROWDPM_UNIT:-}"
SAMPLE_LAT="${CROWDPM_LAT:-45.5231}"
SAMPLE_LON="${CROWDPM_LON:--122.6765}"
SAMPLE_ALTITUDE="${CROWDPM_ALTITUDE:-12}"
SAMPLE_PRECISION="${CROWDPM_PRECISION:-6}"
SAMPLE_FLAGS="${CROWDPM_FLAGS:-}"
PAYLOAD_SOURCE="generated sample batch"

TMP_DIR="$(mktemp -d -t crowdpm-live-batch.XXXXXX)"
trap 'rm -rf "${TMP_DIR}"' EXIT

usage() {
  cat <<'EOF'
Usage:
  scripts/live-device-send-batch.sh [batch.json]
  scripts/live-device-send-batch.sh - < batch.json

Sends one ingest batch through a device that was already registered with
scripts/live-device-registration.sh.

Defaults reuse the live device artifacts:
  API base: https://us-central1-crowdpmplatform.cloudfunctions.net/crowdpmApi
  Key file: .crowdpm-live-device-key.json
  Device ID file: .crowdpm-live-device-id

Payload precedence:
  1. positional batch.json (or '-' for stdin)
  2. CROWDPM_BATCH_FILE
  3. CROWDPM_BATCH_JSON
  4. built-in one-point sample batch

The script forces the selected device_id onto the batch root and every point.
If a point omits timestamp, pollutant, or unit, the script fills them in with
safe defaults before sending the batch.

Environment variables:
  CROWDPM_API_BASE             Override the live API base.
  CROWDPM_INGEST_URL           Override the ingest gateway URL.
  CROWDPM_KEY_FILE             Path to the registered Ed25519 JWK pair.
  CROWDPM_DEVICE_ID            Override the registered device ID directly.
  CROWDPM_DEVICE_ID_FILE       File containing the registered device ID.
  CROWDPM_ACCESS_TOKEN         Reuse an existing access token instead of minting one.
  CROWDPM_ACCESS_TOKEN_FILE    File where a freshly minted access token is saved.
  CROWDPM_SCOPE                Scope requested from /device/access-token. Default: ingest.write
  CROWDPM_BATCH_FILE           Path to a JSON batch payload.
  CROWDPM_BATCH_JSON           Inline JSON batch payload.
  CROWDPM_BATCH_VISIBILITY     Optional x-batch-visibility header (public/private).
  CROWDPM_TIMESTAMP            Fallback timestamp for points missing one.
  CROWDPM_POLLUTANT            Default pollutant for the sample or missing points. Default: pm25
  CROWDPM_VALUE                Default sample point value. Default: 12.4
  CROWDPM_UNIT                 Default sample/missing unit. Default: µg/m³
  CROWDPM_LAT                  Default sample latitude. Default: 45.5231
  CROWDPM_LON                  Default sample longitude. Default: -122.6765
  CROWDPM_ALTITUDE             Default sample altitude. Default: 12
  CROWDPM_PRECISION            Default sample precision. Default: 6
  CROWDPM_FLAGS                Optional integer flags field for the sample point.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if (( $# > 1 )); then
  usage >&2
  exit 1
fi

require_command() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

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

INGEST_URL="${CROWDPM_INGEST_URL:-}"

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

require_keypair() {
  local key_file="$1"

  node --input-type=module - "${key_file}" <<'NODE'
import { existsSync, readFileSync } from "node:fs";

const [keyFile] = process.argv.slice(2);

function isPublicJwk(value) {
  return Boolean(value && value.kty === "OKP" && value.crv === "Ed25519" && typeof value.x === "string");
}

function isPrivateJwk(value) {
  return isPublicJwk(value) && typeof value.d === "string";
}

if (!existsSync(keyFile)) {
  throw new Error(`Key file not found at ${keyFile}. Run scripts/live-device-registration.sh first.`);
}

const parsed = JSON.parse(readFileSync(keyFile, "utf8"));
if (!isPublicJwk(parsed.publicJwk) || !isPrivateJwk(parsed.privateJwk)) {
  throw new Error(`Key file at ${keyFile} is not an Ed25519 JWK pair`);
}
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

http_request_file() {
  local method="$1"
  local url="$2"
  local body_file="$3"
  local output_file="$4"
  shift 4

  local headers=()
  local header
  for header in "$@"; do
    headers+=(-H "${header}")
  done

  curl -sS -o "${output_file}" -w '%{http_code}' -X "${method}" "${url}" "${headers[@]}" --data-binary "@${body_file}"
}

pretty_print_file() {
  local file="$1"
  if command -v jq >/dev/null 2>&1; then
    jq . "${file}" 2>/dev/null || cat "${file}"
  else
    cat "${file}"
  fi
}

print_section() {
  printf '\n== %s ==\n' "$1"
}

resolve_device_id() {
  if [[ -n "${DEVICE_ID_OVERRIDE}" ]]; then
    printf '%s' "${DEVICE_ID_OVERRIDE}"
    return 0
  fi

  if [[ ! -s "${DEVICE_ID_FILE}" ]]; then
    echo "Device ID file not found at ${DEVICE_ID_FILE}. Run scripts/live-device-registration.sh first or set CROWDPM_DEVICE_ID." >&2
    exit 1
  fi

  local device_id
  device_id="$(sed -n '1p' "${DEVICE_ID_FILE}" | tr -d '\r')"
  if [[ -z "${device_id}" ]]; then
    echo "Device ID file at ${DEVICE_ID_FILE} is empty." >&2
    exit 1
  fi

  printf '%s' "${device_id}"
}

build_access_body() {
  local device_id="$1"

  node --input-type=module - "${device_id}" "${SCOPE}" <<'NODE'
const [deviceId, scope] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  device_id: deviceId,
  scope: [scope],
}));
NODE
}

build_default_batch() {
  node --input-type=module - \
    "${SAMPLE_POLLUTANT}" \
    "${SAMPLE_VALUE}" \
    "${SAMPLE_UNIT}" \
    "${SAMPLE_LAT}" \
    "${SAMPLE_LON}" \
    "${SAMPLE_ALTITUDE}" \
    "${SAMPLE_PRECISION}" \
    "${DEFAULT_TIMESTAMP}" \
    "${SAMPLE_FLAGS}" <<'NODE'
const [
  pollutantRaw,
  valueRaw,
  unitRaw,
  latRaw,
  lonRaw,
  altitudeRaw,
  precisionRaw,
  timestampRaw,
  flagsRaw,
] = process.argv.slice(2);

const asNumber = (value, fallback) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const point = {
  pollutant: pollutantRaw || "pm25",
  value: asNumber(valueRaw, 12.4),
  unit: unitRaw || "\u00b5g/m\u00b3",
  lat: asNumber(latRaw, 45.5231),
  lon: asNumber(lonRaw, -122.6765),
  timestamp: timestampRaw || new Date().toISOString(),
  precision: asNumber(precisionRaw, 6),
  altitude: asNumber(altitudeRaw, 12),
};

if (flagsRaw !== "") {
  const flags = Number(flagsRaw);
  if (Number.isFinite(flags)) {
    point.flags = Math.trunc(flags);
  }
}

process.stdout.write(JSON.stringify({ points: [point] }, null, 2));
NODE
}

write_payload_to_file() {
  local input_arg="${1:-}"
  local output_file="$2"

  if [[ -n "${input_arg}" ]]; then
    if [[ "${input_arg}" == "-" ]]; then
      PAYLOAD_SOURCE="stdin"
      cat > "${output_file}"
      return 0
    fi
    if [[ ! -r "${input_arg}" ]]; then
      echo "Batch file not found or unreadable: ${input_arg}" >&2
      exit 1
    fi
    PAYLOAD_SOURCE="${input_arg}"
    cat "${input_arg}" > "${output_file}"
    return 0
  fi

  if [[ -n "${BATCH_FILE_ENV}" ]]; then
    if [[ ! -r "${BATCH_FILE_ENV}" ]]; then
      echo "Batch file not found or unreadable: ${BATCH_FILE_ENV}" >&2
      exit 1
    fi
    PAYLOAD_SOURCE="${BATCH_FILE_ENV}"
    cat "${BATCH_FILE_ENV}" > "${output_file}"
    return 0
  fi

  if [[ -n "${BATCH_JSON}" ]]; then
    PAYLOAD_SOURCE="CROWDPM_BATCH_JSON"
    printf '%s' "${BATCH_JSON}" > "${output_file}"
    return 0
  fi

  build_default_batch > "${output_file}"
}

normalize_batch_file() {
  local input_file="$1"
  local output_file="$2"
  local device_id="$3"
  local fallback_timestamp="$4"

  node --input-type=module - "${input_file}" "${output_file}" "${device_id}" "${fallback_timestamp}" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [inputFile, outputFile, deviceId, fallbackTimestamp] = process.argv.slice(2);
const raw = readFileSync(inputFile, "utf8");

let parsed;
try {
  parsed = JSON.parse(raw);
}
catch (error) {
  throw new Error(`Batch payload is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
}

if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  throw new Error("Batch payload must be a JSON object with a points array.");
}
if (!Array.isArray(parsed.points) || parsed.points.length === 0) {
  throw new Error("Batch payload must include a non-empty points array.");
}

parsed.device_id = deviceId;
parsed.points = parsed.points.map((point, index) => {
  if (!point || typeof point !== "object" || Array.isArray(point)) {
    throw new Error(`points[${index}] must be an object.`);
  }

  return {
    ...point,
    device_id: deviceId,
    pollutant: typeof point.pollutant === "string" && point.pollutant.length > 0 ? point.pollutant : "pm25",
    unit: typeof point.unit === "string" && point.unit.length > 0 ? point.unit : "\u00b5g/m\u00b3",
    timestamp: typeof point.timestamp === "string" && point.timestamp.length > 0 ? point.timestamp : fallbackTimestamp,
  };
});

writeFileSync(outputFile, JSON.stringify(parsed, null, 2));
process.stdout.write(String(parsed.points.length));
NODE
}

require_command curl
require_command node
if [[ -z "${INGEST_URL}" ]]; then
  INGEST_URL="$(derive_ingest_url)"
fi
require_keypair "${KEY_FILE}"

DEVICE_ID="$(resolve_device_id)"
RAW_PAYLOAD_FILE="${TMP_DIR}/batch.raw.json"
NORMALIZED_PAYLOAD_FILE="${TMP_DIR}/batch.normalized.json"
ACCESS_URL="$(endpoint_url "/device/access-token")"
ACCESS_HTU="$(derive_htu "${ACCESS_URL}" "${API_BASE}")"
ACCESS_PROTO="$(url_proto "${ACCESS_URL}")"
ACCESS_OUT="${TMP_DIR}/access.json"
INGEST_PROTO="$(url_proto "${INGEST_URL}")"
INGEST_HTU="$(derive_htu "${INGEST_URL}" "${INGEST_URL}")"
INGEST_OUT="${TMP_DIR}/ingest.json"

write_payload_to_file "${1:-}" "${RAW_PAYLOAD_FILE}"
POINT_COUNT="$(normalize_batch_file "${RAW_PAYLOAD_FILE}" "${NORMALIZED_PAYLOAD_FILE}" "${DEVICE_ID}" "${DEFAULT_TIMESTAMP}")"

print_section "Live Target"
echo "API base: ${API_BASE}"
echo "Ingest URL: ${INGEST_URL}"
echo "Key file: ${KEY_FILE}"
echo "Device ID: ${DEVICE_ID}"

print_section "Batch"
echo "payload source: ${PAYLOAD_SOURCE}"
echo "points: ${POINT_COUNT}"
if [[ -n "${BATCH_VISIBILITY}" ]]; then
  echo "visibility: ${BATCH_VISIBILITY}"
fi

if [[ -n "${ACCESS_TOKEN_OVERRIDE}" ]]; then
  ACCESS_TOKEN="${ACCESS_TOKEN_OVERRIDE}"
  print_section "Access Token"
  echo "Using CROWDPM_ACCESS_TOKEN override."
else
  ACCESS_BODY="$(build_access_body "${DEVICE_ID}")"

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
fi

INGEST_HEADERS=(
  "Authorization: Bearer ${ACCESS_TOKEN}"
  "content-type: application/json"
  "x-forwarded-proto: ${INGEST_PROTO}"
  "DPoP: $(make_dpop "${INGEST_HTU}" "POST" "${KEY_FILE}")"
)

if [[ -n "${BATCH_VISIBILITY}" ]]; then
  INGEST_HEADERS+=("x-batch-visibility: ${BATCH_VISIBILITY}")
fi

print_section "Send Batch"
INGEST_STATUS="$(http_request_file "POST" "${INGEST_URL}" "${NORMALIZED_PAYLOAD_FILE}" "${INGEST_OUT}" "${INGEST_HEADERS[@]}")"

if [[ "${INGEST_STATUS}" != "202" ]]; then
  echo "Batch ingest failed with HTTP ${INGEST_STATUS}" >&2
  pretty_print_file "${INGEST_OUT}" >&2
  exit 1
fi

pretty_print_file "${INGEST_OUT}"

print_section "Done"
echo "device_id=${DEVICE_ID}"
echo "points_sent=${POINT_COUNT}"
echo "payload_source=${PAYLOAD_SOURCE}"
