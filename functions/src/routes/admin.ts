import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/fire.js";
import { requirePermissionGuard } from "../lib/routeGuards.js";

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { id: string } }>("/v1/admin/devices/:id/suspend", {
    preHandler: requirePermissionGuard("devices.moderate"),
  }, async (req, rep) => {
    const { id } = req.params;
    await db().collection("devices").doc(id).set({ status: "SUSPENDED" }, { merge: true });
    rep.code(204);
    return undefined;
  });
};
