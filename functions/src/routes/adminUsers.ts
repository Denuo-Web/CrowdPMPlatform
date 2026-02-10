import type {
  AdminRole,
  AdminUserSummary,
  AdminUserUpdateRequest,
  AdminUsersListResponse,
} from "@crowdpm/types";
import type { auth as FirebaseAuth } from "firebase-admin";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { app, db } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";
import { normalizeTimestamp } from "../lib/httpValidation.js";
import { writeModerationAudit } from "../lib/moderationAudit.js";
import {
  getRequestUser,
  rateLimitGuard,
  requestParam,
  requestUserId,
  requirePermissionGuard,
} from "../lib/routeGuards.js";
import { hasRole, rolesFromClaims, rolesFromToken } from "../lib/rbac.js";
import { revokeTokensForDevice } from "../services/deviceTokens.js";

const listUsersQuerySchema = z.object({
  pageToken: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(1_000).optional(),
});

const roleSchema = z.enum(["super_admin", "moderator"] as const);

const updateUserBodySchema = z.object({
  roles: z.array(roleSchema).max(2).optional(),
  disabled: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
}).refine((value) => value.roles !== undefined || value.disabled !== undefined, {
  message: "Provide roles or disabled to update.",
});

function uniqueRoles(rawRoles: AdminRole[] | undefined): AdminRole[] {
  return Array.from(new Set((rawRoles ?? []).filter((role) => role === "super_admin" || role === "moderator")));
}

function normalizeReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function toSummary(record: FirebaseAuth.UserRecord): AdminUserSummary {
  const roles = uniqueRoles(rolesFromClaims(record.customClaims as Record<string, unknown> | undefined));
  return {
    uid: record.uid,
    email: record.email ?? null,
    disabled: record.disabled,
    roles,
    createdAt: normalizeTimestamp(record.metadata.creationTime, { required: false }),
    lastSignInAt: normalizeTimestamp(record.metadata.lastSignInTime, { required: false }),
  };
}

async function revokeOwnedDeviceTokens(uid: string): Promise<string[]> {
  if (!uid) return [];
  const devices = db().collection("devices");
  const [multiOwnerSnap, legacySnap] = await Promise.all([
    devices.where("ownerUserIds", "array-contains", uid).get(),
    devices.where("ownerUserId", "==", uid).get(),
  ]);

  const ids = new Set<string>();
  [multiOwnerSnap, legacySnap].forEach((snap) => {
    snap.docs.forEach((doc) => ids.add(doc.id));
  });

  await Promise.all(Array.from(ids).map((deviceId) => revokeTokensForDevice(deviceId)));
  return Array.from(ids);
}

export const adminUsersRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/v1/admin/users", {
    preHandler: [
      requirePermissionGuard("users.manage"),
      rateLimitGuard((req) => `admin:users:list:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard("admin:users:list:global", 500, 60_000),
    ],
  }, async (req): Promise<AdminUsersListResponse> => {
    const parsed = listUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid query", { details: parsed.error.flatten() });
    }

    const limit = parsed.data.limit ?? 100;
    const pageToken = parsed.data.pageToken;
    const usersResult = await app().auth().listUsers(limit, pageToken);

    return {
      users: usersResult.users.map((userRecord) => toSummary(userRecord)),
      nextPageToken: usersResult.pageToken ?? null,
    };
  });

  fastify.patch<{ Params: { uid: string }; Body: AdminUserUpdateRequest }>("/v1/admin/users/:uid", {
    preHandler: [
      requirePermissionGuard("users.manage"),
      rateLimitGuard((req) => `admin:users:patch:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard((req) => `admin:users:patch:target:${requestParam(req, "uid")}`, 10, 60_000),
      rateLimitGuard("admin:users:patch:global", 300, 60_000),
    ],
  }, async (req): Promise<AdminUserSummary> => {
    const parsed = updateUserBodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }

    const uid = typeof req.params.uid === "string" ? req.params.uid.trim() : "";
    if (!uid) {
      throw httpError(400, "invalid_uid", "uid is required");
    }

    const actor = getRequestUser(req);
    const actorRoles = rolesFromToken(actor);
    const requestedRoles = parsed.data.roles ? uniqueRoles(parsed.data.roles) : undefined;
    if (requestedRoles !== undefined && !hasRole(actor, "super_admin")) {
      throw httpError(403, "forbidden", "Only super admins can modify roles.");
    }

    const authApi = app().auth();
    const targetBefore = await authApi.getUser(uid);
    const beforeRoles = uniqueRoles(rolesFromClaims(targetBefore.customClaims as Record<string, unknown> | undefined));
    const beforeDisabled = targetBefore.disabled;

    if (requestedRoles !== undefined) {
      const nextClaims = { ...(targetBefore.customClaims ?? {}) } as Record<string, unknown>;
      delete nextClaims.roles;
      delete nextClaims.admin;
      if (requestedRoles.length) {
        nextClaims.roles = requestedRoles;
      }
      if (requestedRoles.includes("super_admin")) {
        nextClaims.admin = true;
      }
      await authApi.setCustomUserClaims(uid, Object.keys(nextClaims).length ? nextClaims : null);
    }

    if (parsed.data.disabled !== undefined) {
      await authApi.updateUser(uid, { disabled: parsed.data.disabled });
      if (parsed.data.disabled) {
        await authApi.revokeRefreshTokens(uid);
        await revokeOwnedDeviceTokens(uid);
      }
    }

    const targetAfter = await authApi.getUser(uid);
    const afterRoles = uniqueRoles(rolesFromClaims(targetAfter.customClaims as Record<string, unknown> | undefined));
    const afterDisabled = targetAfter.disabled;
    const reason = normalizeReason(parsed.data.reason);

    try {
      await writeModerationAudit({
        actorUid: actor.uid,
        actorRoles,
        targetType: "user",
        targetId: uid,
        action: "user.updated",
        reason,
        before: {
          disabled: beforeDisabled,
          roles: beforeRoles,
        },
        after: {
          disabled: afterDisabled,
          roles: afterRoles,
        },
      });
    }
    catch (err) {
      req.log.warn({ err, uid }, "failed to write moderation audit event");
    }

    return toSummary(targetAfter);
  });
};
