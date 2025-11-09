import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/devices", async (req) => {
    const user = await requireUser(req);
    const devices = db().collection("devices");
    const [multiOwnerSnap, legacySnap] = await Promise.all([
      devices.where("ownerUserIds", "array-contains", user.uid).get(),
      devices.where("ownerUserId", "==", user.uid).get(),
    ]);

    const seen = new Map<string, Record<string, unknown>>();
    [multiOwnerSnap, legacySnap].forEach((snap) => {
      snap.forEach((doc) => {
        if (!seen.has(doc.id)) {
          seen.set(doc.id, doc.data());
        }
      });
    });

    return Array.from(seen.entries()).map(([id, data]) => ({ id, ...data }));
  });

  app.post<{ Body: { name?: string } }>("/v1/devices", async (req, rep) => {
    const user = await requireUser(req);
    const { name } = req.body ?? {};
    const ref = db().collection("devices").doc();
    await ref.set({
      name,
      ownerUserId: user.uid,
      ownerUserIds: [user.uid],
      status: "ACTIVE",
      createdAt: new Date().toISOString(),
    });
    return rep.code(201).send({ id: ref.id });
  });
};
