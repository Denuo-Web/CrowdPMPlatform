import type { IncomingHttpHeaders } from "node:http";
import type { BatchVisibility, PublicBatchDetail, PublicBatchMapResponse, PublicBatchSummary } from "@crowdpm/types";
import type { firestore } from "firebase-admin";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { bucket, db } from "../lib/fire.js";
import { extractClientIp } from "../lib/http.js";
import { httpError } from "../lib/httpError.js";
import { normalizeTimestamp, normalizeVisibility, parseDeviceId } from "../lib/httpValidation.js";
import { normalizeModerationState } from "../lib/moderation.js";
import { rateLimitGuard, requestParam } from "../lib/routeGuards.js";
import { timestampToMillis } from "../lib/time.js";
import { decodeBatchPayload } from "../services/batchPayloads.js";

const PUBLIC_BATCH_LIST_MAX_LIMIT = 500;
const PUBLIC_BATCH_MAP_MAX_LIMIT = 200;
const PUBLIC_BATCH_MAP_DEFAULT_LIMIT = 200;
const PUBLIC_BATCH_MAP_CONCURRENCY = 8;
const PUBLIC_BATCH_MAP_CACHE_MS = 30_000;
const APP_SETTINGS_COLLECTION = "appSettings";
const DEMO_BATCH_SETTINGS_DOC = "demoBatch";
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PUBLIC_BATCH_LIST_MAX_LIMIT).optional(),
});
const mapQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(PUBLIC_BATCH_MAP_MAX_LIMIT).optional(),
  since: z.string().trim().optional(),
});

type PublicBatchMapCacheEntry = {
  expiresAt: number;
  response: PublicBatchMapResponse;
};

const publicBatchMapCache = new Map<string, PublicBatchMapCacheEntry>();

function requestIp(req: { headers: IncomingHttpHeaders; ip: string }): string {
  return extractClientIp(req.headers) ?? req.ip ?? "unknown";
}

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

