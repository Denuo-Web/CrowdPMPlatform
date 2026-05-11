#!/usr/bin/env node
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const parsedPageSize = Number.parseInt(process.env.PAGE_SIZE ?? "300", 10);
const PAGE_SIZE = Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? parsedPageSize : 300;

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function toOwnerId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOwnerIds(data) {
  const ids = new Set();
  if (Array.isArray(data.ownerUserIds)) {
    for (const value of data.ownerUserIds) {
      const ownerId = toOwnerId(value);
      if (ownerId) ids.add(ownerId);
    }
  }
  const legacyOwnerId = toOwnerId(data.ownerUserId);
  if (legacyOwnerId) ids.add(legacyOwnerId);
  return Array.from(ids);
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildUpdates(data) {
  const updates = {};
  const ownerIds = normalizeOwnerIds(data);
  const currentOwnerIds = Array.isArray(data.ownerUserIds)
    ? data.ownerUserIds.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];

  if (ownerIds.length && !arraysEqual(ownerIds, currentOwnerIds)) {
    updates.ownerUserIds = ownerIds;
  }

  const primaryOwnerId = ownerIds[0] ?? null;
  if (primaryOwnerId && typeof data.accId !== "string") {
    updates.accId = primaryOwnerId;
  }

  if (Object.prototype.hasOwnProperty.call(data, "ownerUserId")) {
    updates.ownerUserId = admin.firestore.FieldValue.delete();
  }

  return updates;
}

async function run() {
  const dryRun = hasFlag("dry-run");
  let processed = 0;
  let updated = 0;
  let lastDoc = null;

  while (true) {
    let query = db.collection("devices")
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) {
      break;
    }

    const batch = db.batch();
    let pageWrites = 0;

    for (const doc of snap.docs) {
      const updates = buildUpdates(doc.data() ?? {});
      if (!Object.keys(updates).length) continue;
      if (!dryRun) {
        batch.set(doc.ref, updates, { merge: true });
      }
      pageWrites += 1;
    }

    if (pageWrites && !dryRun) {
      await batch.commit();
    }

    processed += snap.size;
    updated += pageWrites;
    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`[backfill-device-ownership] processed=${processed} ${dryRun ? "wouldUpdate" : "updated"}=${updated}`);
  }

  console.log(`[backfill-device-ownership] complete processed=${processed} ${dryRun ? "wouldUpdate" : "updated"}=${updated}`);
}

run().catch((err) => {
  console.error("[backfill-device-ownership] failed", err);
  process.exitCode = 1;
});
