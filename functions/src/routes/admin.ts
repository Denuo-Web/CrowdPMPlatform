import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { app as getFirebaseApp, bucket, db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import { ingestPayload, type IngestBody } from "../services/ingestGateway.js";
import { getIngestSecret } from "../lib/runtimeConfig.js";

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { id: string } }>("/v1/admin/devices/:id/suspend", async (req, rep) => {
    await requireUser(req); // TODO: role check
    const { id } = req.params;
    await db().collection("devices").doc(id).set({ status: "SUSPENDED" }, { merge: true });
    return rep.code(204).send();
  });

  type SmokeTestBody = {
    deviceId?: string;
    payload?: IngestBody;
    pointOverrides?: Partial<NonNullable<IngestBody["points"]>[number]>;
  };

  fastify.post<{ Body: SmokeTestBody }>("/v1/admin/ingest-smoke-test", async (req, rep) => {
    await requireUser(req).catch(() => ({})); // allow unauthenticated usage when desired

    const defaultDeviceId = "device-123";
    const body = req.body ?? {};
    const pointOverrides = body.pointOverrides ?? {};

    function buildDefaultPoints(deviceId: string) {
      const baseLat = 40.7128;
      const baseLon = -74.0060;
      const now = Date.now();
      return Array.from({ length: 60 }, (_, idx) => {
        const secondsAgo = 59 - idx;
        const ts = new Date(now - secondsAgo * 1000);
        const progress = idx / 59;
        const latOffset = Math.sin(progress * Math.PI * 2) * 0.0002;
        const lonOffset = Math.cos(progress * Math.PI * 2) * 0.0002;
        const altitude = 25 + Math.sin(progress * Math.PI * 6) * 5 + Math.random() * 2;
        const baseValue = 15 + Math.sin(progress * Math.PI * 4) * 10 + Math.random();
        const precision = 5 + Math.round(Math.abs(Math.cos(progress * Math.PI * 2)) * 20);
        return {
          device_id: deviceId,
          pollutant: "pm25",
          value: Math.round(baseValue * 10) / 10,
          unit: "\u00b5g/m\u00b3",
          lat: Number((baseLat + latOffset).toFixed(6)),
          lon: Number((baseLon + lonOffset).toFixed(6)),
          timestamp: ts.toISOString(),
          precision,
          altitude: Number(altitude.toFixed(1)),
          ...pointOverrides,
        };
      });
    }

    const providedPoints = body.payload?.points;
    const requestedDeviceId =
      body.deviceId ||
      body.pointOverrides?.device_id ||
      providedPoints?.[0]?.device_id ||
      body.payload?.device_id ||
      defaultDeviceId;

    const points: NonNullable<IngestBody["points"]> = providedPoints?.length
      ? providedPoints.map((point, idx) => {
        const fallbackTimestamp = new Date(Date.now() - (providedPoints.length - idx - 1) * 1000).toISOString();
        return {
          pollutant: point.pollutant || "pm25",
          device_id: point.device_id || requestedDeviceId,
          timestamp: point.timestamp || fallbackTimestamp,
          ...point,
          ...pointOverrides,
        };
      })
      : buildDefaultPoints(requestedDeviceId);

    const payload: IngestBody = {
      ...body.payload,
      points,
    };
    if (!payload.points || payload.points.length === 0) {
      return rep.code(400).send({ error: "payload must include at least one point" });
    }

    const secret = getIngestSecret();
    if (!secret) {
      return rep.code(500).send({ error: "INGEST_HMAC_SECRET must be set to run smoke tests" });
    }

    const deviceIds = Array.from(new Set(payload.points.map((point) => point.device_id).filter((id): id is string => Boolean(id))));
    const primaryDeviceId = deviceIds[0] || requestedDeviceId;
    if (!primaryDeviceId) {
      return rep.code(400).send({ error: "unable to determine device_id for smoke test" });
    }
    const seedTargets = deviceIds.length ? deviceIds : [primaryDeviceId];
    await Promise.all(seedTargets.map(async (deviceId) => {
      await db().collection("devices").doc(deviceId).set({
        status: "ACTIVE",
        name: "Smoke Test Device",
        ownerUserId: "smoke-test",
        createdAt: new Date().toISOString(),
      }, { merge: true });
    }));

    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    try {
      const result = await ingestPayload(raw, payload, { signature, deviceId: primaryDeviceId });
      return rep.code(200).send({
        ...result,
        payload,
        points,
        seededDeviceId: primaryDeviceId,
        seededDeviceIds: deviceIds.length ? deviceIds : [primaryDeviceId],
      });
    }
    catch (err) {
      const statusCode = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
      const message = err instanceof Error ? err.message : "unexpected error";
      return rep.code(statusCode && statusCode >= 100 ? statusCode : 500).send({ error: message });
    }
  });

  fastify.post<{ Body: { deviceId?: string; deviceIds?: string[] } }>("/v1/admin/ingest-smoke-test/cleanup", async (req, rep) => {
    await requireUser(req).catch(() => ({}));

    const uniqueIds = Array.from(new Set(
      (req.body?.deviceIds && req.body.deviceIds.length ? req.body.deviceIds : [req.body?.deviceId || "device-123"])
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        .map((id) => id.trim())
    ));

    const cleared: string[] = [];
    for (const deviceId of uniqueIds) {
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
