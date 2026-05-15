import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { httpError } from "../lib/httpError.js";
import { parseDeviceId } from "../lib/httpValidation.js";
import { writeModerationAudit } from "../lib/moderationAudit.js";
import {
  getRequestUser,
  rateLimitGuard,
  requestParam,
  requestUserId,
  requirePermissionGuard,
} from "../lib/routeGuards.js";
import { rolesFromToken } from "../lib/rbac.js";
import { suspendDevice } from "../services/deviceRegistry.js";

const suspendDeviceBodySchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { id: string }; Body: unknown }>("/v1/admin/devices/:id/suspend", {
    preHandler: [
      requirePermissionGuard("devices.moderate"),
      rateLimitGuard((req) => `admin:devices:suspend:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard((req) => `admin:devices:suspend:target:${requestParam(req, "id")}`, 10, 60_000),
      rateLimitGuard("admin:devices:suspend:global", 300, 60_000),
    ],
  }, async (req, rep) => {
    const parsed = suspendDeviceBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }

    const id = parseDeviceId(req.params.id, "deviceId");
    const actor = getRequestUser(req);
    const reason = normalizeReason(parsed.data.reason);
    const result = await suspendDevice(id, actor.uid, reason ?? undefined);

    try {
      await writeModerationAudit({
        actorUid: actor.uid,
        actorRoles: rolesFromToken(actor),
        targetType: "device",
        targetId: `devices/${id}`,
        action: "device.suspended",
        reason,
        before: result.before,
        after: result.after,
      });
    }
    catch (err) {
      req.log.warn({ err, deviceId: id }, "failed to write moderation audit event");
    }

    rep.code(204);
    return undefined;
  });
};
