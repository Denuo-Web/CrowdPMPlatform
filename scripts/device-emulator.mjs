#!/usr/bin/env node
import { generateKeyPairSync, randomUUID, createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_API_BASE = process.env.CROWDPM_API_BASE
  ?? "http://localhost:5001/demo-crowdpm/us-central1/crowdpmApi";
const DEFAULT_INGEST_URL = process.env.CROWDPM_INGEST_URL
  ?? DEFAULT_API_BASE.replace(/crowdpmApi\/?$/u, "ingestGateway");

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/=+$/u, "").replace(/\+/gu, "-").replace(/\//gu, "_");
}

function isPublicJwk(value) {
  return Boolean(value && value.kty === "OKP" && value.crv === "Ed25519" && typeof value.x === "string");
}

function isPrivateJwk(value) {
  return isPublicJwk(value) && typeof value.d === "string";
}

function loadOrGenerateKey(keyPath) {
  if (keyPath) {
    const resolved = resolve(process.cwd(), keyPath);
    if (existsSync(resolved)) {
      const parsed = JSON.parse(readFileSync(resolved, "utf8"));
      if (!isPublicJwk(parsed.publicJwk) || !isPrivateJwk(parsed.privateJwk)) {
        throw new Error(`Key file at ${resolved} is not an Ed25519 JWK pair`);
      }
      return { publicJwk: parsed.publicJwk, privateJwk: parsed.privateJwk, path: resolved, generated: false };
    }
    const kp = generateKeyPairSync("ed25519");
    const publicJwk = kp.publicKey.export({ format: "jwk" });
    const privateJwk = kp.privateKey.export({ format: "jwk" });
    writeFileSync(resolved, JSON.stringify({ publicJwk, privateJwk }, null, 2));
    return { publicJwk, privateJwk, path: resolved, generated: true };
  }

  const kp = generateKeyPairSync("ed25519");
  return {
    publicJwk: kp.publicKey.export({ format: "jwk" }),
    privateJwk: kp.privateKey.export({ format: "jwk" }),
    path: null,
    generated: true,
  };
}

function buildUrl(base, pathname) {
  const normalized = base.endsWith("/") ? base : `${base}/`;
  return new URL(pathname.startsWith("/") ? pathname.slice(1) : pathname, normalized);
}

