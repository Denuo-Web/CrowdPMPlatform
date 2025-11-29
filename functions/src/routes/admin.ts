import type { FastifyPluginAsync } from "fastify";
import type { DecodedIdToken } from "firebase-admin/auth";
import { app as getFirebaseApp, bucket, db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import { IngestServiceError } from "../services/ingestService.js";
import { getIngestSmokeTestService, SmokeTestServiceError } from "../services/ingestSmokeTestService.js";
import { type SmokeTestBody } from "../services/smokeTest.js";
import { userOwnsDevice } from "../lib/deviceOwnership.js";

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const smokeTestService = getIngestSmokeTestService();

  fastify.post<{ Params: { id: string } }>("/v1/admin/devices/:id/suspend", async (req, rep) => {
    const user = await requireUser(req);
    if (!userCanSuspendDevices(user)) {
      return rep.code(403).send({ error: "forbidden", message: "You do not have permission to suspend devices." });
    }
    const { id } = req.params;
    await db().collection("devices").doc(id).set({ status: "SUSPENDED" }, { merge: true });
    return rep.code(204).send();
  });

  fastify.post<{ Body: SmokeTestBody }>("/v1/admin/ingest-smoke-test", async (req, rep) => {
    fastify.log.info({ bodyKeys: Object.keys(req.body ?? {}) }, "ingest smoke test requested");
    const user = await requireUser(req);

    try {
      const result = await smokeTestService.runSmokeTest({ user, body: req.body });
      fastify.log.info(
        { batchId: result.batchId, deviceId: result.deviceId, deviceIds: result.seededDeviceIds },
        "ingest smoke test completed"
      );
      return rep.code(200).send(result);
    }
    catch (err) {
      fastify.log.error({ err }, "ingest smoke test failed");
      const statusCode = extractStatusCode(err) ?? 500;
      const message = err instanceof Error ? err.message : "unexpected error";
      return rep.code(statusCode).send({ error: message });
    }
  });

  fastify.post<{ Body: { deviceId?: string; deviceIds?: string[] } }>("/v1/admin/ingest-smoke-test/cleanup", async (req, rep) => {
    const user = await requireUser(req);

    const uniqueIds = Array.from(new Set(
      (req.body?.deviceIds && req.body.deviceIds.length ? req.body.deviceIds : [req.body?.deviceId || "device-123"])
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    ));

    const allowedIds: string[] = [];
    const forbiddenIds: string[] = [];
    await Promise.all(uniqueIds.map(async (deviceId) => {
      const snap = await db().collection("devices").doc(deviceId).get();
      if (!snap.exists) {
        allowedIds.push(deviceId); // stale device reference; allow cleanup to continue
        return;
      }
      if (userOwnsDevice(snap.data(), user.uid)) {
        allowedIds.push(deviceId);
        return;
      }
      forbiddenIds.push(deviceId);
    }));

    if (forbiddenIds.length) {
      return rep.code(403).send({
        error: "forbidden",
        message: "You do not have permission to delete one or more devices.",
        forbiddenDeviceIds: forbiddenIds,
      });
    }

    const cleared: string[] = [];
    for (const deviceId of allowedIds) {
      const ref = db().collection("devices").doc(deviceId);
      await getFirebaseApp().firestore().recursiveDelete(ref).catch((err: unknown) => {
        console.warn("Failed to recursively delete Firestore data", err);
      });
      try {
        await bucket().deleteFiles({ prefix: `ingest/${deviceId}/` });
      }
      catch (err) {
        console.warn("Failed to delete storage files", err);
      }
      await db().collection("devices").doc(deviceId).delete().catch(() => {});
      cleared.push(deviceId);
    }
    return rep.code(200).send({
      clearedDeviceId: cleared[0] || null,
      clearedDeviceIds: cleared,
    });
  });
};

function userCanSuspendDevices(user: DecodedIdToken): boolean {
  if ((user as { admin?: unknown }).admin === true) return true;
  const roles = (user as { roles?: unknown }).roles;
  if (!Array.isArray(roles)) return false;
  return roles.some((role) => typeof role === "string" && role.trim().toLowerCase() === "admin");
}

function extractStatusCode(err: unknown): number | undefined {
  if (err instanceof IngestServiceError) return err.statusCode;
  if (err instanceof SmokeTestServiceError) return err.statusCode;
  if (typeof err === "object" && err && "statusCode" in err) {
    const raw = Number((err as { statusCode: unknown }).statusCode);
    if (raw >= 100) return raw;
  }
  return undefined;
}
