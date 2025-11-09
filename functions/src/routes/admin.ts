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

  const slugify = (value: string | undefined | null, fallback: string) => {
    if (!value) return fallback;
    const normalised = value
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-");
    return normalised || fallback;
  };

  const scopeDeviceId = (ownerSegment: string, rawDeviceId: string) => {
    const deviceSegment = slugify(rawDeviceId, "device");
    return `${ownerSegment}-${deviceSegment}`;
  };

  fastify.post<{ Body: SmokeTestBody }>("/v1/admin/ingest-smoke-test", async (req, rep) => {
    fastify.log.info({ bodyKeys: Object.keys(req.body ?? {}) }, "ingest smoke test requested");
    const user = await requireUser(req);

    const defaultDeviceId = "device-123";
    const body = req.body ?? {};
    const overridesRaw = body.pointOverrides ?? {};
    const pointOverrides = Object.fromEntries(
      Object.entries(overridesRaw).filter(([, value]) => value !== undefined)
    ) as Partial<NonNullable<IngestBody["points"]>[number]>;
    const overrideDeviceId = typeof pointOverrides.device_id === "string" && pointOverrides.device_id.trim();

    const ensureDeviceId = (candidate: unknown, fallback: string) => {
      const trimmed = typeof candidate === "string" ? candidate.trim() : "";
      return trimmed || fallback;
    };

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
        const basePoint = {
          device_id: deviceId,
          pollutant: "pm25",
          value: Math.round(baseValue * 10) / 10,
          unit: "\u00b5g/m\u00b3",
          lat: Number((baseLat + latOffset).toFixed(6)),
          lon: Number((baseLon + lonOffset).toFixed(6)),
          timestamp: ts.toISOString(),
          precision,
          altitude: Number(altitude.toFixed(1)),
        };
        const merged = { ...basePoint, ...pointOverrides };
        return {
          ...merged,
          device_id: ensureDeviceId(pointOverrides.device_id, basePoint.device_id),
          pollutant: merged.pollutant ?? "pm25",
          timestamp: merged.timestamp ?? basePoint.timestamp,
        };
      });
    }

    const providedPoints = body.payload?.points;
    const requestedDeviceId = ensureDeviceId(
      body.deviceId ||
      overrideDeviceId ||
      providedPoints?.[0]?.device_id ||
      body.payload?.device_id,
      defaultDeviceId
    );

    const points: NonNullable<IngestBody["points"]> = providedPoints?.length
      ? providedPoints.map((point, idx) => {
        const fallbackTimestamp = new Date(Date.now() - (providedPoints.length - idx - 1) * 1000).toISOString();
        const merged = { ...point, ...pointOverrides };
        return {
          ...merged,
          pollutant: merged.pollutant ?? "pm25",
          device_id: ensureDeviceId(merged.device_id, requestedDeviceId),
          timestamp: merged.timestamp ?? fallbackTimestamp,
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

    const ownerSegment = slugify(user.uid, "user");

    const rawDeviceIds = Array.from(new Set(
      payload.points
        .map((point) => point.device_id)
        .filter((id): id is string => Boolean(id))
    ));

    const idMap = new Map<string, string>();
    rawDeviceIds.forEach((rawId) => {
      idMap.set(rawId, scopeDeviceId(ownerSegment, rawId));
    });
    if (!rawDeviceIds.length) {
      const fallback = scopeDeviceId(ownerSegment, requestedDeviceId);
      idMap.set(requestedDeviceId, fallback);
    }

    payload.points = payload.points.map((point, idx) => {
      const rawId = point.device_id || rawDeviceIds[idx % rawDeviceIds.length] || requestedDeviceId;
      const scopedId = idMap.get(rawId) ?? scopeDeviceId(ownerSegment, rawId);
      if (!idMap.has(rawId)) {
        idMap.set(rawId, scopedId);
      }
      return { ...point, device_id: scopedId };
    });

    const deviceIds = Array.from(new Set(payload.points.map((point) => point.device_id).filter((id): id is string => Boolean(id))));
    const primaryDeviceId = deviceIds[0] || scopeDeviceId(ownerSegment, requestedDeviceId);
    if (!primaryDeviceId) {
      return rep.code(400).send({ error: "unable to determine device_id for smoke test" });
    }
    const ownerIds = [user.uid];
    const arrayUnion = getFirebaseApp().firestore.FieldValue.arrayUnion;
    const primaryOwnerId = ownerIds[0];
    const scopedToRaw = new Map<string, string>();
    idMap.forEach((scoped, raw) => scopedToRaw.set(scoped, raw));

    const seedTargets = deviceIds.length ? deviceIds : [primaryDeviceId];
    await Promise.all(seedTargets.map(async (deviceId) => {
      const publicDeviceId = scopedToRaw.get(deviceId) ?? deviceId;
      const payload: Record<string, unknown> = {
        status: "ACTIVE",
        name: "Smoke Test Device",
        createdAt: new Date().toISOString(),
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
    fastify.log.info({ deviceIds: seedTargets }, "ingest smoke test seeded devices");

    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    try {
      const result = await ingestPayload(raw, payload, { signature, deviceId: primaryDeviceId });
      fastify.log.info({ batchId: result.batchId, deviceId: result.deviceId }, "ingest smoke test completed");
      return rep.code(200).send({
        ...result,
        payload,
        points,
        seededDeviceId: primaryDeviceId,
        seededDeviceIds: deviceIds.length ? deviceIds : [primaryDeviceId],
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
      const data = snap.data() as { ownerUserId?: string | null; ownerUserIds?: string[] | null } | undefined;
      const owners = Array.isArray(data?.ownerUserIds)
        ? data.ownerUserIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        : [];
      const ownerUserId = typeof data?.ownerUserId === "string" && data.ownerUserId.length > 0
        ? data.ownerUserId
        : null;
      const isOwner = ownerUserId === user.uid || owners.includes(user.uid);
      if (isOwner) {
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
