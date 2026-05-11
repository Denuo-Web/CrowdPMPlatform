const DEFAULT_ACTIVATION_URL = "https://crowdpmplatform.web.app/activate";
const DEFAULT_PUBLIC_APP_BASE_URL = "https://crowdpmplatform.web.app";
const DEFAULT_TOKEN_ISSUER = "crowdpm";
const DEFAULT_TOKEN_AUDIENCE = "crowdpm_device_api";
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 600;
const DEFAULT_REGISTRATION_TOKEN_TTL_SECONDS = 60;

function readStringEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getActivationBaseUrl(): string {
  return readStringEnv("DEVICE_ACTIVATION_URL", DEFAULT_ACTIVATION_URL);
}

export function getVerificationUri(): string {
  return readStringEnv("DEVICE_VERIFICATION_URI", getActivationBaseUrl());
}

export function getPublicAppBaseUrl(): string {
  const explicit = process.env.PUBLIC_APP_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  try {
    return new URL(getActivationBaseUrl()).origin;
  }
  catch {
    return DEFAULT_PUBLIC_APP_BASE_URL;
  }
}

export function getDeviceTokenPrivateKey(): string {
  return process.env.DEVICE_TOKEN_PRIVATE_KEY ?? "";
}

export function getStripeSecretKey(): string {
  return readStringEnv("STRIPE_SECRET_KEY", "");
}

export function getStripeWebhookSecret(): string {
  return readStringEnv("STRIPE_WEBHOOK_SECRET", "");
}

export function getDeviceTokenIssuer(): string {
  return readStringEnv("DEVICE_TOKEN_ISSUER", DEFAULT_TOKEN_ISSUER);
}

export function getDeviceTokenAudience(): string {
  return readStringEnv("DEVICE_TOKEN_AUDIENCE", DEFAULT_TOKEN_AUDIENCE);
}

export function getAccessTokenTtlSeconds(): number {
  return readPositiveIntEnv("DEVICE_ACCESS_TOKEN_TTL_SECONDS", DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
}

export function getRegistrationTokenTtlSeconds(): number {
  return readPositiveIntEnv("DEVICE_REGISTRATION_TOKEN_TTL_SECONDS", DEFAULT_REGISTRATION_TOKEN_TTL_SECONDS);
}
