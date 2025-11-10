import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/firebaseVerify.js";
import { authorizeSession, findSessionByUserCode, sessionForClient } from "../services/devicePairing.js";

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

export const activationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/device-activation", async (req, rep) => {
    const user = await requireUser(req);
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return rep.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    try {
      const session = await findSessionByUserCode(normalizeCode(parsed.data.user_code));
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

  app.post("/v1/device-activation/authorize", async (req, rep) => {
    const user = await requireUser(req, { requireSecondFactorIfEnrolled: true });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return rep.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    try {
      const session = await authorizeSession(normalizeCode(parsed.data.user_code), user.uid);
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
