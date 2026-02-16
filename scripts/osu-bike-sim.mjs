#!/usr/bin/env node
import { parseArgs } from "node:util";

const DEFAULT_API_BASE = process.env.CROWDPM_API_BASE
  ?? "http://127.0.0.1:5001/demo-crowdpm/us-central1/crowdpmApi";
const DEFAULT_AUTH_URL = process.env.CROWDPM_AUTH_URL
  ?? "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo";
const DEFAULT_EMAIL = process.env.SMOKE_EMAIL ?? "smoke-tester@crowdpm.dev";
const DEFAULT_PASSWORD = process.env.SMOKE_PASSWORD ?? "crowdpm-dev";

const OSU_ROUTE = [
  [44.5646, -123.2620],
  [44.5657, -123.2740],
  [44.5588, -123.2815],
  [44.5526, -123.2760],
  [44.5530, -123.2650],
  [44.5575, -123.2570],
  [44.5650, -123.2530],
  [44.5715, -123.2615],
  [44.5710, -123.2720],
  [44.5646, -123.2620],
];

function printHelp() {
  console.log(`Usage: node scripts/osu-bike-sim.mjs [options]

Runs a multi-device OSU bike-route smoke simulation against /v1/admin/ingest-smoke-test.

Options:
  --api <url>           API base URL (default: ${DEFAULT_API_BASE})
  --auth-url <url>      Auth emulator sign-in URL (default: ${DEFAULT_AUTH_URL})
  --email <email>       Emulator login email (default: ${DEFAULT_EMAIL})
  --password <pwd>      Emulator login password (default: ${DEFAULT_PASSWORD})
  --count <n>           Number of devices to seed (default: 20)
  --start-index <n>     First device index (default: 1)
  --prefix <text>       Device prefix (default: osu-bike)
  --minutes <n>         Number of points per device, 1 point/min (default: 36)
  --delay-ms <n>        Delay between ingest calls (default: 120)
  --attempts <n>        Per-device ingest attempts before failure (default: 2)
  --visibility <v>      Batch visibility (default: public)
  --verify-limit <n>    Max public batches loaded for verification (default: 200)
  --help                Show this message

Example:
  pnpm device:simulate:osu -- --count 20 --minutes 45
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(name, value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  if (fallback > 0) {
    return fallback;
  }
  throw new Error(`Invalid value for --${name}: ${String(value)}`);
}

function parseNonNegativeInt(name, value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  if (fallback >= 0) {
    return fallback;
  }
  throw new Error(`Invalid value for --${name}: ${String(value)}`);
}

function parseNonEmpty(name, value, fallback) {
  const text = (value ?? "").trim();
  if (text.length > 0) return text;
  if (fallback.trim().length > 0) return fallback;
  throw new Error(`Invalid value for --${name}: ${String(value)}`);
}

function parseJsonBody(raw) {
  try {
    return JSON.parse(raw);
  }
  catch {
    return raw;
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function jitter(seed) {
  return (Math.sin(seed * 999.91) + Math.cos(seed * 313.37)) * 0.00018;
}

function buildBikePoints({ deviceId, bikeIndex, minutes }) {
  const pointCount = Math.max(1, minutes);
  const denominator = Math.max(1, pointCount - 1);
  const now = Date.now();
  const points = [];

  for (let i = 0; i < pointCount; i += 1) {
    const segmentFloat = (i / denominator) * (OSU_ROUTE.length - 1);
    const segmentIndex = Math.floor(segmentFloat);
    const segmentProgress = segmentFloat - segmentIndex;

    const [latA, lonA] = OSU_ROUTE[segmentIndex];
    const [latB, lonB] = OSU_ROUTE[Math.min(segmentIndex + 1, OSU_ROUTE.length - 1)];
    const latBase = lerp(latA, latB, segmentProgress);
    const lonBase = lerp(lonA, lonB, segmentProgress);

    const lat = Number((latBase + jitter((bikeIndex + 1) * (i + 11))).toFixed(6));
    const lon = Number((lonBase + jitter((bikeIndex + 1) * (i + 29))).toFixed(6));
    const timestamp = new Date(now - (pointCount - 1 - i) * 60_000).toISOString();
    const value = Number((8 + Math.abs(Math.sin((i + bikeIndex) / 4)) * 22 + bikeIndex * 0.15).toFixed(1));
    const altitude = Number((65 + Math.sin((i + bikeIndex) / 3) * 7).toFixed(1));
    const precision = 5 + ((i + bikeIndex) % 8);

    points.push({
      device_id: deviceId,
      pollutant: "pm25",
      value,
      unit: "µg/m³",
      lat,
      lon,
      timestamp,
      precision,
      altitude,
    });
  }

  return points;
}

async function signIn({ authUrl, email, password }) {
  const response = await fetch(authUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const raw = await response.text();
  const parsed = parseJsonBody(raw);

  if (!response.ok) {
    throw new Error(`Auth failed (${response.status}): ${JSON.stringify(parsed)}`);
  }

  if (!parsed?.idToken || typeof parsed.idToken !== "string") {
    throw new Error("Auth succeeded but idToken was missing.");
  }

  return parsed.idToken;
}

async function postSmokeBatch({ apiBase, idToken, deviceId, points, visibility }) {
  const response = await fetch(`${apiBase}/v1/admin/ingest-smoke-test`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      deviceId,
      visibility,
      payload: { points },
    }),
  });
  const raw = await response.text();
  const parsed = parseJsonBody(raw);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} :: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function verifyPublicCount({ apiBase, prefix, limit }) {
  const response = await fetch(`${apiBase}/v1/public/batches?limit=${limit}`);
  const raw = await response.text();
  const parsed = parseJsonBody(raw);
  if (!response.ok) {
    throw new Error(`Public list request failed: ${response.status} ${response.statusText} :: ${JSON.stringify(parsed)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error("Public list response was not an array.");
  }
  return parsed.filter((item) => typeof item?.deviceId === "string" && item.deviceId.includes(`${prefix}-`)).length;
}

async function run() {
  const { values } = parseArgs({
    options: {
      api: { type: "string", default: DEFAULT_API_BASE },
      "auth-url": { type: "string", default: DEFAULT_AUTH_URL },
      email: { type: "string", default: DEFAULT_EMAIL },
      password: { type: "string", default: DEFAULT_PASSWORD },
      count: { type: "string", default: "20" },
      "start-index": { type: "string", default: "1" },
      prefix: { type: "string", default: "osu-bike" },
      minutes: { type: "string", default: "36" },
      "delay-ms": { type: "string", default: "120" },
      attempts: { type: "string", default: "2" },
      visibility: { type: "string", default: "public" },
      "verify-limit": { type: "string", default: "200" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    return;
  }

  const apiBase = parseNonEmpty("api", values.api, DEFAULT_API_BASE);
  const authUrl = parseNonEmpty("auth-url", values["auth-url"], DEFAULT_AUTH_URL);
  const email = parseNonEmpty("email", values.email, DEFAULT_EMAIL);
  const password = parseNonEmpty("password", values.password, DEFAULT_PASSWORD);
  const count = parsePositiveInt("count", values.count, 20);
  const startIndex = parsePositiveInt("start-index", values["start-index"], 1);
  const prefix = parseNonEmpty("prefix", values.prefix, "osu-bike");
  const minutes = parsePositiveInt("minutes", values.minutes, 36);
  const delayMs = parseNonNegativeInt("delay-ms", values["delay-ms"], 120);
  const attempts = parsePositiveInt("attempts", values.attempts, 2);
  const visibility = parseNonEmpty("visibility", values.visibility, "public");
  const verifyLimit = parsePositiveInt("verify-limit", values["verify-limit"], 200);

  console.log(`Signing in as ${email} ...`);
  const idToken = await signIn({ authUrl, email, password });
  const width = Math.max(2, String(startIndex + count - 1).length);
  const successes = [];
  const failures = [];

  for (let idx = 0; idx < count; idx += 1) {
    const sequence = startIndex + idx;
    const suffix = String(sequence).padStart(width, "0");
    const deviceId = `${prefix}-${suffix}`;
    const points = buildBikePoints({
      deviceId,
      bikeIndex: sequence - startIndex,
      minutes,
    });

    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await postSmokeBatch({
          apiBase,
          idToken,
          deviceId,
          points,
          visibility,
        });
        successes.push({
          deviceId: result.seededDeviceId || deviceId,
          batchId: result.batchId || null,
        });
        console.log(`[ok] ${deviceId} -> ${result.batchId || "no-batch-id"}`);
        lastError = null;
        break;
      }
      catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < attempts) {
          await sleep(Math.max(250, delayMs));
        }
      }
    }

    if (lastError) {
      failures.push({ deviceId, error: lastError });
      console.error(`[fail] ${deviceId} -> ${lastError}`);
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  console.log(`\nSimulation complete: ${successes.length}/${count} succeeded, ${failures.length} failed.`);

  if (failures.length) {
    console.log("Failures:");
    for (const item of failures) {
      console.log(` - ${item.deviceId}: ${item.error}`);
    }
  }

  try {
    const publicCount = await verifyPublicCount({ apiBase, prefix, limit: verifyLimit });
    console.log(`Public batches currently visible (${prefix}-*): ${publicCount}`);
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Public batch verification failed: ${message}`);
  }

  if (failures.length) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
