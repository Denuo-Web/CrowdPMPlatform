import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/firebaseVerify.js";
import { authorizeSession, findSessionByUserCode, sessionForClient } from "../services/devicePairing.js";
import { RateLimitError, rateLimitOrThrow } from "../lib/rateLimiter.js";
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

function enforceRateLimit(rep: FastifyReply, key: string, limit: number, windowMs: number): boolean {
  try {
    rateLimitOrThrow(key, limit, windowMs);
    return false;
  }
  catch (err) {
    if (err instanceof RateLimitError) {
      const retryAfter = Math.max(1, err.retryAfterSeconds);
      rep.header("retry-after", String(retryAfter)).code(429).send({
        error: "rate_limited",
        retry_after: retryAfter,
      });
      return true;
    }
    throw err;
  }
}

export const activationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/device-activation", async (req, rep) => {
    if (enforceRateLimit(rep, `activation:get:ip:${requestIp(req)}`, 60, 60_000)) return;
    const user = await requireUser(req);
    if (enforceRateLimit(rep, `activation:get:${user.uid}`, 30, 60_000)) return;
    if (enforceRateLimit(rep, "activation:get:global", 1_000, 60_000)) return;
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return rep.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const normalizedCode = normalizeCode(parsed.data.user_code);
    if (enforceRateLimit(rep, `activation:code:${normalizedCode}`, 100, 60_000)) return;
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
    if (enforceRateLimit(rep, `activation:authorize:ip:${requestIp(req)}`, 60, 60_000)) return;
    if (enforceRateLimit(rep, "activation:authorize:global", 500, 60_000)) return;
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return rep.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    const normalizedCode = normalizeCode(parsed.data.user_code);
    if (enforceRateLimit(rep, `activation:code:${normalizedCode}`, 40, 60_000)) return;

    const user = await requireUser(req, { requireSecondFactorIfEnrolled: true });
    if (enforceRateLimit(rep, `activation:authorize:${user.uid}`, 20, 60_000)) return;
    // Prevent the same account from hammering a single code repeatedly.
    if (enforceRateLimit(rep, `activation:authorize:${user.uid}:code:${normalizedCode}`, 5, 300_000)) return;
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
