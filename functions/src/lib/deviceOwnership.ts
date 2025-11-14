import type { firestore } from "firebase-admin";
import { db } from "./fire.js";

export type DeviceOwnershipFields = {
  ownerUserId?: unknown;
  ownerUserIds?: unknown;
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
  const primary = toOwnerId(data.ownerUserId);
  if (primary) ids.add(primary);
  if (Array.isArray(data.ownerUserIds)) {
    for (const candidate of data.ownerUserIds) {
      const ownerId = toOwnerId(candidate);
      if (ownerId) ids.add(ownerId);
    }
  }
  return Array.from(ids);
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
  const [multiOwnerSnap, legacySnap] = await Promise.all([
    collection.where("ownerUserIds", "array-contains", userId).get(),
    collection.where("ownerUserId", "==", userId).get(),
  ]);

  const docs = new Map<string, firestore.DocumentData>();
  [multiOwnerSnap, legacySnap].forEach((snap) => {
    snap.forEach((doc) => {
      if (!docs.has(doc.id)) {
        docs.set(doc.id, doc.data());
      }
    });
  });

  return { collection, docs };
}
