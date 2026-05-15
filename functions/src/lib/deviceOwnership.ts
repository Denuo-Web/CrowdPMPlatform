import type { firestore } from "firebase-admin";
import { db } from "./fire.js";

export type DeviceOwnershipFields = {
  ownerUserIds?: unknown;
  accId?: unknown;
};

export type DeviceDocData = firestore.DocumentData | undefined;

function toOwnerId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeOwnerIds(data: DeviceOwnershipFields | undefined): string[] {
  if (!data) return [];
  const ids = new Set<string>();
  if (Array.isArray(data.ownerUserIds)) {
    for (const candidate of data.ownerUserIds) {
      const ownerId = toOwnerId(candidate);
      if (ownerId) ids.add(ownerId);
    }
  }
  return Array.from(ids);
}

export function primaryOwnerUserId(data: DeviceOwnershipFields | undefined): string | null {
  const ownerUserIds = normalizeOwnerIds(data);
  const accId = toOwnerId(data?.accId);
  if (accId && ownerUserIds.includes(accId)) {
    return accId;
  }
  return ownerUserIds[0] ?? null;
}

export function userOwnsDevice(data: DeviceOwnershipFields | undefined, userId: string): boolean {
  if (!userId) return false;
  return normalizeOwnerIds(data).includes(userId);
}

export async function loadOwnedDeviceDocs(userId: string): Promise<{
  collection: firestore.CollectionReference;
  docs: Map<string, firestore.DocumentData>;
}> {
  const collection = db().collection("devices");
  const ownedDevicesSnap = await collection.where("ownerUserIds", "array-contains", userId).get();

  const docs = new Map<string, firestore.DocumentData>();
  ownedDevicesSnap.forEach((doc) => {
    docs.set(doc.id, doc.data());
  });

  return { collection, docs };
}
