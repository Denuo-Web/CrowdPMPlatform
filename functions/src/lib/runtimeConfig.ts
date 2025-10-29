import { config } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";

export const ingestHmacSecret = defineSecret("INGEST_HMAC_SECRET");

type IngestConfig = {
  ingest?: {
    hmac_secret?: string;
    topic?: string;
  };
};

function readConfig(): IngestConfig {
  try {
    return config() as IngestConfig;
  }
  catch {
    return {};
  }
}

export function getIngestSecret(): string {
  const envSecret = process.env.INGEST_HMAC_SECRET;
  if (envSecret) return envSecret;

  try {
    const secret = ingestHmacSecret.value();
    if (secret) return secret;
  }
  catch {
    // ignore; fall back to runtime config
  }

  const cfg = readConfig();
  return cfg.ingest?.hmac_secret || "";
}

export function getIngestTopic(): string {
  const cfg = readConfig();
  return process.env.INGEST_TOPIC || cfg.ingest?.topic || "ingest.raw";
}
