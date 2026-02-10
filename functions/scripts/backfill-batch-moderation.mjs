#!/usr/bin/env node
import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const PAGE_SIZE = 300;

function normalizeModerationState(value) {
  if (value === "approved" || value === "quarantined") return value;
  return "approved";
}

function buildUpdates(doc) {
  const data = doc.data() ?? {};
  const updates = {};

  const deviceId = doc.ref.parent.parent?.id;
  if (deviceId && typeof data.deviceId !== "string") {
    updates.deviceId = deviceId;
  }

  if (normalizeModerationState(data.moderationState) !== data.moderationState) {
    updates.moderationState = "approved";
  }

  if (!("moderationReason" in data)) {
    updates.moderationReason = null;
  }
  if (!("moderatedBy" in data)) {
    updates.moderatedBy = null;
  }
  if (!("moderatedAt" in data)) {
    updates.moderatedAt = null;
  }

  return updates;
}

async function run() {
  let processed = 0;
  let updated = 0;
  let lastDoc = null;

  while (true) {
    let query = db.collectionGroup("batches")
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
      const updates = buildUpdates(doc);
      if (!Object.keys(updates).length) continue;
      batch.set(doc.ref, updates, { merge: true });
      pageWrites += 1;
    }

    if (pageWrites) {
      await batch.commit();
      updated += pageWrites;
    }

    processed += snap.size;
    lastDoc = snap.docs[snap.docs.length - 1];
    console.log(`[backfill-batch-moderation] processed=${processed} updated=${updated}`);
  }

  console.log(`[backfill-batch-moderation] complete processed=${processed} updated=${updated}`);
}

run().catch((err) => {
  console.error("[backfill-batch-moderation] failed", err);
  process.exitCode = 1;
});
