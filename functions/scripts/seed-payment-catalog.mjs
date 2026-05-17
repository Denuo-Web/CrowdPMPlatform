#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import admin from "firebase-admin";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const functionsDir = path.resolve(__dirname, "..");

function parseArg(name) {
  const args = process.argv.slice(2);
  const direct = args.find((entry) => entry.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function parseCsvArg(name) {
  const value = parseArg(name);
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function usage() {
  console.log("Usage:");
  console.log("  pnpm --filter crowdpm-functions payments:seed-catalog");
  console.log("  pnpm --filter crowdpm-functions payments:seed-catalog -- --only nodeHardware,nodeHardwareCo2");
  console.log("  pnpm --filter crowdpm-functions payments:seed-catalog -- --env-file functions/.env.live --project crowdpmplatform");
  console.log("");
  console.log("Options:");
  console.log("  --only       Comma-separated list of paymentCatalog document ids to seed.");
  console.log("  --env-file   Optional dotenv-style file to load before seeding.");
  console.log("  --project    Optional Firebase project id override.");
}

function normalizeEnvValue(raw) {
  const trimmed = raw.trim();
  const unquoted = (trimmed.startsWith("\"") && trimmed.endsWith("\""))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted.replace(/\\n/g, "\n");
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = normalizeEnvValue(trimmed.slice(eq + 1));
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function run() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    usage();
    return;
  }

  const hadStripeSecretKey = typeof process.env.STRIPE_SECRET_KEY === "string" && process.env.STRIPE_SECRET_KEY.trim().length > 0;
  const envFileArg = parseArg("env-file");
  const envFile = envFileArg
    ? path.resolve(process.cwd(), envFileArg)
    : path.resolve(functionsDir, ".env.local");
  const loadedDefaultLocalEnv = !envFileArg && envFile.endsWith(`${path.sep}.env.local`) && fs.existsSync(envFile);
  if (fs.existsSync(envFile)) {
    loadEnvFile(envFile);
  }

  const projectId = (parseArg("project") || process.env.FIREBASE_PROJECT_ID || "").trim();
  if (projectId) {
    process.env.FIREBASE_PROJECT_ID = projectId;
  }
  if (loadedDefaultLocalEnv && projectId && projectId !== "crowdpm-local" && !hadStripeSecretKey) {
    throw new Error("Refusing to seed a non-local Firebase project with credentials from functions/.env.local. Export a live STRIPE_SECRET_KEY or provide --env-file explicitly.");
  }

  if (!admin.apps.length) {
    admin.initializeApp(projectId ? { projectId } : undefined);
  }

  const { listStripeCatalogSeedConfigs, synchronizeStripeCatalog } = await import("../lib/services/nodePurchase.js");
  const configs = listStripeCatalogSeedConfigs();
  const only = parseCsvArg("only");
  const availableIds = new Set(configs.map((config) => config.catalogDocId));

  for (const catalogDocId of only) {
    if (!availableIds.has(catalogDocId)) {
      usage();
      throw new Error(`Unknown catalog id "${catalogDocId}". Available ids: ${Array.from(availableIds).sort().join(", ")}`);
    }
  }

  const selectedConfigs = only.length > 0
    ? configs.filter((config) => only.includes(config.catalogDocId))
    : configs;

  const results = [];
  for (const config of selectedConfigs) {
    const result = await synchronizeStripeCatalog(config, { allowCreate: true });
    results.push({
      catalogDocId: result.catalogDocId,
      productName: result.productName,
      state: result.state,
      productId: result.catalog.productId,
      defaultPriceId: result.catalog.defaultPriceId,
      unitAmount: result.catalog.unitAmount,
      currency: result.catalog.currency,
      recurringInterval: result.catalog.recurringInterval ?? null,
    });
  }

  console.log(JSON.stringify({
    projectId: projectId || null,
    envFile: fs.existsSync(envFile) ? envFile : null,
    results,
  }, null, 2));
}

run().catch((err) => {
  console.error("[seed-payment-catalog] failed", err.message || err);
  process.exitCode = 1;
});
