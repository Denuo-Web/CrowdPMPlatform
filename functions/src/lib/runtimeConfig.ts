import { config } from "firebase-functions";

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
  const cfg = readConfig();
  return process.env.INGEST_HMAC_SECRET || cfg.ingest?.hmac_secret || "";
}

export function getIngestTopic(): string {
  const cfg = readConfig();
  return process.env.INGEST_TOPIC || cfg.ingest?.topic || "ingest.raw";
}
