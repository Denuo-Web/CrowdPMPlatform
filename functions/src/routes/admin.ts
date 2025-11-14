import type { FastifyPluginAsync } from "fastify";
import { app as getFirebaseApp, bucket, db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import { ingestPayload } from "../services/ingestGateway.js";
import { prepareSmokeTestPlan, type SmokeTestBody } from "../services/smokeTest.js";
import {
  DEFAULT_BATCH_VISIBILITY,
  getUserDefaultBatchVisibility,
  normalizeBatchVisibility,
} from "../lib/batchVisibility.js";
import { userOwnsDevice } from "../lib/deviceOwnership.js";

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { id: string } }>("/v1/admin/devices/:id/suspend", async (req, rep) => {
    await requireUser(req); // TODO: role check
    const { id } = req.params;
    await db().collection("devices").doc(id).set({ status: "SUSPENDED" }, { merge: true });
    return rep.code(204).send();
  });

  fastify.post<{ Body: SmokeTestBody }>("/v1/admin/ingest-smoke-test", async (req, rep) => {
    fastify.log.info({ bodyKeys: Object.keys(req.body ?? {}) }, "ingest smoke test requested");
    const user = await requireUser(req);

    let plan: ReturnType<typeof prepareSmokeTestPlan>;
    try {
      plan = prepareSmokeTestPlan(user.uid, req.body);
    }
    catch (err) {
      fastify.log.warn({ err }, "invalid smoke test request");
      const message = err instanceof Error ? err.message : "invalid smoke test payload";
      return rep.code(400).send({ error: message });
    }

    const requestedVisibility = normalizeBatchVisibility(req.body?.visibility);
    const defaultVisibility = await getUserDefaultBatchVisibility(user.uid);
    const targetVisibility = requestedVisibility ?? defaultVisibility ?? DEFAULT_BATCH_VISIBILITY;

    const ownerIds = [user.uid];
    await seedSmokeTestDevices({
      ownerIds,
      ownerSegment: plan.ownerSegment,
      seedTargets: plan.seedTargets,
      scopedToRawIds: plan.scopedToRawIds,
    });
    fastify.log.info({ deviceIds: plan.seedTargets }, "ingest smoke test seeded devices");

    const raw = JSON.stringify(plan.payload);
    try {
      const result = await ingestPayload(raw, plan.payload, {
        deviceId: plan.primaryDeviceId,
        visibility: targetVisibility,
      });
      fastify.log.info({ batchId: result.batchId, deviceId: result.deviceId }, "ingest smoke test completed");
      return rep.code(200).send({
        ...result,
        payload: plan.payload,
        points: plan.displayPoints,
        seededDeviceId: plan.primaryDeviceId,
        seededDeviceIds: plan.seedTargets,
      });
    }
    catch (err) {
      fastify.log.error({ err }, "ingest smoke test failed");
      const statusCode = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
      const message = err instanceof Error ? err.message : "unexpected error";
      return rep.code(statusCode && statusCode >= 100 ? statusCode : 500).send({ error: message });
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

type SeedSmokeTestOptions = {
  ownerIds: string[];
  ownerSegment: string;
  seedTargets: string[];
  scopedToRawIds: Map<string, string>;
};

async function seedSmokeTestDevices({ ownerIds, ownerSegment, seedTargets, scopedToRawIds }: SeedSmokeTestOptions) {
  if (!seedTargets.length) return;
  const arrayUnion = getFirebaseApp().firestore.FieldValue.arrayUnion;
  const primaryOwnerId = ownerIds[0] ?? null;
  const timestamp = new Date().toISOString();

  await Promise.all(seedTargets.map(async (deviceId) => {
    const publicDeviceId = scopedToRawIds.get(deviceId) ?? deviceId;
    const payload: Record<string, unknown> = {
      status: "ACTIVE",
      name: "Smoke Test Device",
      createdAt: timestamp,
      publicDeviceId,
      ownerScope: ownerSegment,
    };
    if (primaryOwnerId) {
      payload.ownerUserId = primaryOwnerId;
    }
    if (ownerIds.length) {
      payload.ownerUserIds = arrayUnion(...ownerIds);
    }
    await db().collection("devices").doc(deviceId).set(payload, { merge: true });
  }));
}