function parseSinceQuery(value: string | undefined): number | null {
  if (!value) return null;
  if (/^\d+$/u.test(value)) {
    const millis = Number(value);
    if (Number.isFinite(millis)) {
      return millis;
    }
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw httpError(400, "invalid_request", "since must be a valid ISO timestamp or epoch milliseconds.");
  }
  return parsed;
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

function ensurePublicApproved(data: firestore.DocumentData | undefined): { visibility: BatchVisibility; moderationState: "approved" } {
  const visibility = normalizeVisibility(data?.visibility);
  const moderationState = normalizeModerationState(data?.moderationState);
  if (visibility !== "public" || moderationState !== "approved") {
    throw httpError(404, "not_found", "Batch not found.");
  }
  return { visibility: "public", moderationState: "approved" };
}

async function loadPublicApprovedSummary(deviceId: string, batchId: string): Promise<PublicBatchSummary | null> {
  const batchSnap = await db().collection("batches").doc(batchId).get();
  if (!batchSnap.exists) return null;
  const batchData = batchSnap.data() ?? {};
  if (batchData.deviceId !== deviceId) return null;
  try {
    ensurePublicApproved(batchData);
  }
  catch {
    return null;
  }
  return serializeSummary(batchSnap);
}

export const publicBatchesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/public/demo-batch", {
    preHandler: [
      rateLimitGuard((req) => `public:demo-batch:ip:${requestIp(req)}`, 120, 60_000),
      rateLimitGuard("public:demo-batch:global", 2_000, 60_000),
    ],
  }, async (): Promise<PublicBatchSummary | null> => {
    const snap = await db().collection(APP_SETTINGS_COLLECTION).doc(DEMO_BATCH_SETTINGS_DOC).get();
    const deviceId = asString(snap.get("deviceId"));
    const batchId = asString(snap.get("batchId"));
    if (!deviceId || !batchId) return null;
    return loadPublicApprovedSummary(deviceId, batchId);
  });

  app.get("/v1/public/batches", {
    preHandler: [
      rateLimitGuard((req) => `public:batches:list:ip:${requestIp(req)}`, 120, 60_000),
      rateLimitGuard("public:batches:list:global", 2_000, 60_000),
    ],
  }, async (req): Promise<PublicBatchSummary[]> => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid query", { details: parsed.error.flatten() });
    }

    const limit = parsed.data.limit ?? 50;
    const docs = await listPublicApprovedBatchDocs(limit);
    return docs.map((doc) => serializeSummary(doc));
  });

  app.get("/v1/public/batches/map", {
    preHandler: [
      rateLimitGuard((req) => `public:batches:map:ip:${requestIp(req)}`, 60, 60_000),
      rateLimitGuard("public:batches:map:global", 500, 60_000),
    ],
  }, async (req, rep): Promise<PublicBatchMapResponse> => {
    const parsed = mapQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid query", { details: parsed.error.flatten() });
    }

    const limit = parsed.data.limit ?? PUBLIC_BATCH_MAP_DEFAULT_LIMIT;
    const sinceMs = parseSinceQuery(parsed.data.since);
    const normalizedSinceKey = sinceMs === null ? "all" : String(Math.floor(sinceMs / PUBLIC_BATCH_MAP_CACHE_MS));
    const cacheKey = `${limit}:${normalizedSinceKey}`;
    const now = Date.now();
    const cached = publicBatchMapCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      rep.header("Cache-Control", "public, max-age=30");
      return cached.response;
    }

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
        app.log.error({ batchId: summary.batchId, deviceId: summary.deviceId }, "public map batch missing storage path");
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
        app.log.error({ err, batchId: summary.batchId, deviceId: summary.deviceId }, "failed to read public batch payload for map");
        return null;
      }
    });

    const response = {
      batches: detailResults.filter((detail): detail is PublicBatchDetail => Boolean(detail)),
    } satisfies PublicBatchMapResponse;
    publicBatchMapCache.set(cacheKey, {
      expiresAt: now + PUBLIC_BATCH_MAP_CACHE_MS,
      response,
    });
    rep.header("Cache-Control", "public, max-age=30");
    return response;
  });

  app.get<{ Params: { deviceId: string; batchId: string } }>("/v1/public/batches/:deviceId/:batchId", {
    preHandler: [
      rateLimitGuard((req) => `public:batches:detail:ip:${requestIp(req)}`, 120, 60_000),
      rateLimitGuard((req) => `public:batches:detail:device:${requestParam(req, "deviceId")}`, 60, 60_000),
      rateLimitGuard("public:batches:detail:global", 2_000, 60_000),
    ],
  }, async (req): Promise<PublicBatchDetail> => {
    const deviceId = parseDeviceId(req.params.deviceId, "deviceId");
    const batchId = typeof req.params.batchId === "string" ? req.params.batchId.trim() : "";
    if (!batchId) {
      throw httpError(400, "invalid_batch_id", "batchId is required");
    }

    const batchRef = db().collection("batches").doc(batchId);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) {
      throw httpError(404, "not_found", "Batch not found.");
    }

    const batchData = batchSnap.data() ?? {};
    if (batchData.deviceId !== deviceId) {
      throw httpError(404, "not_found", "Batch not found.");
    }
    const { moderationState } = ensurePublicApproved(batchData);

    const storagePath = asString(batchData.storagePath);
    if (!storagePath) {
      throw httpError(404, "not_found", "Batch payload unavailable.");
    }

    let points: PublicBatchDetail["points"];
    try {
      points = await readBatchPoints(storagePath);
    }
    catch (err) {
      app.log.error({ err, batchId, deviceId }, "failed to read public batch payload");
      throw httpError(500, "storage_error", "Unable to read batch payload.");
    }

    return detailFromSummary({
      ...serializeSummary(batchSnap),
      count: asNumber(batchData.count, points.length),
      visibility: "public",
      moderationState,
    }, points);
  });
};
