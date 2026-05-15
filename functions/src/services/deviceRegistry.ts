import crypto from "node:crypto";
import type { firestore } from "firebase-admin";
import { db } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";
import { revokeTokensForDevice } from "./deviceTokens.js";
import { toDate } from "../lib/time.js";
import { decrementActiveDeviceCount, writeDeviceWithQuota } from "./accountEntitlements.js";

type DocumentData = firestore.DocumentData;

export type DeviceRecord = {
  id: string;
  accId: string;
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
  const accId = typeof data.accId === "string" ? data.accId : null;
  if (!accId) return null;
  const ownerUserIds = Array.isArray(data.ownerUserIds)
    ? data.ownerUserIds.filter((uid): uid is string => typeof uid === "string" && uid.length > 0)
    : [accId];
  const lowerRegistryStatus = typeof data.registryStatus === "string" ? data.registryStatus.toLowerCase() : null;
  const allowedStatuses = ["active", "revoked", "suspended"] as const;
  const normalizedStatus = (lowerRegistryStatus && allowedStatuses.includes(lowerRegistryStatus as typeof allowedStatuses[number]))
    ? (lowerRegistryStatus as typeof allowedStatuses[number])
    : null;
  return {
    id,
    accId,
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
  const targetDb = db();
  await writeDeviceWithQuota({
    userId: args.accountId,
    targetDb,
    now: createdAt,
    deviceRef: targetDb.collection("devices").doc(deviceId),
    deviceData: {
      accId: args.accountId,
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
    },
  });
  return { deviceId, createdAt, pubKlJwk: args.pubKlJwk };
}

export async function getDevice(deviceId: string): Promise<DeviceRecord | null> {
  const doc = await db().collection("devices").doc(deviceId).get();
  if (!doc.exists) return null;
  return normalizeDevice(doc.id, doc.data());
}

export async function updateDeviceLastSeen(deviceId: string, targetDb: firestore.Firestore = db()): Promise<void> {
  await targetDb.collection("devices").doc(deviceId).set({ lastSeenAt: new Date() }, { merge: true });
}

export async function revokeDevice(deviceId: string, initiatedBy: string, reason?: string): Promise<void> {
  const targetDb = db();
  const existing = await targetDb.collection("devices").doc(deviceId).get();
  const data = existing.data() ?? {};
  const ownerUserIds = Array.isArray(data.ownerUserIds)
    ? data.ownerUserIds.filter((value): value is string => typeof value === "string" && value.length > 0)
    : (typeof data.accId === "string" && data.accId.length > 0 ? [data.accId] : []);
  const currentStatus = typeof data.status === "string" ? data.status.toUpperCase() : "";
  const currentRegistryStatus = typeof data.registryStatus === "string" ? data.registryStatus.toLowerCase() : "";
  const wasActive = currentStatus !== "REVOKED" && currentStatus !== "SUSPENDED"
    && currentRegistryStatus !== "revoked" && currentRegistryStatus !== "suspended";
  const updates: Record<string, unknown> = {
    status: "REVOKED",
    registryStatus: "revoked",
    revokedAt: new Date(),
    revokedBy: initiatedBy,
  };
  if (reason) {
    updates.revocationReason = reason;
  }
  await targetDb.collection("devices").doc(deviceId).set(updates, { merge: true });
  if (wasActive) {
    await Promise.all(ownerUserIds.map((userId) => decrementActiveDeviceCount({
      userId,
      targetDb,
    })));
  }
  await revokeTokensForDevice(deviceId);
}

export async function suspendDevice(deviceId: string, initiatedBy: string, reason?: string): Promise<{
  before: { status: string | null; registryStatus: string | null };
  after: { status: "SUSPENDED"; registryStatus: "suspended"; suspendedBy: string };
}> {
  const targetDb = db();
  const existing = await targetDb.collection("devices").doc(deviceId).get();
  if (!existing.exists) {
    throw httpError(404, "not_found", "Device not found");
  }

  const data = existing.data() ?? {};
  const ownerUserIds = Array.isArray(data.ownerUserIds)
    ? data.ownerUserIds.filter((value): value is string => typeof value === "string" && value.length > 0)
    : (typeof data.accId === "string" && data.accId.length > 0 ? [data.accId] : []);
  const currentStatus = typeof data.status === "string" ? data.status.toUpperCase() : "";
  const currentRegistryStatus = typeof data.registryStatus === "string" ? data.registryStatus.toLowerCase() : "";
  const wasActive = currentStatus !== "REVOKED" && currentStatus !== "SUSPENDED"
    && currentRegistryStatus !== "revoked" && currentRegistryStatus !== "suspended";
  const updates: Record<string, unknown> = {
    status: "SUSPENDED",
    registryStatus: "suspended",
    suspendedAt: new Date(),
    suspendedBy: initiatedBy,
  };
  if (reason) {
    updates.suspensionReason = reason;
  }

  await targetDb.collection("devices").doc(deviceId).set(updates, { merge: true });
  if (wasActive) {
    await Promise.all(ownerUserIds.map((userId) => decrementActiveDeviceCount({
      userId,
      targetDb,
    })));
  }
  await revokeTokensForDevice(deviceId);

  return {
    before: {
      status: typeof data.status === "string" ? data.status : null,
      registryStatus: typeof data.registryStatus === "string" ? data.registryStatus : null,
    },
    after: {
      status: "SUSPENDED",
      registryStatus: "suspended",
      suspendedBy: initiatedBy,
    },
  };
}
