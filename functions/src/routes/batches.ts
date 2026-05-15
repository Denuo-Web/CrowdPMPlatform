import type { BatchDetail, BatchSummary } from "@crowdpm/types";
import type { firestore } from "firebase-admin";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { normalizeOwnerIds } from "../lib/deviceOwnership.js";
import { bucket, db } from "../lib/fire.js";
import { normalizeModerationState } from "../lib/moderation.js";
import { timestampToMillis } from "../lib/time.js";
import { httpError } from "../lib/httpError.js";
import { normalizeTimestamp, normalizeVisibility, parseDeviceId } from "../lib/httpValidation.js";
import { hasPermission } from "../lib/rbac.js";
import {
  getRequestUser,
  rateLimitGuard,
  requestParam,
  requireUserGuard,
  requestUserId,
} from "../lib/routeGuards.js";
import { decodeBatchPayload } from "../services/batchPayloads.js";
import {
  applyBatchVisibilityChange,
  applyStoredBatchDeletion,
} from "../services/accountEntitlements.js";

const OWNED_BATCH_LIST_LIMIT = 50;
const OWNED_BATCH_LIST_MAX_LIMIT = 500;
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(OWNED_BATCH_LIST_MAX_LIMIT).optional(),
});

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function batchOwnerIds(data: firestore.DocumentData | undefined): string[] {
  return normalizeOwnerIds(data);
}

function requireBatchOwnerIds(data: firestore.DocumentData | undefined): string[] {
  const ownerUserIds = batchOwnerIds(data);
  if (!ownerUserIds.length) {
    throw httpError(500, "invalid_batch_owner", "Batch owner metadata is missing.");
  }
  return ownerUserIds;
}

function userOwnsBatch(data: firestore.DocumentData | undefined, userId: string): boolean {
  return Boolean(userId && batchOwnerIds(data).includes(userId));
}

function serializeSummary(id: string, data: firestore.DocumentData | undefined): BatchSummary {
  return {
    batchId: id,
    deviceId: asString(data?.deviceId),
    deviceName: typeof data?.deviceNameSnapshot === "string" && data.deviceNameSnapshot.trim().length > 0
      ? data.deviceNameSnapshot
      : null,
    count: asNumber(data?.count),
    processedAt: normalizeTimestamp(data?.processedAt),
    visibility: normalizeVisibility(data?.visibility),
    moderationState: normalizeModerationState(data?.moderationState),
  };
}

async function loadBatch(deviceId: string, batchId: string): Promise<{
  ref: firestore.DocumentReference;
  snap: firestore.DocumentSnapshot;
  data: firestore.DocumentData;
}> {
  const ref = db().collection("batches").doc(batchId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw httpError(404, "not_found", "Batch not found.");
  }
  const data = snap.data() ?? {};
  if (data.deviceId !== deviceId) {
    throw httpError(404, "not_found", "Batch not found.");
  }
  return { ref, snap, data };
}

