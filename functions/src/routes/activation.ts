import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/firebaseVerify.js";
import { authorizeSession, findSessionByUserCode, sessionForClient } from "../services/devicePairing.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";
import { extractClientIp } from "../lib/http.js";

const querySchema = z.object({
  user_code: z.string().min(8),
});

const bodySchema = z.object({
  user_code: z.string().min(8),
});

function respondWithError(rep: FastifyReply, err: unknown, fallback = 500) {
  const status = typeof err === "object" && err && "statusCode" in err && typeof (err as { statusCode?: unknown }).statusCode === "number"
    ? Number((err as { statusCode: unknown }).statusCode)
    : fallback;
  const message = err instanceof Error ? err.message : "unexpected error";
  return rep.code(status).send({ error: message });
}

function normalizeCode(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function requestIp(req: FastifyRequest): string {
  return extractClientIp(req.headers) ?? req.ip ?? "unknown";
}

export const activationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/device-activation", async (req, rep) => {
    rateLimitOrThrow(`activation:get:ip:${requestIp(req)}`, 60, 60_000);
    const user = await requireUser(req);
    rateLimitOrThrow(`activation:get:${user.uid}`, 30, 60_000);
    rateLimitOrThrow("activation:get:global", 1_000, 60_000);
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return rep.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const normalizedCode = normalizeCode(parsed.data.user_code);
    rateLimitOrThrow(`activation:code:${normalizedCode}`, 100, 60_000);
    try {
      const session = await findSessionByUserCode(normalizedCode);
      return rep.code(200).send({
        ...sessionForClient(session),
        authorized_account: session.accId,
        viewer_account: user.uid,
      });
    }
    catch (err) {
      return respondWithError(rep, err, 404);
    }
  });

  app.post("/v1/device-activation/authorize", {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
      },
    },
  }, async (req, rep) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return rep.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    rateLimitOrThrow(`activation:authorize:ip:${requestIp(req)}`, 60, 60_000);
    rateLimitOrThrow("activation:authorize:global", 500, 60_000);
    const normalizedCode = normalizeCode(parsed.data.user_code);
    rateLimitOrThrow(`activation:code:${normalizedCode}`, 40, 60_000);

    const user = await requireUser(req, { requireSecondFactorIfEnrolled: true });
    rateLimitOrThrow(`activation:authorize:${user.uid}`, 20, 60_000);
    try {
      const session = await authorizeSession(normalizedCode, user.uid);
      return rep.code(200).send({
        ...sessionForClient(session),
        authorized_account: session.accId,
      });
    }
    catch (err) {
      return respondWithError(rep, err, 400);
    }
  });
};
