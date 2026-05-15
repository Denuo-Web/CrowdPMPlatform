import type { DocumentSnapshot } from "firebase-admin/firestore";
import type { BatchVisibility } from "@crowdpm/types";
import { normalizeOwnerIds } from "./deviceOwnership.js";
import { db } from "./fire.js";
import {
  defaultBatchVisibilityForSubscription,
  getSubscriptionSummary,
} from "../services/accountEntitlements.js";

export type { BatchVisibility };

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
    const [snap, subscription] = await Promise.all([
      db().collection("userSettings").doc(userId).get(),
      getSubscriptionSummary(userId, db()),
    ]);
    const preferred = snap.exists ? normalizeBatchVisibility(snap.get("defaultBatchVisibility")) : null;
    if (preferred === "private" && subscription.limits.maxStoredPrivateBatches < 1) {
      return "public";
    }
    return preferred ?? defaultBatchVisibilityForSubscription(subscription);
  }
  catch (err) {
    console.warn("Failed to load user settings for visibility", { userId, err });
    return null;
  }
}

export async function getDeviceDefaultBatchVisibility(snapshot: DocumentSnapshot): Promise<BatchVisibility | null> {
  const explicit = normalizeBatchVisibility(snapshot.get("defaultBatchVisibility"));
  if (explicit === "public") {
    return "public";
  }
  const ownerUserIds = normalizeOwnerIds({ ownerUserIds: snapshot.get("ownerUserIds") });
  for (const candidate of ownerUserIds) {
    const pref = await getUserDefaultBatchVisibility(candidate);
    if (explicit === "private") {
      return pref === "private" ? "private" : "public";
    }
    if (pref) return pref;
  }
  return explicit;
}
