import crypto from "node:crypto";
import type { PublicBatchDetail, PublicBatchMapResponse, PublicBatchSummary } from "@crowdpm/types";
import type { firestore } from "firebase-admin";
import { bucket, db } from "../lib/fire.js";
import { normalizeTimestamp } from "../lib/httpValidation.js";
import { normalizeModerationState } from "../lib/moderation.js";
import { timestampToMillis } from "../lib/time.js";
import { decodeBatchPayload } from "./batchPayloads.js";

export const PUBLIC_BATCH_MAP_MAX_LIMIT = 200;
export const PUBLIC_BATCH_MAP_DEFAULT_LIMIT = 200;
export const PUBLIC_BATCH_MAP_OBJECT_PATH = "public/v1/batches/map.json";
export const PUBLIC_BATCH_MAP_CACHE_CONTROL = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

const PUBLIC_BATCH_MAP_CONCURRENCY = 8;

type PublicMapLogger = {
  error?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
  info?: (payload: unknown, message?: string) => void;
};

export type PublicBatchMapSnapshot = {
  response: PublicBatchMapResponse;
  etag: string;
};

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function serializeSummary(doc: firestore.QueryDocumentSnapshot | firestore.DocumentSnapshot): PublicBatchSummary {
  const data = doc.data() ?? {};
  const deviceId = asString(data.deviceId);
  return {
    batchId: doc.id,
    deviceId,
    deviceName: typeof data.deviceNameSnapshot === "string" && data.deviceNameSnapshot.trim().length > 0
      ? data.deviceNameSnapshot
      : null,
    count: asNumber(data.count),
    processedAt: normalizeTimestamp(data.processedAt),
    visibility: "public",
    moderationState: normalizeModerationState(data.moderationState),
  };
}

function detailFromSummary(summary: PublicBatchSummary, points: PublicBatchDetail["points"]): PublicBatchDetail {
  return {
    ...summary,
    points,
  };
}

async function readBatchPoints(storagePath: string): Promise<PublicBatchDetail["points"]> {
  const [buf] = await bucket().file(storagePath).download();
  return decodeBatchPayload(buf, storagePath).points;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) {
        return;
      }
      results[index] = await mapper(values[index], index);
    }
  }));

  return results;
}

async function listPublicApprovedBatchDocs(limit: number) {
  const snap = await db().collection("batches")
    .where("visibility", "==", "public")
    .where("moderationState", "==", "approved")
    .orderBy("processedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs;
}

function isPublicBatchMapResponse(value: unknown): value is PublicBatchMapResponse {
  return typeof value === "object"
    && value !== null
    && Array.isArray((value as { batches?: unknown }).batches);
}

function snapshotEtagFromBytes(bytes: Buffer): string {
  const hash = crypto.createHash("sha256").update(bytes).digest("base64url");
  return `"public-map-${hash}"`;
}

function serializeSnapshot(response: PublicBatchMapResponse): Buffer {
  return Buffer.from(JSON.stringify(response), "utf8");
}

function isStorageNotFoundError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 404 || code === "404";
}

export function publicBatchMapEtag(response: PublicBatchMapResponse): string {
  return snapshotEtagFromBytes(serializeSnapshot(response));
}

export function filterPublicBatchMapResponse(
  response: PublicBatchMapResponse,
  options: { limit: number; sinceMs: number | null },
): PublicBatchMapResponse {
  const sinceMs = options.sinceMs;
  const filtered = sinceMs === null
    ? response.batches
    : response.batches.filter((batch) => {
      const processedAtMs = timestampToMillis(batch.processedAt);
      return processedAtMs !== null && processedAtMs >= sinceMs;
    });
  return {
    batches: filtered.slice(0, options.limit),
  };
}

export async function buildPublicBatchMapResponse(options?: {
  limit?: number;
  sinceMs?: number | null;
  logger?: PublicMapLogger;
}): Promise<PublicBatchMapResponse> {
  const limit = Math.min(
    PUBLIC_BATCH_MAP_MAX_LIMIT,
    Math.max(1, Math.floor(options?.limit ?? PUBLIC_BATCH_MAP_DEFAULT_LIMIT)),
  );
  const sinceMs = options?.sinceMs ?? null;
  const docs = await listPublicApprovedBatchDocs(limit);
  const filteredDocs = sinceMs === null
    ? docs
    : docs.filter((doc) => {
      const processedAtMs = timestampToMillis(doc.get("processedAt"));
      return processedAtMs !== null && processedAtMs >= sinceMs;
    });

  const detailResults = await mapWithConcurrency(filteredDocs, PUBLIC_BATCH_MAP_CONCURRENCY, async (doc) => {
    const summary = serializeSummary(doc);
    const storagePath = asString(doc.get("storagePath"));
    if (!storagePath) {
      options?.logger?.error?.({ batchId: summary.batchId, deviceId: summary.deviceId }, "public map batch missing storage path");
      return null;
    }

    try {
      const points = await readBatchPoints(storagePath);
      return detailFromSummary({
        ...summary,
        count: asNumber(doc.get("count"), points.length),
      }, points);
    }
    catch (err) {
      options?.logger?.error?.({ err, batchId: summary.batchId, deviceId: summary.deviceId }, "failed to read public batch payload for map");
      return null;
    }
  });

  return {
    batches: detailResults.filter((detail): detail is PublicBatchDetail => Boolean(detail)),
  };
}

export async function readPublicBatchMapSnapshot(): Promise<PublicBatchMapSnapshot | null> {
  let bytes: Buffer;
  try {
    [bytes] = await bucket().file(PUBLIC_BATCH_MAP_OBJECT_PATH).download();
  }
  catch (err) {
    if (isStorageNotFoundError(err)) return null;
    throw err;
  }

  const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isPublicBatchMapResponse(parsed)) {
    throw new Error("invalid public batch map snapshot");
  }
  return {
    response: parsed,
    etag: snapshotEtagFromBytes(bytes),
  };
}

export async function writePublicBatchMapSnapshot(response: PublicBatchMapResponse): Promise<PublicBatchMapSnapshot> {
  const bytes = serializeSnapshot(response);
  const etag = snapshotEtagFromBytes(bytes);
  await bucket().file(PUBLIC_BATCH_MAP_OBJECT_PATH).save(bytes, {
    contentType: "application/json; charset=utf-8",
    resumable: false,
    metadata: {
      cacheControl: PUBLIC_BATCH_MAP_CACHE_CONTROL,
      metadata: {
        crowdpmSchemaVersion: "1",
        etag,
        generatedAt: new Date().toISOString(),
      },
    },
  });
  return { response, etag };
}

export async function refreshPublicBatchMapSnapshot(logger?: PublicMapLogger): Promise<PublicBatchMapSnapshot> {
  const response = await buildPublicBatchMapResponse({
    limit: PUBLIC_BATCH_MAP_MAX_LIMIT,
    sinceMs: null,
    logger,
  });
  const snapshot = await writePublicBatchMapSnapshot(response);
  logger?.info?.({ batchCount: response.batches.length }, "refreshed public batch map snapshot");
  return snapshot;
}