export const batchesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/batches", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `batches:list:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard("batches:list:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      throw httpError(400, "invalid_request", "invalid query", { details: parsedQuery.error.flatten() });
    }

    const user = getRequestUser(req);
    const canViewQuarantined = hasPermission(user, "submissions.read_all");
    const limit = parsedQuery.data.limit ?? OWNED_BATCH_LIST_LIMIT;
    const snap = await db().collection("batches")
      .where("ownerUserIds", "array-contains", user.uid)
      .orderBy("processedAt", "desc")
      .limit(limit)
      .get();

    return snap.docs
      .map((doc) => {
        const data = doc.data();
        const moderationState = normalizeModerationState(data.moderationState);
        if (!canViewQuarantined && moderationState === "quarantined") {
          return null;
        }
        return serializeSummary(doc.id, data);
      })
      .filter((summary): summary is BatchSummary => Boolean(summary))
      .sort((a, b) => {
        const timeA = timestampToMillis(a.processedAt) ?? 0;
        const timeB = timestampToMillis(b.processedAt) ?? 0;
        return timeB - timeA;
      });
  });

  app.get<{ Params: { deviceId: string; batchId: string } }>("/v1/batches/:deviceId/:batchId", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `batches:detail:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard((req) => `batches:detail:device:${requestParam(req, "deviceId")}`, 120, 60_000),
      rateLimitGuard("batches:detail:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const deviceId = parseDeviceId(req.params.deviceId, "deviceId");
    const batchId = typeof req.params.batchId === "string" ? req.params.batchId.trim() : "";
    if (!batchId) {
      throw httpError(400, "invalid_batch_id", "batchId is required");
    }

    const user = getRequestUser(req);
    const canViewQuarantined = hasPermission(user, "submissions.read_all");
    const { data } = await loadBatch(deviceId, batchId);
    if (!userOwnsBatch(data, user.uid)) {
      throw httpError(403, "forbidden", "You do not have access to this batch.");
    }
    const moderationState = normalizeModerationState(data.moderationState);
    if (!canViewQuarantined && moderationState === "quarantined") {
      throw httpError(404, "not_found", "Batch not found.");
    }
    const storagePath = asString(data.storagePath);
    if (!storagePath) {
      throw httpError(404, "not_found", "Batch payload unavailable.");
    }

    let points: BatchDetail["points"];
    try {
      const [buf] = await bucket().file(storagePath).download();
      points = decodeBatchPayload(buf, storagePath).points;
    }
    catch (err) {
      app.log.error({ err, batchId, deviceId }, "failed to read batch payload");
      throw httpError(500, "storage_error", "Unable to read batch payload.");
    }

    const response: BatchDetail = {
      ...serializeSummary(batchId, data),
      count: asNumber(data.count, points.length),
      moderationState,
      points,
    };
    return response;
  });

  app.patch<{ Params: { deviceId: string; batchId: string }; Body: { visibility?: unknown } }>("/v1/batches/:deviceId/:batchId", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `batches:update:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard((req) => `batches:update:device:${requestParam(req, "deviceId")}`, 60, 60_000),
      rateLimitGuard("batches:update:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const deviceId = parseDeviceId(req.params.deviceId, "deviceId");
    const batchId = typeof req.params.batchId === "string" ? req.params.batchId.trim() : "";
    if (!batchId) {
      throw httpError(400, "invalid_batch_id", "batchId is required");
    }

    const visibility = normalizeVisibility(req.body?.visibility, null);
    if (!visibility) {
      throw httpError(400, "invalid_visibility", "visibility must be 'public' or 'private'.");
    }

    const user = getRequestUser(req);
    const { ref, data } = await loadBatch(deviceId, batchId);
    if (!userOwnsBatch(data, user.uid)) {
      throw httpError(403, "forbidden", "You do not have access to this batch.");
    }
    const previousVisibility = normalizeVisibility(data.visibility);
    const ownerUserIds = requireBatchOwnerIds(data);

    await Promise.all(ownerUserIds.map((ownerUserId) => applyBatchVisibilityChange({
      userId: ownerUserId,
      fromVisibility: previousVisibility,
      toVisibility: visibility,
      targetDb: db(),
    })));
    await ref.set({
      visibility,
      updatedAt: new Date(),
    }, { merge: true });

    return {
      ...serializeSummary(batchId, data),
      visibility,
    };
  });

  app.delete<{ Params: { deviceId: string; batchId: string } }>("/v1/batches/:deviceId/:batchId", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `batches:delete:${requestUserId(req)}`, 20, 60_000),
      rateLimitGuard((req) => `batches:delete:device:${requestParam(req, "deviceId")}`, 40, 60_000),
      rateLimitGuard("batches:delete:global", 500, 60_000),
    ],
  }, async (req) => {
    const deviceId = parseDeviceId(req.params.deviceId, "deviceId");
    const batchId = typeof req.params.batchId === "string" ? req.params.batchId.trim() : "";
    if (!batchId) {
      throw httpError(400, "invalid_batch_id", "batchId is required");
    }

    const user = getRequestUser(req);
    const { ref, data } = await loadBatch(deviceId, batchId);
    if (!userOwnsBatch(data, user.uid)) {
      throw httpError(403, "forbidden", "You do not have access to this batch.");
    }
    const currentVisibility = normalizeVisibility(data.visibility);

    const storagePath = asString(data.storagePath);
    if (storagePath) {
      try {
        await bucket().file(storagePath).delete({ ignoreNotFound: true });
      }
      catch (err) {
        app.log.error({ err, batchId, deviceId, storagePath }, "failed to delete batch payload");
        throw httpError(500, "storage_error", "Unable to delete batch payload.");
      }
    }

    await ref.delete();
    const ownerUserIds = requireBatchOwnerIds(data);
    await Promise.all(ownerUserIds.map((ownerUserId) => applyStoredBatchDeletion({
      userId: ownerUserId,
      visibility: currentVisibility,
      targetDb: db(),
    })));
    return { status: "deleted", deviceId, batchId };
  });
};
