import type { AdminSubmissionListResponse, AdminSubmissionSummary } from "@crowdpm/types";
import type { firestore } from "firebase-admin";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { db } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";
import { normalizeTimestamp, normalizeVisibility, parseDeviceId } from "../lib/httpValidation.js";
import { normalizeModerationState } from "../lib/moderation.js";
import { writeModerationAudit } from "../lib/moderationAudit.js";
import {
  getRequestUser,
  rateLimitGuard,
  requestParam,
  requestUserId,
  requirePermissionGuard,
} from "../lib/routeGuards.js";
import { rolesFromToken } from "../lib/rbac.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  moderationState: z.enum(["approved", "quarantined"] as const).optional(),
  visibility: z.enum(["public", "private"] as const).optional(),
});

const updateBodySchema = z.object({
  moderationState: z.enum(["approved", "quarantined"] as const),
  reason: z.string().max(500).optional().nullable(),
});

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function serializeSubmission(doc: firestore.QueryDocumentSnapshot | firestore.DocumentSnapshot): AdminSubmissionSummary {
  const data = doc.data();
  const deviceId = typeof data?.deviceId === "string" ? data.deviceId : "";
  return {
    batchId: doc.id,
    deviceId,
    deviceName: typeof data?.deviceNameSnapshot === "string" && data.deviceNameSnapshot.trim().length > 0
      ? data.deviceNameSnapshot
      : null,
    count: asNumber(data?.count),
    processedAt: normalizeTimestamp(data?.processedAt),
    visibility: normalizeVisibility(data?.visibility),
    moderationState: normalizeModerationState(data?.moderationState),
    moderationReason: normalizeReason(data?.moderationReason),
    moderatedBy: asNullableString(data?.moderatedBy),
    moderatedAt: normalizeTimestamp(data?.moderatedAt),
  };
}

export const adminSubmissionsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/admin/submissions", {
    preHandler: [
      requirePermissionGuard("submissions.read_all"),
      rateLimitGuard((req) => `admin:submissions:list:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard("admin:submissions:list:global", 2_000, 60_000),
    ],
  }, async (req): Promise<AdminSubmissionListResponse> => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid query", { details: parsed.error.flatten() });
    }

    const limit = parsed.data.limit ?? 50;
    let query: firestore.Query = db().collection("batches");
    if (parsed.data.visibility) {
      query = query.where("visibility", "==", parsed.data.visibility);
    }
    if (parsed.data.moderationState) {
      query = query.where("moderationState", "==", parsed.data.moderationState);
    }
    query = query.orderBy("processedAt", "desc").limit(limit);

    const snap = await query.get();
    return {
      submissions: snap.docs.map((doc) => serializeSubmission(doc)),
    };
  });

  app.patch<{ Params: { deviceId: string; batchId: string } }>("/v1/admin/submissions/:deviceId/:batchId", {
    preHandler: [
      requirePermissionGuard("submissions.moderate"),
      rateLimitGuard((req) => `admin:submissions:patch:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard((req) => `admin:submissions:patch:batch:${requestParam(req, "batchId")}`, 15, 60_000),
      rateLimitGuard("admin:submissions:patch:global", 500, 60_000),
    ],
  }, async (req): Promise<AdminSubmissionSummary> => {
    const parsedBody = updateBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsedBody.error.flatten() });
    }

    const deviceId = parseDeviceId(req.params.deviceId, "deviceId");
    const batchId = typeof req.params.batchId === "string" ? req.params.batchId.trim() : "";
    if (!batchId) {
      throw httpError(400, "invalid_batch_id", "batchId is required");
    }

    const user = getRequestUser(req);
    const ref = db().collection("batches").doc(batchId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw httpError(404, "not_found", "Batch not found.");
    }
    if (snap.get("deviceId") !== deviceId) {
      throw httpError(404, "not_found", "Batch not found.");
    }

    const beforeData = snap.data() ?? {};
    const reason = normalizeReason(parsedBody.data.reason);
    const updates = {
      deviceId,
      moderationState: parsedBody.data.moderationState,
      moderationReason: reason,
      moderatedBy: user.uid,
      moderatedAt: new Date(),
    };

    await ref.set(updates, { merge: true });

    try {
      await writeModerationAudit({
        actorUid: user.uid,
        actorRoles: rolesFromToken(user),
        targetType: "submission",
        targetId: `batches/${batchId}`,
        action: `submission.${parsedBody.data.moderationState}`,
        reason,
        before: {
          moderationState: normalizeModerationState(beforeData.moderationState),
          moderationReason: normalizeReason(beforeData.moderationReason),
          moderatedBy: asNullableString(beforeData.moderatedBy),
          moderatedAt: normalizeTimestamp(beforeData.moderatedAt),
        },
        after: {
          moderationState: parsedBody.data.moderationState,
          moderationReason: reason,
          moderatedBy: user.uid,
          moderatedAt: updates.moderatedAt.toISOString(),
        },
      });
    }
    catch (err) {
      req.log.warn({ err, deviceId, batchId }, "failed to write moderation audit event");
    }

    const patched = await ref.get();
    return serializeSubmission(patched);
  });
};
