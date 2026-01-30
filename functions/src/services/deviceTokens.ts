import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { importPKCS8, importSPKI, jwtVerify, SignJWT, type JWTPayload } from "jose";
import { db } from "../lib/fire.js";
import {
  getAccessTokenTtlSeconds,
  getDeviceTokenAudience,
  getDeviceTokenIssuer,
  getDeviceTokenPrivateKey,
  getRegistrationTokenTtlSeconds,
} from "../lib/runtimeConfig.js";

type RegistrationClaims = JWTPayload & {
  kind: "registration";
  device_code: string;
  acc_id: string;
  cnf: { jkt: string };
  session_id?: string;
};

export type VerifiedRegistrationToken = RegistrationClaims & { jti: string };

type DeviceAccessClaims = JWTPayload & {
  kind: "device_access";
  device_id: string;
  acc_id: string;
  scope: string[];
  cnf: { jkt: string };
};

export type VerifiedDeviceAccessToken = DeviceAccessClaims & { jti: string };

type KeyMaterial = {
  privatePem: string;
  publicPem: string;
  generated: boolean;
};

type SigningKey = Awaited<ReturnType<typeof importPKCS8>>;
type VerificationKey = Awaited<ReturnType<typeof importSPKI>>;

let cachedKeys: KeyMaterial | null = null;
let signingKeyPromise: Promise<SigningKey> | null = null;
let verificationKeyPromise: Promise<VerificationKey> | null = null;

class DeviceTokenKeyError extends Error {
  readonly statusCode = 500;
  readonly code = "missing_device_token_private_key";

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, DeviceTokenKeyError.prototype);
  }
}

function allowEphemeralKeys(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true"
    || process.env.NODE_ENV === "test"
    || process.env.ALLOW_EPHEMERAL_DEVICE_TOKEN_KEYS === "true";
}

function loadEphemeralFromFile(filePath: string): KeyMaterial | null {
  const resolved = resolvePath(filePath);
  if (!existsSync(resolved)) return null;
  const privatePem = readFileSync(resolved, "utf8");
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    generated: false,
  };
}

function persistEphemeralToFile(filePath: string, privatePem: string): void {
  const resolved = resolvePath(filePath);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, privatePem, "utf8");
}

