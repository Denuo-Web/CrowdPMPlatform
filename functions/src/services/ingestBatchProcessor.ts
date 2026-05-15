import type { BatchVisibility } from "@crowdpm/types";
import { DEFAULT_MODERATION_STATE } from "../lib/moderation.js";
import { db } from "../lib/fire.js";
import type { IngestPayload } from "../lib/validation.js";
import {
  BATCH_SCHEMA_VERSION,
  summarizeBatchPayload,
  type BatchMetadataDocument,
} from "./batchPayloads.js";

export type ProcessIngestBatchRequest = {
  deviceId: string;
  batchId: string;
  storagePath: string;
  compressedBytes: number;
  visibility: BatchVisibility;
  payload: IngestPayload;
  ownerUserIds: string[];
  deviceName: string | null;
};

export type ProcessIngestBatchResult = {
  count: number;
  visibility: BatchVisibility;
};

export async function processIngestBatch(request: ProcessIngestBatchRequest): Promise<ProcessIngestBatchResult> {
  const summary = summarizeBatchPayload(request.payload);
  const metadata: BatchMetadataDocument = {
    schemaVersion: BATCH_SCHEMA_VERSION,
    batchId: request.batchId,
    deviceId: request.deviceId,
    ownerUserIds: request.ownerUserIds,
    deviceNameSnapshot: request.deviceName,
    storagePath: request.storagePath,
    compressedBytes: request.compressedBytes,
    count: summary.pointCount,
    startedAt: summary.startedAt,
    endedAt: summary.endedAt,
    bounds: summary.bounds,
    processedAt: new Date(),
    visibility: request.visibility,
    moderationState: DEFAULT_MODERATION_STATE,
    moderationReason: null,
    moderatedBy: null,
    moderatedAt: null,
  };

  await db().collection("batches").doc(request.batchId).set(metadata);
  return { count: summary.pointCount, visibility: request.visibility };
}
