import type { firestore } from "firebase-admin";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { FUNCTION_REGION } from "../lib/functionOptions.js";
import { normalizeVisibility } from "../lib/httpValidation.js";
import { normalizeModerationState } from "../lib/moderation.js";
import { refreshPublicBatchMapSnapshot } from "./publicBatchMapSnapshot.js";

function isPublicApprovedBatch(data: firestore.DocumentData | undefined): boolean {
  return normalizeVisibility(data?.visibility) === "public"
    && normalizeModerationState(data?.moderationState) === "approved";
}

function shouldRefreshPublicBatchMap(
  before: firestore.DocumentData | undefined,
  after: firestore.DocumentData | undefined,
): boolean {
  return isPublicApprovedBatch(before) || isPublicApprovedBatch(after);
}

export const refreshPublicBatchMap = onDocumentWritten({
  document: "batches/{batchId}",
  region: FUNCTION_REGION,
  timeoutSeconds: 300,
  memory: "512MiB",
  concurrency: 1,
  maxInstances: 2,
}, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!shouldRefreshPublicBatchMap(before, after)) {
    return;
  }

  await refreshPublicBatchMapSnapshot(console);
});