function deriveHtu(targetUrl, apiBase, proto) {
  let basePath = "";
  try {
    basePath = new URL(apiBase).pathname.replace(/\/$/u, "");
  }
  catch {
    basePath = "";
  }
  const trimmedPath = targetUrl.pathname.startsWith(basePath)
    ? targetUrl.pathname.slice(basePath.length) || "/"
    : targetUrl.pathname;
  return `${proto}://${targetUrl.host}${trimmedPath}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNumber(value, fallback) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function buildHistoricalPoints({
  deviceId,
  startValue,
  valueStep,
  minutes,
  lat,
  lon,
  altitude,
  precision,
}) {
  const historyMinutes = Math.max(1, Math.floor(minutes));
  const now = Date.now();
  const points = [];
  for (let i = historyMinutes - 1; i >= 0; i -= 1) {
    const value = startValue + valueStep * (historyMinutes - 1 - i);
    points.push({
      device_id: deviceId,
      pollutant: "pm25",
      value,
      unit: "\u00b5g/m\u00b3",
      lat,
      lon,
      timestamp: new Date(now - i * 60_000).toISOString(),
      precision,
      altitude,
    });
  }
  return points;
}

async function createDpopProof({ htu, method, privateJwk, publicJwk }) {
  const header = { alg: "EdDSA", typ: "dpop+jwt", jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x } };
  const payload = {
    htm: method.toUpperCase(),
    htu,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const key = createPrivateKey({ format: "jwk", key: privateJwk });
  const signature = edSign(null, Buffer.from(signingInput), key);
  const encodedSig = base64url(signature);
  return `${encodedHeader}.${encodedPayload}.${encodedSig}`;
}

function printHelp() {
  console.log(`Usage: node scripts/device-emulator.mjs [options]
Options:
  --mode <pair|ingest> Which workflow to run (default: pair). pair = start/poll/register. ingest = send payload only.
  --api <url>       API base URL (default: ${DEFAULT_API_BASE})
  --model <name>    Model sent to /device/start (default: CLI-EMU)
  --version <ver>   Firmware version sent to /device/start (default: 0.0.1)
  --nonce <value>   Optional nonce/serial to reuse pairing attempts
  --key <path>      Path to persist/reuse the Ed25519 JWK keypair
  --device-code <c> Override device_code when polling (defaults to freshly created one)
  --interval <sec>  Poll interval in seconds (default: 3, or server hint)
  --ingest          In pair mode: also send a sample ingest payload. In ingest mode: no effect (ingest always runs).
  --device-id <id>  Required in ingest mode; optional in pair mode for override.
  --access-token <t>Use an existing access token instead of minting a new one (ingest mode only).
  --ingest-url <u>  Override ingest gateway URL (default: ${DEFAULT_INGEST_URL})
  --minutes <n>     Minutes of history to send (default: 60)
  --start-value <n> Starting value for the first point (default: 15.9)
  --value-step <n>  Increment per minute (default: 2)
  --lat <deg>       Latitude for all points (default: 40.7128)
  --lon <deg>       Longitude for all points (default: -74.00585)
  --altitude <m>    Altitude to attach to each point (default: 0)
  --precision <p>   Precision/accuracy to attach to each point (default: 9)
  --help            Show this help message
`);
}

async function requestAccessToken({ apiBase, deviceId, privateJwk, publicJwk }) {
  const accessUrl = buildUrl(apiBase, "/device/access-token");
  const accessProto = accessUrl.protocol.replace(":", "") || "https";
  const accessHtu = deriveHtu(accessUrl, apiBase, accessProto);
  const accessDpop = await createDpopProof({
    htu: accessHtu,
    method: "POST",
    privateJwk,
    publicJwk,
  });

  const accessResp = await fetch(accessUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      dpop: accessDpop,
      "x-forwarded-proto": accessProto,
    },
    body: JSON.stringify({ device_id: deviceId, scope: ["ingest.write"] }),
  });
  const accessRaw = await accessResp.text();
  let parsedAccess = null;
  try { parsedAccess = JSON.parse(accessRaw); } catch { /* ignore */ }
  if (!accessResp.ok) {
    throw new Error(`Access token request failed: ${accessResp.status} ${accessResp.statusText} - ${JSON.stringify(parsedAccess ?? accessRaw)}`);
  }
  const accessToken = parsedAccess?.access_token ?? parsedAccess?.accessToken;
  const accessTtl = parsedAccess?.expires_in ?? parsedAccess?.expiresIn;
  return { token: accessToken, ttl: accessTtl };
}

async function sendIngest({ ingestUrlRaw, deviceId, privateJwk, publicJwk, accessToken, points }) {
  const ingestUrl = new URL(ingestUrlRaw);
  const ingestProto = ingestUrl.protocol.replace(":", "") || "https";
  const ingestHtu = deriveHtu(ingestUrl, ingestUrlRaw, ingestProto);
  const ingestDpop = await createDpopProof({
    htu: ingestHtu,
    method: "POST",
    privateJwk,
    publicJwk,
  });

  const ingestPayload = { device_id: deviceId, points };
  console.log(`\nSending ingest payload (${points.length} points) to ${ingestUrl.toString()} ...`);

  const ingestResp = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      dpop: ingestDpop,
      "x-forwarded-proto": ingestProto,
    },
    body: JSON.stringify(ingestPayload),
  });
  const ingestRaw = await ingestResp.text();
  let ingestParsed = null;
  try { ingestParsed = JSON.parse(ingestRaw); } catch { /* ignore */ }

  if (!ingestResp.ok) {
    throw new Error(`Ingest request failed: ${ingestResp.status} ${ingestResp.statusText} - ${JSON.stringify(ingestParsed ?? ingestRaw)}`);
  }

  console.log("Ingest accepted:", ingestParsed ?? ingestRaw);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === "--") argv.shift();

  const { values } = parseArgs({
    options: {
      mode: { type: "string" },
      api: { type: "string", default: DEFAULT_API_BASE },
      model: { type: "string", default: "CLI-EMU" },
      version: { type: "string", default: "0.0.1" },
      nonce: { type: "string" },
      key: { type: "string" },
      "device-id": { type: "string" },
      "device-code": { type: "string" },
      "access-token": { type: "string" },
      interval: { type: "string" },
      ingest: { type: "boolean" },
      "ingest-url": { type: "string" },
      minutes: { type: "string" },
      "start-value": { type: "string" },
      "value-step": { type: "string" },
      lat: { type: "string" },
      lon: { type: "string" },
      altitude: { type: "string" },
      precision: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
    args: argv,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const modeFlag = typeof values.mode === "string" ? values.mode.toLowerCase() : undefined;
  const mode = modeFlag === "ingest" ? "ingest" : "pair";
  const apiBase = values.api ?? DEFAULT_API_BASE;
  const ingestUrlRaw = values["ingest-url"] ?? DEFAULT_INGEST_URL;
  const ingestRequested = mode === "ingest" ? true : (values.ingest ?? false);
  const startValue = parseNumber(values["start-value"], 15.9);
  const valueStep = parseNumber(values["value-step"], 2);
  const historyMinutes = parseNumber(values.minutes, 60);
  const lat = parseNumber(values.lat, 40.7128);
  const lon = parseNumber(values.lon, -74.00585);
  const altitude = parseNumber(values.altitude, 0);
  const precision = parseNumber(values.precision, 9);
  const { publicJwk, privateJwk, path: keyPath, generated } = loadOrGenerateKey(values.key);

  if (mode === "ingest" && !values.key && generated) {
    console.warn("Warning: running ingest mode without --key will generate a new key that will NOT match your registered device.");
  }
  if (mode === "ingest" && !values["device-id"]) {
    console.error("Ingest mode requires --device-id.");
    process.exitCode = 1;
    return;
  }

  if (mode === "ingest") {
    const deviceId = values["device-id"];
    const accessToken = values["access-token"];
    let token = accessToken;
    if (!token) {
      try {
        const minted = await requestAccessToken({ apiBase, deviceId, privateJwk, publicJwk });
        token = minted.token;
        console.log("Access token minted.");
        if (minted.ttl) console.log(`  expires_in: ${minted.ttl}s`);
      }
      catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exitCode = 1;
        return;
      }
    } else {
      console.log("Using provided access token.");
    }

    const points = buildHistoricalPoints({
      deviceId,
      startValue,
      valueStep,
      minutes: historyMinutes,
      lat,
      lon,
      altitude,
      precision,
    });

    try {
      await sendIngest({ ingestUrlRaw, deviceId, privateJwk, publicJwk, accessToken: token, points });
    }
    catch (err) {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    }
    return;
  }

  const startUrl = buildUrl(apiBase, "/device/start");
  const body = {
    pub_ke: publicJwk.x,
    model: values.model,
    version: values.version,
    ...(values.nonce ? { nonce: values.nonce } : {}),
  };

  console.log(`Sending pairing request to ${startUrl} ...`);
  const response = await fetch(startUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  let parsedStart = null;
  try {
    parsedStart = JSON.parse(rawBody);
  }
  catch { /* ignore */ }

  if (contentType.includes("text/html")) {
    console.error("Received HTML from /device/start. Point --api at the Functions base, not hosting.");
    console.error("Example: --api http://localhost:5001/demo-crowdpm/us-central1/crowdpmApi");
    console.error("Body preview:");
    console.error(rawBody.slice(0, 400));
    process.exitCode = 1;
    return;
  }

  if (!response.ok) {
    console.error("Request failed:", response.status, response.statusText);
    console.error("Response body:", parsedStart ?? rawBody);
    process.exitCode = 1;
    return;
  }

  if (!parsedStart || typeof parsedStart !== "object") {
    console.error("Unexpected response from /device/start; body was:");
    console.error(rawBody);
    process.exitCode = 1;
    return;
  }

  const deviceCode = parsedStart.device_code ?? parsedStart.deviceCode;
  const userCode = parsedStart.user_code ?? parsedStart.userCode;
  const verificationUri = parsedStart.verification_uri ?? parsedStart.verificationUri;
  const verificationUriComplete = parsedStart.verification_uri_complete ?? parsedStart.verificationUriComplete;
  const pollInterval = parsedStart.poll_interval ?? parsedStart.pollInterval;
  const expiresIn = parsedStart.expires_in ?? parsedStart.expiresIn;

  if (!deviceCode || !userCode) {
    console.error("Missing device_code or user_code in response:");
    console.error(parsedStart);
    process.exitCode = 1;
    return;
  }

  console.log("Pairing session started:");
  console.log(`  device_code: ${deviceCode}`);
  console.log(`  user_code: ${userCode}`);
  if (verificationUri) console.log(`  verification_uri: ${verificationUri}`);
  if (verificationUriComplete) console.log(`  verification_uri_complete: ${verificationUriComplete}`);
  if (pollInterval !== undefined) console.log(`  poll_interval: ${pollInterval}s`);
  if (expiresIn !== undefined) console.log(`  expires_in: ${expiresIn}s`);

  console.log("\nDPoP key material (keep private key secret):");
  console.log(`  pub_ke: ${publicJwk.x}`);
  if (keyPath) {
    console.log(`  key saved: ${keyPath}${generated ? " (newly generated)" : " (reused)"}`);
  }
  else {
    console.log("  key not saved: rerun with --key <path> to persist this pair");
  }
  console.log("  private_jwk.d:", privateJwk.d);

  // Begin polling for registration token and auto-register.
  const targetDeviceCode = values["device-code"] ?? deviceCode;
  const tokenUrl = buildUrl(apiBase, "/device/token");
  const tokenProto = tokenUrl.protocol.replace(":", "") || "https";
  const tokenHtu = deriveHtu(tokenUrl, apiBase, tokenProto);
  let pollSeconds = Number(values.interval ?? pollInterval ?? 3);
  if (!Number.isFinite(pollSeconds) || pollSeconds <= 0) pollSeconds = 3;

  let registeredDeviceId = null;

  console.log(`\nPolling /device/token for ${targetDeviceCode} every ${pollSeconds}s ...`);
  while (true) {
    const dpop = await createDpopProof({ htu: tokenHtu, method: "POST", privateJwk, publicJwk });
    const resp = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        dpop,
        "x-forwarded-proto": tokenProto,
      },
      body: JSON.stringify({ device_code: targetDeviceCode }),
    });
    const raw = await resp.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { /* ignore */ }

    if (resp.ok) {
      const regToken = parsed?.registration_token;
      if (!regToken) {
        console.log("Token success:", parsed ?? raw);
        break;
      }

      const registerUrl = buildUrl(apiBase, "/device/register");
      const registerProto = registerUrl.protocol.replace(":", "") || "https";
      const registerHtu = deriveHtu(registerUrl, apiBase, registerProto);
      const registerDpop = await createDpopProof({
        htu: registerHtu,
        method: "POST",
        privateJwk,
        publicJwk,
      });

      console.log("registration_token received; registering device ...");
      const regResp = await fetch(registerUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${regToken}`,
          "content-type": "application/json",
          dpop: registerDpop,
          "x-forwarded-proto": registerProto,
        },
        body: JSON.stringify({ jwk_pub_kl: publicJwk }),
      });
      const regRaw = await regResp.text();
      let regParsed = null;
      try { regParsed = JSON.parse(regRaw); } catch { /* ignore */ }

      if (!regResp.ok) {
        console.error("Registration failed:", regResp.status, regResp.statusText);
        console.error("Body:", regParsed ?? regRaw);
        process.exitCode = 1;
        break;
      }

      console.log("Registration success:", regParsed ?? regRaw);
      registeredDeviceId = regParsed?.device_id ?? regParsed?.deviceId ?? null;
      break;
    }

    const error = parsed?.error;
    if (error === "authorization_pending") {
      console.log("authorization_pending; waiting...");
      await sleep(pollSeconds * 1000);
      continue;
    }
    if (error === "slow_down" && typeof parsed?.poll_interval === "number") {
      pollSeconds = Math.max(parsed.poll_interval, pollSeconds);
      console.log(`slow_down; server suggests poll_interval=${parsed.poll_interval}s. Waiting ${pollSeconds}s`);
      await sleep(pollSeconds * 1000);
      continue;
    }

    console.error("Token request failed:", resp.status, resp.statusText);
    console.error("Body:", parsed ?? raw);
    process.exitCode = 1;
    break;
  }

  if (!registeredDeviceId) {
    console.log("Pairing completed without a device_id; skipping access token + ingest.");
    return;
  }

  let mintedAccessToken = null;
  try {
    const minted = await requestAccessToken({ apiBase, deviceId: registeredDeviceId, privateJwk, publicJwk });
    mintedAccessToken = minted.token;
    console.log("Access token issued for device:", registeredDeviceId);
    if (minted.ttl) console.log(`  expires_in: ${minted.ttl}s`);
  }
  catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
    return;
  }

  if (!ingestRequested) {
    console.log("\nIngest payload not requested (--ingest not set).");
    console.log("Reuse the access token above or rerun with --ingest to push sample data.");
    return;
  }

  const points = buildHistoricalPoints({
    deviceId: registeredDeviceId,
    startValue,
    valueStep,
    minutes: historyMinutes,
    lat,
    lon,
    altitude,
    precision,
  });

  try {
    await sendIngest({
      ingestUrlRaw,
      deviceId: registeredDeviceId,
      privateJwk,
      publicJwk,
      accessToken: mintedAccessToken,
      points,
    });
  }
  catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
