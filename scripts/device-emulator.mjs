#!/usr/bin/env node
import { generateKeyPairSync, randomUUID, createPrivateKey, sign as edSign } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const DEFAULT_API_BASE = process.env.CROWDPM_API_BASE
  ?? "http://localhost:5001/demo-crowdpm/us-central1/crowdpmApi";

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
  --api <url>       API base URL (default: ${DEFAULT_API_BASE})
  --model <name>    Model sent to /device/start (default: CLI-EMU)
  --version <ver>   Firmware version sent to /device/start (default: 0.0.1)
  --nonce <value>   Optional nonce/serial to reuse pairing attempts
  --key <path>      Path to persist/reuse the Ed25519 JWK keypair
  --token           Also call /device/token using the same key
  --device-code <c> device_code to use for /device/token (defaults to freshly created one)
  --help            Show this help message
`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      api: { type: "string", default: DEFAULT_API_BASE },
      model: { type: "string", default: "CLI-EMU" },
      version: { type: "string", default: "0.0.1" },
      nonce: { type: "string" },
      key: { type: "string" },
      token: { type: "boolean" },
      "device-code": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const apiBase = values.api ?? DEFAULT_API_BASE;
  const { publicJwk, privateJwk, path: keyPath, generated } = loadOrGenerateKey(values.key);

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

  if (values.token) {
    const targetDeviceCode = values["device-code"] ?? deviceCode;
    if (!targetDeviceCode) {
      console.error("No device_code available for /device/token. Pass --device-code <code> or omit --token.");
      process.exit(1);
      return;
    }
    const tokenUrl = buildUrl(apiBase, "/device/token");
    const tokenHtu = tokenUrl.toString().replace(/\/$/u, "");
    const dpop = await createDpopProof({ htu: tokenHtu, method: "POST", privateJwk, publicJwk });
    console.log(`\nPolling /device/token for ${targetDeviceCode} ...`);
    const tokenResponse = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        dpop,
      },
      body: JSON.stringify({ device_code: targetDeviceCode }),
    });
    const tokenRaw = await tokenResponse.text();
    let parsedToken = null;
    try {
      parsedToken = JSON.parse(tokenRaw);
    }
    catch { /* ignore */ }

    if (!tokenResponse.ok) {
      console.error("Token request failed:", tokenResponse.status, tokenResponse.statusText);
      console.error("Response body:", parsedToken ?? tokenRaw);
      process.exitCode = 1;
      return;
    }

    console.log("Device token response:");
    console.log(parsedToken ?? tokenRaw);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
