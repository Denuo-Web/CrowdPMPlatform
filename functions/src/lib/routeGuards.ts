import type { DecodedIdToken } from "firebase-admin/auth";
import type { firestore } from "firebase-admin";
import type { FastifyRequest, preHandlerHookHandler } from "fastify";
import { requireUser, type RequireUserOptions } from "../auth/firebaseVerify.js";
import { userOwnsDevice } from "./deviceOwnership.js";
import { db } from "./fire.js";
import { httpError } from "./httpError.js";
import { parseDeviceId } from "./httpValidation.js";
import { RateLimitError, rateLimitOrThrow } from "./rateLimiter.js";
import { hasPermission, type Permission } from "./rbac.js";

type GuardedRequest = FastifyRequest & {
  user?: DecodedIdToken;
  deviceDoc?: firestore.DocumentSnapshot<firestore.DocumentData>;
};

type RateLimitPluginResult = {
  isAllowed: boolean;
  ttlInSeconds?: number;
};

type CreateRateLimit = (options: {
  max: number;
  timeWindow: number;
  keyGenerator: (req: FastifyRequest) => string;
}) => (req: FastifyRequest) => Promise<RateLimitPluginResult>;

export function requireUserGuard(options?: RequireUserOptions): preHandlerHookHandler {
  return async (req) => {
    const user = await requireUser(req, options);
    (req as GuardedRequest).user = user;
  };
}

export function requirePermissionGuard(permission: Permission): preHandlerHookHandler {
  return async (req) => {
    const user = await requireUser(req);
    (req as GuardedRequest).user = user;
    if (!hasPermission(user, permission)) {
      throw httpError(403, "forbidden", "You do not have permission to access this resource.");
    }
  };
}

export function getRequestUser(req: FastifyRequest): DecodedIdToken {
  const user = (req as GuardedRequest).user;
  if (!user) {
    throw httpError(401, "unauthorized", "Authentication required");
  }
  return user;
}

export function requestUserId(req: FastifyRequest): string {
  return getRequestUser(req).uid;
}

export function requestParam(req: FastifyRequest, key: string): string {
  const params = req.params as Record<string, unknown> | undefined;
  const value = params?.[key];
  return typeof value === "string" ? value : "";
}

export function rateLimitGuard(
  key: string | ((req: FastifyRequest) => string),
  limit: number,
  windowMs: number
): preHandlerHookHandler {
  let pluginLimiter: ((req: FastifyRequest) => Promise<RateLimitPluginResult>) | null = null;

  return async (req) => {
    const createRateLimit = (req.server as { createRateLimit?: CreateRateLimit }).createRateLimit;
    if (typeof createRateLimit === "function") {
      pluginLimiter ??= createRateLimit({
        max: limit,
        timeWindow: windowMs,
        keyGenerator: (currentReq) => typeof key === "function" ? key(currentReq) : key,
      });
      const result = await pluginLimiter(req);
      if (!result.isAllowed) {
        const retryAfter = Math.max(
          1,
          Number.isFinite(result.ttlInSeconds) ? Number(result.ttlInSeconds) : Math.ceil(windowMs / 1000)
        );
        throw new RateLimitError(retryAfter);
      }
      return;
    }

    const resolvedKey = typeof key === "function" ? key(req) : key;
    rateLimitOrThrow(resolvedKey, limit, windowMs);
  };
}

export function requireDeviceOwnerGuard(
  deviceIdSelector: string | ((req: FastifyRequest) => string)
): preHandlerHookHandler {
  return async (req) => {
    const deviceId = typeof deviceIdSelector === "function"
      ? deviceIdSelector(req)
      : (req.params as Record<string, unknown>)[deviceIdSelector];
    const trimmedId = parseDeviceId(deviceId);
    const doc = await db().collection("devices").doc(trimmedId).get();
    if (!doc.exists) {
      throw httpError(404, "not_found", "Device not found");
    }
    const userId = requestUserId(req);
    if (!userOwnsDevice(doc.data(), userId)) {
      throw httpError(403, "forbidden", "You do not have access to this device.");
    }
    (req as GuardedRequest).deviceDoc = doc;
  };
}
