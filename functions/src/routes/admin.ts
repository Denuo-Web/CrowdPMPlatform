import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { id: string } }>("/v1/admin/devices/:id/suspend", async (req, rep) => {
    await requireUser(req); // TODO: role check
    const { id } = req.params;
    await db().collection("devices").doc(id).set({ status: "SUSPENDED" }, { merge: true });
    return rep.code(204).send();
  });
};
