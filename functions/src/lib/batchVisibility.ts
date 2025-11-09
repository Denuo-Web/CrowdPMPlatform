import type { DocumentSnapshot } from "firebase-admin/firestore";
import { db } from "./fire.js";

export type BatchVisibility = "public" | "private";

export const DEFAULT_BATCH_VISIBILITY: BatchVisibility = "private";

export function normalizeBatchVisibility(value: unknown): BatchVisibility | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "public" || normalized === "private") {
    return normalized;
  }
  return null;
}

export async function getUserDefaultBatchVisibility(userId: string | undefined | null): Promise<BatchVisibility | null> {
  if (!userId) return null;
  try {
    const snap = await db().collection("userSettings").doc(userId).get();
    if (!snap.exists) return null;
    return normalizeBatchVisibility(snap.get("defaultBatchVisibility"));
  }
  catch (err) {
    console.warn("Failed to load user settings for visibility", { userId, err });
    return null;
  }
}

export async function getDeviceDefaultBatchVisibility(snapshot: DocumentSnapshot): Promise<BatchVisibility | null> {
  const explicit = normalizeBatchVisibility(snapshot.get("defaultBatchVisibility"));
  if (explicit) return explicit;
  const ownerUserIdRaw = snapshot.get("ownerUserId");
  const ownerUserIdsRaw = snapshot.get("ownerUserIds");
  const ownerUserId = typeof ownerUserIdRaw === "string" && ownerUserIdRaw.length > 0 ? ownerUserIdRaw : null;
  const ownerUserIds = Array.isArray(ownerUserIdsRaw)
    ? ownerUserIdsRaw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const candidates = Array.from(new Set([ownerUserId, ...ownerUserIds].filter((id): id is string => Boolean(id))));
  for (const candidate of candidates) {
    const pref = await getUserDefaultBatchVisibility(candidate);
    if (pref) return pref;
  }
  return null;
}
