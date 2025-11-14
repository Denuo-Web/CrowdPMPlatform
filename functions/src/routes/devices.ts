import type { FastifyPluginAsync } from "fastify";
import type { firestore } from "firebase-admin";
import { db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import { revokeDevice } from "../services/deviceRegistry.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";
import { loadOwnedDeviceDocs, userOwnsDevice } from "../lib/deviceOwnership.js";
import { timestampToIsoString } from "../lib/time.js";

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/devices", async (req) => {
    const user = await requireUser(req);
    rateLimitOrThrow(`devices:list:${user.uid}`, 60, 60_000);
    rateLimitOrThrow("devices:list:global", 2_000, 60_000);
    const { docs } = await loadOwnedDeviceDocs(user.uid);
    return Array.from(docs.entries()).map(([id, data]) => serializeDeviceDoc(id, data));
  });

  app.post<{ Body: { name?: string } }>("/v1/devices", async (req, rep) => {
    const user = await requireUser(req);
    rateLimitOrThrow(`devices:create:${user.uid}`, 10, 60_000);
    rateLimitOrThrow("devices:create:global", 500, 60_000);
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

  app.post<{ Params: { deviceId: string } }>("/v1/devices/:deviceId/revoke", async (req, rep) => {
    const user = await requireUser(req);
    rateLimitOrThrow(`devices:revoke:${user.uid}`, 30, 60_000);
    const { deviceId } = req.params;
    rateLimitOrThrow(`devices:revoke:device:${deviceId}`, 10, 60_000);
    rateLimitOrThrow("devices:revoke:global", 500, 60_000);
    const doc = await db().collection("devices").doc(deviceId).get();
    if (!doc.exists) {
      return rep.code(404).send({ error: "not_found", message: "Device not found" });
    }
    if (!userOwnsDevice(doc.data(), user.uid)) {
      return rep.code(403).send({ error: "forbidden", message: "You do not own this device." });
    }
    await revokeDevice(deviceId, user.uid, "user_initiated");
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
