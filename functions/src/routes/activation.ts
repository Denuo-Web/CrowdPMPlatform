import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { authorizeSession, findSessionByUserCode, sessionForClient } from "../services/devicePairing.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";
import { extractClientIp } from "../lib/http.js";
import { httpError } from "../lib/httpError.js";
import { getRequestUser, rateLimitGuard, requireUserGuard, requestUserId } from "../lib/routeGuards.js";

const querySchema = z.object({
  user_code: z.string().min(8),
});

const bodySchema = z.object({
  user_code: z.string().min(8),
});

function normalizeCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function requestIp(req: FastifyRequest): string {
  return extractClientIp(req.headers) ?? req.ip ?? "unknown";
}

export const activationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/device-activation", {
    preHandler: [
      rateLimitGuard((req) => `activation:get:ip:${requestIp(req)}`, 60, 60_000),
      requireUserGuard(),
      rateLimitGuard((req) => `activation:get:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard("activation:get:global", 1_000, 60_000),
    ],
  }, async (req, rep) => {
    const user = getRequestUser(req);
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    const normalizedCode = normalizeCode(parsed.data.user_code);
    rateLimitOrThrow(`activation:code:${normalizedCode}`, 100, 60_000);
    const session = await findSessionByUserCode(normalizedCode);
    return rep.code(200).send({
      ...sessionForClient(session),
      authorized_account: session.accId,
      viewer_account: user.uid,
    });
  });

  app.post("/v1/device-activation/authorize", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
      },
    },
    preHandler: [
      rateLimitGuard((req) => `activation:authorize:ip:${requestIp(req)}`, 60, 60_000),
      rateLimitGuard("activation:authorize:global", 500, 60_000),
      requireUserGuard({ requireSecondFactorIfEnrolled: true }),
      rateLimitGuard((req) => `activation:authorize:${requestUserId(req)}`, 20, 60_000),
    ],
  }, async (req, rep) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    const normalizedCode = normalizeCode(parsed.data.user_code);
    rateLimitOrThrow(`activation:code:${normalizedCode}`, 40, 60_000);

    const user = getRequestUser(req);
    // Prevent the same account from hammering a single code repeatedly.
    rateLimitOrThrow(`activation:authorize:${user.uid}:code:${normalizedCode}`, 5, 300_000);
    const session = await authorizeSession(normalizedCode, user.uid);
    return rep.code(200).send({
      ...sessionForClient(session),
      authorized_account: session.accId,
    });
  });
};
