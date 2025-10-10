import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/devices", async (req) => {
    await requireUser(req).catch(() => ({})); // allow unauth read in dev
    const snap = await db().collection("devices").get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  app.post<{ Body: { name?: string } }>("/v1/devices", async (req, rep) => {
    const user = await requireUser(req);
    const { name } = req.body ?? {};
    const ref = db().collection("devices").doc();
    await ref.set({ name, ownerUserId: user.uid, status: "ACTIVE", createdAt: new Date().toISOString() });
    return rep.code(201).send({ id: ref.id });
  });
};
