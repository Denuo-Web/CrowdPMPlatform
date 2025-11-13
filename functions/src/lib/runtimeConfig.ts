import { defineInt, defineSecret, defineString } from "firebase-functions/params";

const DEFAULT_INGEST_TOPIC = "ingest.raw";
const DEFAULT_ACTIVATION_URL = "https://crowdpmplatform.web.app/activate";
const DEFAULT_TOKEN_ISSUER = "crowdpm";
const DEFAULT_TOKEN_AUDIENCE = "crowdpm_device_api";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 600;
const DEFAULT_REGISTRATION_TOKEN_TTL_SECONDS = 60;

export const ingestTopicParam = defineString("INGEST_TOPIC", { default: DEFAULT_INGEST_TOPIC });
export const activationUrlParam = defineString("DEVICE_ACTIVATION_URL", { default: DEFAULT_ACTIVATION_URL });
export const verificationUriParam = defineString("DEVICE_VERIFICATION_URI", { default: DEFAULT_ACTIVATION_URL });
export const deviceTokenIssuerParam = defineString("DEVICE_TOKEN_ISSUER", { default: DEFAULT_TOKEN_ISSUER });
export const deviceTokenAudienceParam = defineString("DEVICE_TOKEN_AUDIENCE", { default: DEFAULT_TOKEN_AUDIENCE });
export const accessTokenTtlSecondsParam = defineInt("DEVICE_ACCESS_TOKEN_TTL_SECONDS", {
  default: DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
});
export const registrationTokenTtlSecondsParam = defineInt("DEVICE_REGISTRATION_TOKEN_TTL_SECONDS", {
  default: DEFAULT_REGISTRATION_TOKEN_TTL_SECONDS,
});

export const deviceTokenPrivateKeySecret = defineSecret("DEVICE_TOKEN_PRIVATE_KEY");

export function getIngestTopic(): string {
  const value = ingestTopicParam.value().trim();
  return value || DEFAULT_INGEST_TOPIC;
}

export function getActivationBaseUrl(): string {
  const value = activationUrlParam.value().trim();
  return value || DEFAULT_ACTIVATION_URL;
}

export function getVerificationUri(): string {
  const value = verificationUriParam.value().trim();
  return value || getActivationBaseUrl();
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
  const value = deviceTokenIssuerParam.value().trim();
  return value || DEFAULT_TOKEN_ISSUER;
}

export function getDeviceTokenAudience(): string {
  const value = deviceTokenAudienceParam.value().trim();
  return value || DEFAULT_TOKEN_AUDIENCE;
}

export function getAccessTokenTtlSeconds(): number {
  const value = accessTokenTtlSecondsParam.value();
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
}

export function getRegistrationTokenTtlSeconds(): number {
  const value = registrationTokenTtlSecondsParam.value();
  if (Number.isFinite(value) && value > 0) return value;
  return DEFAULT_REGISTRATION_TOKEN_TTL_SECONDS;
}
