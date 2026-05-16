import type { HttpsOptions } from "firebase-functions/v2/https";

export const FUNCTION_REGION = "us-central1";

export const crowdpmApiRuntimeOptions = {
  region: FUNCTION_REGION,
  timeoutSeconds: 120,
  memory: "512MiB",
  concurrency: 40,
  maxInstances: 20,
} satisfies HttpsOptions;

export const ingestGatewayRuntimeOptions = {
  region: FUNCTION_REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
  concurrency: 40,
  maxInstances: 20,
} satisfies HttpsOptions;
