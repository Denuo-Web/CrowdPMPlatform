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

  fastify.post<{ Body: {
    deviceId?: string;
    pointOverrides?: Partial<NonNullable<IngestBody["points"]>[number]>;
  } }>("/v1/admin/ingest-smoke-test", async (req, rep) => {
    await requireUser(req).catch(() => ({})); // allow unauthenticated usage in emulator
    if (!process.env.FUNCTIONS_EMULATOR) {
      return rep.code(403).send({ error: "smoke test endpoint is only available in the emulator" });
    }

    const defaultDeviceId = "device-123";
    const deviceId = req.body?.deviceId || req.body?.pointOverrides?.device_id || defaultDeviceId;
    const pointOverrides = req.body?.pointOverrides ?? {};
    const baseLat = 40.7128;
    const baseLon = -74.0060;
    const now = Date.now();
    const points: NonNullable<IngestBody["points"]> = Array.from({ length: 60 }, (_, idx) => {
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
    const payload: IngestBody = { points };

    const secret = getIngestSecret();
    if (!secret) {
      return rep.code(500).send({ error: "INGEST_HMAC_SECRET must be set to run smoke tests" });
    }

    await db().collection("devices").doc(deviceId).set({
      status: "ACTIVE",
      name: "Smoke Test Device",
      ownerUserId: "local-smoke-test",
      createdAt: new Date().toISOString(),
    }, { merge: true });

    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    try {
      const result = await ingestPayload(raw, payload, { signature });
      return rep.code(200).send({
        ...result,
        payload,
        points,
        seededDeviceId: deviceId,
      });
    }
    catch (err) {
      const statusCode = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
      const message = err instanceof Error ? err.message : "unexpected error";
      return rep.code(statusCode && statusCode >= 100 ? statusCode : 500).send({ error: message });
    }
  });

  fastify.post<{ Body: { deviceId?: string } }>("/v1/admin/ingest-smoke-test/cleanup", async (req, rep) => {
    await requireUser(req).catch(() => ({}));
    if (!process.env.FUNCTIONS_EMULATOR) {
      return rep.code(403).send({ error: "cleanup endpoint is only available in the emulator" });
    }
    const deviceId = req.body?.deviceId || "device-123";
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
    return rep.code(200).send({ clearedDeviceId: deviceId });
  });
};
