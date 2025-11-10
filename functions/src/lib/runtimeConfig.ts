import { config } from "firebase-functions";
import { defineSecret } from "firebase-functions/params";

export const deviceTokenPrivateKeySecret = defineSecret("DEVICE_TOKEN_PRIVATE_KEY");

type CrowdpmConfig = {
  ingest?: {
    topic?: string;
  };
  pairing?: {
    activation_url?: string;
    verification_uri?: string;
  };
  tokens?: {
    issuer?: string;
    audience?: string;
    access_ttl_seconds?: number;
    registration_ttl_seconds?: number;
  };
};

function readConfig(): CrowdpmConfig {
  try {
    return config() as CrowdpmConfig;
  }
  catch {
    return {};
  }
}

export function getIngestTopic(): string {
  const cfg = readConfig();
  return process.env.INGEST_TOPIC || cfg.ingest?.topic || "ingest.raw";
}

export function getActivationBaseUrl(): string {
  const cfg = readConfig();
  return process.env.DEVICE_ACTIVATION_URL
    || cfg.pairing?.activation_url
    || "https://crowdpmplatform.web.app/activate";
}

export function getVerificationUri(): string {
  const cfg = readConfig();
  return process.env.DEVICE_VERIFICATION_URI
    || cfg.pairing?.verification_uri
    || getActivationBaseUrl();
}

export function getDeviceTokenPrivateKey(): string {
  const envKey = process.env.DEVICE_TOKEN_PRIVATE_KEY;
  if (envKey) return envKey;
  try {
    const secret = deviceTokenPrivateKeySecret.value();
    if (secret) return secret;
  }
  catch {
    // ignored – fall back to config/env
  }
  return "";
}

export function getDeviceTokenIssuer(): string {
  const cfg = readConfig();
  return process.env.DEVICE_TOKEN_ISSUER
    || cfg.tokens?.issuer
    || "crowdpm";
}

export function getDeviceTokenAudience(): string {
  const cfg = readConfig();
  return process.env.DEVICE_TOKEN_AUDIENCE
    || cfg.tokens?.audience
    || "crowdpm_device_api";
}

export function getAccessTokenTtlSeconds(): number {
  const cfg = readConfig();
  const envValue = Number(process.env.DEVICE_ACCESS_TOKEN_TTL_SECONDS);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;
  const cfgValue = Number(cfg.tokens?.access_ttl_seconds);
  if (Number.isFinite(cfgValue) && cfgValue > 0) return cfgValue;
  return 600; // 10 minutes default
}

export function getRegistrationTokenTtlSeconds(): number {
  const cfg = readConfig();
  const envValue = Number(process.env.DEVICE_REGISTRATION_TOKEN_TTL_SECONDS);
  if (Number.isFinite(envValue) && envValue > 0) return envValue;
  const cfgValue = Number(cfg.tokens?.registration_ttl_seconds);
  if (Number.isFinite(cfgValue) && cfgValue > 0) return cfgValue;
  return 60; // 1 minute default
}
