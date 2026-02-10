import type { BatchVisibility, PublicBatchDetail, PublicBatchSummary } from "@crowdpm/types";
import type { firestore } from "firebase-admin";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { bucket, db } from "../lib/fire.js";
import { extractClientIp } from "../lib/http.js";
import { httpError } from "../lib/httpError.js";
import { normalizeTimestamp, normalizeVisibility, parseDeviceId } from "../lib/httpValidation.js";
import { normalizeModerationState } from "../lib/moderation.js";
import { rateLimitGuard, requestParam } from "../lib/routeGuards.js";
import { IngestBatch as IngestBatchSchema } from "../lib/validation.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function requestIp(req: { headers: IncomingHttpHeaders; ip: string }): string {
  return extractClientIp(req.headers) ?? req.ip ?? "unknown";
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function pickDeviceId(doc: firestore.QueryDocumentSnapshot): string {
  const data = doc.data();
  if (typeof data.deviceId === "string" && data.deviceId.trim().length > 0) {
    return data.deviceId;
  }
  return doc.ref.parent.parent?.id ?? "";
}

async function loadDeviceNameMap(deviceIds: string[]): Promise<Map<string, string>> {
  const uniqueIds = Array.from(new Set(deviceIds.filter((id) => id.length > 0)));
  if (!uniqueIds.length) return new Map();
  const snaps = await Promise.all(uniqueIds.map((id) => db().collection("devices").doc(id).get()));
  const out = new Map<string, string>();
  snaps.forEach((snap) => {
    if (!snap.exists) return;
    const name = snap.get("name");
    if (typeof name === "string" && name.trim().length > 0) {
      out.set(snap.id, name);
    }
  });
  return out;
}

function serializeSummary(doc: firestore.QueryDocumentSnapshot, deviceNameById: Map<string, string>): PublicBatchSummary {
  const data = doc.data();
  const deviceId = pickDeviceId(doc);
  return {
    batchId: doc.id,
    deviceId,
    deviceName: deviceNameById.get(deviceId) ?? null,
    count: asNumber(data.count),
    processedAt: normalizeTimestamp(data.processedAt),
    visibility: "public",
    moderationState: normalizeModerationState(data.moderationState),
  };
}

function ensurePublicApproved(data: firestore.DocumentData | undefined): { visibility: BatchVisibility; moderationState: "approved" } {
  const visibility = normalizeVisibility(data?.visibility);
  const moderationState = normalizeModerationState(data?.moderationState);
  if (visibility !== "public" || moderationState !== "approved") {
    throw httpError(404, "not_found", "Batch not found.");
  }
  return { visibility: "public", moderationState: "approved" };
}

export const publicBatchesRoutes: FastifyPluginAsync = async (app) => {
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
    const snap = await db().collectionGroup("batches")
      .where("visibility", "==", "public")
      .where("moderationState", "==", "approved")
      .orderBy("processedAt", "desc")
      .limit(limit)
      .get();

    const deviceNameMap = await loadDeviceNameMap(snap.docs.map((doc) => pickDeviceId(doc)));
    return snap.docs.map((doc) => serializeSummary(doc, deviceNameMap));
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

    const batchRef = db().collection("devices").doc(deviceId).collection("batches").doc(batchId);
    const [batchSnap, deviceSnap] = await Promise.all([
      batchRef.get(),
      db().collection("devices").doc(deviceId).get(),
    ]);
    if (!batchSnap.exists) {
      throw httpError(404, "not_found", "Batch not found.");
    }

    const batchData = batchSnap.data() ?? {};
    const { moderationState } = ensurePublicApproved(batchData);

    const path = asString(batchData.path);
    if (!path) {
      throw httpError(404, "not_found", "Batch payload unavailable.");
    }

    let points: PublicBatchDetail["points"];
    try {
      const [buf] = await bucket().file(path).download();
      const parsed = IngestBatchSchema.safeParse(JSON.parse(buf.toString("utf8")));
      if (!parsed.success) {
        app.log.error({ batchId, deviceId, issues: parsed.error.flatten() }, "invalid batch payload");
        throw httpError(500, "invalid_batch", "Stored batch payload is invalid.");
      }
      points = parsed.data.points;
    }
    catch (err) {
      app.log.error({ err, batchId, deviceId }, "failed to read public batch payload");
      throw httpError(500, "storage_error", "Unable to read batch payload.");
    }

    return {
      batchId,
      deviceId,
      deviceName: typeof deviceSnap.get("name") === "string" ? deviceSnap.get("name") : null,
      count: asNumber(batchData.count, points.length),
      processedAt: normalizeTimestamp(batchData.processedAt),
      visibility: "public",
      moderationState,
      points,
    };
  });
};
import type { IncomingHttpHeaders } from "node:http";
