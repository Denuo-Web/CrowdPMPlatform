import crypto from "node:crypto";
import { getClaimPassphrasePepper, getDeviceSecretEncryptionKey } from "./runtimeConfig.js";

const DEVICE_SECRET_ALGO = "aes-256-gcm";

export type DeviceSecretRecord = {
  algorithm: typeof DEVICE_SECRET_ALGO;
  version: 1;
  ciphertext: string;
  iv: string;
  authTag: string;
  createdAt: string;
};

export function generateDeviceSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

function normalisePassphrase(source: string): string {
  return source.normalize("NFKC").trim();
}

export function hashClaimPassphrase(passphrase: string): string {
  const pepper = getClaimPassphrasePepper();
  const normalised = normalisePassphrase(passphrase);
  if (!normalised) throw new Error("passphrase must not be blank");
  const hasher = crypto.createHash("sha256");
  hasher.update(pepper);
  hasher.update(":");
  hasher.update(normalised);
  return hasher.digest("hex");
}

export function encryptDeviceSecret(secret: string): DeviceSecretRecord {
  if (!secret) throw new Error("device secret must not be empty");
  const key = getDeviceSecretEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(DEVICE_SECRET_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: DEVICE_SECRET_ALGO,
    version: 1,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
    createdAt: new Date().toISOString(),
  };
}

export function decryptDeviceSecret(record: DeviceSecretRecord): string {
  if (!record || record.algorithm !== DEVICE_SECRET_ALGO) {
    throw new Error("unsupported device secret record");
  }
  const key = getDeviceSecretEncryptionKey();
  const iv = Buffer.from(record.iv, "base64");
  const authTag = Buffer.from(record.authTag, "base64");
  const decipher = crypto.createDecipheriv(DEVICE_SECRET_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