function loadOrCreateKeyMaterial(): KeyMaterial {
  if (cachedKeys) return cachedKeys;
  const configured = getDeviceTokenPrivateKey()?.trim();
  if (configured) {
    const privatePem = configured.includes("-----BEGIN") ? configured : `-----BEGIN PRIVATE KEY-----\n${configured}\n-----END PRIVATE KEY-----`;
    const privateKey = crypto.createPrivateKey(privatePem);
    const publicKey = crypto.createPublicKey(privateKey);
    cachedKeys = {
      privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      generated: false,
    };
    return cachedKeys;
  }
  if (!allowEphemeralKeys()) {
    throw new DeviceTokenKeyError("DEVICE_TOKEN_PRIVATE_KEY is not configured; refusing to issue device tokens.");
  }
  const ephemeralPath = process.env.DEVICE_TOKEN_PRIVATE_KEY_FILE ?? "/tmp/crowdpm-device-token-key.pem";
  const loadedFromFile = loadEphemeralFromFile(ephemeralPath);
  if (loadedFromFile) {
    cachedKeys = loadedFromFile;
    console.warn(`DEVICE_TOKEN_PRIVATE_KEY not set. Reusing cached ephemeral signing key at ${ephemeralPath}.`);
    return cachedKeys;
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  if (ephemeralPath) {
    try {
      persistEphemeralToFile(ephemeralPath, privatePem);
    }
    catch (err) {
      console.warn({ err }, `Failed to persist ephemeral device token key to ${ephemeralPath}; continuing with in-memory key.`);
    }
  }
  const fallback: KeyMaterial = {
    privatePem,
    publicPem,
    generated: true,
  };
  console.warn(`DEVICE_TOKEN_PRIVATE_KEY is not set. Generated ${ephemeralPath ? "cached" : "ephemeral"} signing key for this instance (emulator/test only).`);
  cachedKeys = fallback;
  return fallback;
}

async function getSigningKey(): Promise<SigningKey> {
  if (!signingKeyPromise) {
    const { privatePem } = loadOrCreateKeyMaterial();
    signingKeyPromise = importPKCS8(privatePem, "EdDSA");
  }
  return signingKeyPromise;
}

async function getVerificationKey(): Promise<VerificationKey> {
  if (!verificationKeyPromise) {
    const { publicPem } = loadOrCreateKeyMaterial();
    verificationKeyPromise = importSPKI(publicPem, "EdDSA");
  }
  return verificationKeyPromise;
}

function registrationAudience(): string {
  return "device_register";
}

function unauthorized(message: string) {
  return Object.assign(new Error(message), { statusCode: 401 });
}

export async function issueRegistrationToken(args: {
  deviceCode: string;
  accountId: string;
  sessionId: string;
  confirmationThumbprint: string;
}): Promise<{ token: string; expiresIn: number; jti: string }> {
  const signer = await getSigningKey();
  const ttl = getRegistrationTokenTtlSeconds();
  const now = Math.floor(Date.now() / 1000);
  const jti = crypto.randomUUID();
  const token = await new SignJWT({
    kind: "registration",
    device_code: args.deviceCode,
    acc_id: args.accountId,
    session_id: args.sessionId,
    cnf: { jkt: args.confirmationThumbprint },
  } satisfies RegistrationClaims)
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(getDeviceTokenIssuer())
    .setAudience(registrationAudience())
    .setSubject(args.accountId)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(signer);
  return { token, expiresIn: ttl, jti };
}

export async function verifyRegistrationToken(raw: string): Promise<VerifiedRegistrationToken> {
  let payload: RegistrationClaims & { jti?: string };
  try {
    const verified = await jwtVerify<RegistrationClaims>(raw, await getVerificationKey(), {
      issuer: getDeviceTokenIssuer(),
      audience: registrationAudience(),
    });
    payload = { ...verified.payload, jti: verified.payload.jti };
  }
  catch (err) {
    if (err instanceof DeviceTokenKeyError) throw err;
    throw unauthorized(err instanceof Error ? err.message : "invalid registration token");
  }
  if (payload.kind !== "registration") throw unauthorized("Invalid registration token");
  if (!payload.cnf?.jkt) throw unauthorized("Registration token missing confirmation claim");
  if (!payload.device_code) throw unauthorized("Registration token missing device code");
  if (!payload.acc_id) throw unauthorized("Registration token missing account id");
  if (!payload.jti) throw unauthorized("Registration token missing jti");
  return payload as VerifiedRegistrationToken;
}

export async function issueDeviceAccessToken(args: {
  deviceId: string;
  accountId: string;
  confirmationThumbprint: string;
  scope?: string[];
}): Promise<{ token: string; expiresIn: number; jti: string }> {
  const signer = await getSigningKey();
  const ttl = getAccessTokenTtlSeconds();
  const now = Math.floor(Date.now() / 1000);
  const scope = args.scope?.length ? Array.from(new Set(args.scope)) : ["ingest.write"];
  const jti = crypto.randomUUID();
  const token = await new SignJWT({
    kind: "device_access",
    device_id: args.deviceId,
    acc_id: args.accountId,
    scope,
    cnf: { jkt: args.confirmationThumbprint },
  } satisfies DeviceAccessClaims)
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
    .setIssuer(getDeviceTokenIssuer())
    .setAudience(getDeviceTokenAudience())
    .setSubject(args.deviceId)
    .setJti(jti)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(signer);

  const expiresAt = new Date((now + ttl) * 1000);
  await db().collection("device_tokens").doc(jti).set({
    deviceId: args.deviceId,
    accId: args.accountId,
    issuedAt: new Date(now * 1000),
    expiresAt,
    revoked: false,
    scope,
    cnfJkt: args.confirmationThumbprint,
  });

  return { token, expiresIn: ttl, jti };
}

type TokenCacheEntry = {
  expiresAtMs: number;
};

const tokenCache = new Map<string, TokenCacheEntry>();

export async function verifyDeviceAccessToken(raw: string): Promise<VerifiedDeviceAccessToken> {
  let payload: DeviceAccessClaims & { jti?: string };
  try {
    const verified = await jwtVerify<DeviceAccessClaims>(raw, await getVerificationKey(), {
      issuer: getDeviceTokenIssuer(),
      audience: getDeviceTokenAudience(),
    });
    payload = { ...verified.payload, jti: verified.payload.jti };
  }
  catch (err) {
    if (err instanceof DeviceTokenKeyError) throw err;
    throw unauthorized(err instanceof Error ? err.message : "invalid device token");
  }
  if (payload.kind !== "device_access") throw unauthorized("Invalid device access token");
  if (!payload.cnf?.jkt) throw unauthorized("Device token missing confirmation claim");
  if (!payload.device_id) throw unauthorized("Device token missing device id");
  if (!payload.acc_id) throw unauthorized("Device token missing account id");
  if (!payload.jti) throw unauthorized("Device token missing jti");

  const cacheEntry = tokenCache.get(payload.jti);
  const now = Date.now();
  if (!cacheEntry || cacheEntry.expiresAtMs <= now) {
    const doc = await db().collection("device_tokens").doc(payload.jti).get();
    if (!doc.exists) throw unauthorized("Unknown device token");
    const data = doc.data() as { revoked?: boolean; expiresAt?: { toDate?: () => Date } | Date | string | number } | undefined;
    if (data?.revoked) throw unauthorized("Device token revoked");
    const expiresAt = data?.expiresAt instanceof Date
      ? data.expiresAt
      : typeof data?.expiresAt === "object" && data.expiresAt && "toDate" in data.expiresAt
        ? (data.expiresAt as { toDate: () => Date }).toDate()
        : typeof data?.expiresAt === "string"
          ? new Date(data.expiresAt)
          : typeof data?.expiresAt === "number"
            ? new Date(data.expiresAt)
            : new Date(now + 1000);
    tokenCache.set(payload.jti, { expiresAtMs: expiresAt.getTime() });
  }
  return payload as VerifiedDeviceAccessToken;
}

export async function revokeTokensForDevice(deviceId: string): Promise<void> {
  const snap = await db().collection("device_tokens").where("deviceId", "==", deviceId).get();
  await Promise.all(snap.docs.map((doc) => doc.ref.set({ revoked: true }, { merge: true })));
  snap.docs.forEach((doc) => tokenCache.delete(doc.id));
}
