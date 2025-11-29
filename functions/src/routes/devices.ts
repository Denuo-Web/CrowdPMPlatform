import type { FastifyPluginAsync } from "fastify";
import type { firestore } from "firebase-admin";
import { db } from "../lib/fire.js";
import { revokeDevice } from "../services/deviceRegistry.js";
import { loadOwnedDeviceDocs } from "../lib/deviceOwnership.js";
import { timestampToIsoString } from "../lib/time.js";
import {
  getRequestUser,
  requestParam,
  rateLimitGuard,
  requireDeviceOwnerGuard,
  requireUserGuard,
  requestUserId,
} from "../lib/routeGuards.js";

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/devices", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `devices:list:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard("devices:list:global", 2_000, 60_000),
    ],
  }, async (req) => {
    const user = getRequestUser(req);
    const { docs } = await loadOwnedDeviceDocs(user.uid);
    return Array.from(docs.entries()).map(([id, data]) => serializeDeviceDoc(id, data));
  });

  app.post<{ Body: { name?: string } }>("/v1/devices", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `devices:create:${requestUserId(req)}`, 10, 60_000),
      rateLimitGuard("devices:create:global", 500, 60_000),
    ],
  }, async (req, rep) => {
    const user = getRequestUser(req);
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

  app.post<{ Params: { deviceId: string } }>("/v1/devices/:deviceId/revoke", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `devices:revoke:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard((req) => `devices:revoke:device:${requestParam(req, "deviceId")}`, 10, 60_000),
      rateLimitGuard("devices:revoke:global", 500, 60_000),
      requireDeviceOwnerGuard((req) => requestParam(req, "deviceId")),
    ],
  }, async (req, rep) => {
    const userId = requestUserId(req);
    const { deviceId } = req.params;
    await revokeDevice(deviceId, userId, "user_initiated");
    return rep.code(200).send({ status: "revoked" });
  });
};

function serializeDeviceDoc(id: string, data: firestore.DocumentData | undefined) {
  const createdAt = timestampToIsoString(data?.createdAt);
  const lastSeenAt = timestampToIsoString(data?.lastSeenAt);
  const payload: Record<string, unknown> = { id, ...data };
  payload.createdAt = createdAt ?? null;
  payload.lastSeenAt = lastSeenAt ?? null;
  return payload;
}
