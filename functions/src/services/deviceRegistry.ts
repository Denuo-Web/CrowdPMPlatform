import crypto from "node:crypto";
import type { firestore } from "firebase-admin";
import { db } from "../lib/fire.js";
import { revokeTokensForDevice } from "./deviceTokens.js";
import { toDate } from "../lib/time.js";

type DocumentData = firestore.DocumentData;

export type DeviceRecord = {
  id: string;
  accId: string;
  ownerUserId: string;
  ownerUserIds: string[];
  model: string;
  version: string;
  status: string;
  registryStatus: "active" | "revoked" | "suspended";
  createdAt: Date;
  lastSeenAt: Date | null;
  pubKlJwk: Record<string, unknown>;
  pubKlThumbprint: string;
  keThumbprint: string;
};

function normalizeDevice(id: string, data: DocumentData | undefined): DeviceRecord | null {
  if (!data) return null;
  const accId = typeof data.accId === "string" ? data.accId : (typeof data.ownerUserId === "string" ? data.ownerUserId : null);
  if (!accId) return null;
  const ownerUserId = typeof data.ownerUserId === "string" ? data.ownerUserId : accId;
  const ownerUserIds = Array.isArray(data.ownerUserIds)
    ? data.ownerUserIds.filter((uid): uid is string => typeof uid === "string" && uid.length > 0)
    : [ownerUserId];
  const lowerRegistryStatus = typeof data.registryStatus === "string" ? data.registryStatus.toLowerCase() : null;
  const allowedStatuses = ["active", "revoked", "suspended"] as const;
  const normalizedStatus = (lowerRegistryStatus && allowedStatuses.includes(lowerRegistryStatus as typeof allowedStatuses[number]))
    ? (lowerRegistryStatus as typeof allowedStatuses[number])
    : null;
  return {
    id,
    accId,
    ownerUserId,
    ownerUserIds,
    model: typeof data.model === "string" ? data.model : "unknown",
    version: typeof data.version === "string" ? data.version : "unknown",
    status: typeof data.status === "string" ? data.status : "ACTIVE",
    registryStatus: normalizedStatus ?? (typeof data.status === "string" && data.status.toLowerCase() === "suspended" ? "suspended" : "active"),
    createdAt: toDate(data.createdAt) ?? new Date(0),
    lastSeenAt: toDate(data.lastSeenAt),
    pubKlJwk: typeof data.pubKlJwk === "object" && data.pubKlJwk
      ? data.pubKlJwk as Record<string, unknown>
      : {},
    pubKlThumbprint: typeof data.pubKlThumbprint === "string" ? data.pubKlThumbprint : "",
    keThumbprint: typeof data.keThumbprint === "string" ? data.keThumbprint : "",
  };
}

export async function registerDevice(args: {
  accountId: string;
  model: string;
  version: string;
  pubKlJwk: Record<string, unknown>;
  pubKlThumbprint: string;
  keThumbprint: string;
  pairingDeviceCode: string;
  fingerprint?: string;
}): Promise<{ deviceId: string; createdAt: Date; pubKlJwk: Record<string, unknown> }> {
  const deviceId = crypto.randomUUID();
  const createdAt = new Date();
  const ownerIds = [args.accountId];
  await db().collection("devices").doc(deviceId).set({
    accId: args.accountId,
    ownerUserId: args.accountId,
    ownerUserIds: ownerIds,
    model: args.model,
    version: args.version,
    status: "ACTIVE",
    registryStatus: "active",
    createdAt,
    lastSeenAt: null,
    pubKlJwk: args.pubKlJwk,
    pubKlThumbprint: args.pubKlThumbprint,
    keThumbprint: args.keThumbprint,
    pairingDeviceCode: args.pairingDeviceCode,
    fingerprint: args.fingerprint ?? null,
  });
  return { deviceId, createdAt, pubKlJwk: args.pubKlJwk };
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  const doc = await db().collection("devices").doc(deviceId).get();
  if (!doc.exists) return null;
  return normalizeDevice(doc.id, doc.data());
}

export async function updateDeviceLastSeen(deviceId: string): Promise<void> {
  await db().collection("devices").doc(deviceId).set({ lastSeenAt: new Date() }, { merge: true });
}

export async function revokeDevice(deviceId: string, initiatedBy: string, reason?: string): Promise<void> {
  const updates: Record<string, unknown> = {
    status: "REVOKED",
    registryStatus: "revoked",
    revokedAt: new Date(),
    revokedBy: initiatedBy,
  };
  if (reason) {
    updates.revocationReason = reason;
  }
  await db().collection("devices").doc(deviceId).set(updates, { merge: true });
  await revokeTokensForDevice(deviceId);
}
