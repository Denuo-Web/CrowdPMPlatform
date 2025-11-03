import { config } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";

export const claimPassphrasePepperSecret = defineSecret("CLAIM_PASSPHRASE_PEPPER");
export const deviceSecretEncryptionKeySecret = defineSecret("DEVICE_SECRET_ENCRYPTION_KEY");

type IngestConfig = {
  ingest?: {
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

export function getIngestTopic(): string {
  const cfg = readConfig();
  return process.env.INGEST_TOPIC || cfg.ingest?.topic || "ingest.raw";
}

function decodeKeyMaterial(raw: string): Buffer {
  const candidate = raw.trim();
  if (!candidate) throw new Error("device secret encryption key must not be empty");

  const isBase64 = /^[0-9A-Za-z+/=]+$/.test(candidate) && candidate.length % 4 === 0;
  const isHex = /^[0-9a-fA-F]+$/.test(candidate) && candidate.length % 2 === 0;

  let decoded: Buffer;
  if (isBase64) {
    decoded = Buffer.from(candidate, "base64");
  }
  else if (isHex) {
    decoded = Buffer.from(candidate, "hex");
  }
  else {
    decoded = Buffer.from(candidate, "utf8");
  }
  if (decoded.length !== 32) {
    throw new Error("DEVICE_SECRET_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }
  return decoded;
}

export function getClaimPassphrasePepper(): string {
  const envValue = process.env.CLAIM_PASSPHRASE_PEPPER;
  if (envValue) return envValue;

  try {
    const secretValue = claimPassphrasePepperSecret.value();
    if (secretValue) return secretValue;
  }
  catch {
    // ignore; fall through to error
  }
  throw new Error("CLAIM_PASSPHRASE_PEPPER is not configured");
}

export function getDeviceSecretEncryptionKey(): Buffer {
  const envValue = process.env.DEVICE_SECRET_ENCRYPTION_KEY;
  if (envValue) return decodeKeyMaterial(envValue);

  try {
    const secretValue = deviceSecretEncryptionKeySecret.value();
    if (secretValue) return decodeKeyMaterial(secretValue);
  }
  catch {
    // ignore; fall through to error
  }

  throw new Error("DEVICE_SECRET_ENCRYPTION_KEY is not configured");
}
