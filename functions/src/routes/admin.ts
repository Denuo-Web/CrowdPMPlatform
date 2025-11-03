import type { FastifyPluginAsync } from "fastify";
import crypto from "node:crypto";
import { app as getFirebaseApp, bucket, db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import { ingestPayload, type IngestBody } from "../services/ingestGateway.js";
import { decryptDeviceSecret, encryptDeviceSecret, generateDeviceSecret, hashClaimPassphrase, type DeviceSecretRecord } from "../lib/deviceSecrets.js";

export const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post<{ Params: { id: string } }>("/v1/admin/devices/:id/suspend", async (req, rep) => {
    await requireUser(req); // TODO: role check
    const { id } = req.params;
    await db().collection("devices").doc(id).set({ status: "SUSPENDED" }, { merge: true });
    return rep.code(204).send();
  });

  fastify.post<{ Body: { passphrase?: string; deviceId?: string; name?: string } }>(
    "/v1/admin/devices/unclaimed",
    async (req, rep) => {
      const user = await requireUser(req);
      const { passphrase, deviceId: requestedId, name } = req.body ?? {};
      if (typeof passphrase !== "string" || !passphrase.trim()) {
        return rep.code(400).send({ error: "passphrase is required" });
      }
      let passphraseHash: string;
      try {
        passphraseHash = hashClaimPassphrase(passphrase);
      }
      catch (err) {
        const message = err instanceof Error ? err.message : "unable to hash passphrase";
        return rep.code(400).send({ error: message });
      }

      const devicesColl = db().collection("devices");
      const passphraseRef = db().collection("devicePassphrases").doc(passphraseHash);
      const nowIso = new Date().toISOString();
      const result = await db().runTransaction(async (tx) => {
        const passphraseDoc = await tx.get(passphraseRef);
        if (passphraseDoc.exists) {
          return { outcome: "CONFLICT", deviceId: passphraseDoc.get("deviceId") } as const;
        }
        const targetRef = requestedId ? devicesColl.doc(requestedId) : devicesColl.doc();
        const existingTarget = await tx.get(targetRef);
        if (existingTarget.exists) {
          return { outcome: "CONFLICT_DEVICE", deviceId: targetRef.id } as const;
        }
        const secret = generateDeviceSecret();
        const encrypted = encryptDeviceSecret(secret);
        tx.set(targetRef, {
          status: "UNCLAIMED",
          name: name ?? null,
          ownerUserId: null,
          claimPassphraseHash: passphraseHash,
          claimPassphraseCreatedAt: nowIso,
          claimPassphraseConsumedAt: null,
          createdAt: nowIso,
          claimedAt: null,
          deviceSecret: encrypted,
          deviceSecretVersion: 1,
          deviceSecretUpdatedAt: encrypted.createdAt,
          bootstrapSecretDeliveredAt: null,
          bootstrapSecretDeliveredBy: null,
        }, { merge: false });
        tx.set(passphraseRef, {
          deviceId: targetRef.id,
          status: "UNCLAIMED",
          createdAt: nowIso,
          lastUpdatedAt: nowIso,
          provisionedBy: user.uid,
        }, { merge: true });

        return { outcome: "SUCCESS", deviceId: targetRef.id } as const;
      });

      await db().collection("deviceProvisionAudit").add({
        createdAt: nowIso,
        outcome: result.outcome,
        deviceId: "deviceId" in result ? result.deviceId : undefined,
        passphraseHash,
        userId: user.uid,
        ip: req.ip,
      });

      if (result.outcome === "CONFLICT") {
        return rep.code(409).send({ error: "passphrase already assigned", deviceId: result.deviceId });
      }
      if (result.outcome === "CONFLICT_DEVICE") {
        return rep.code(409).send({ error: "device id already exists", deviceId: result.deviceId });
      }

      return rep.code(201).send({
        id: result.deviceId,
        status: "UNCLAIMED",
        claimPassphraseHash: passphraseHash,
      });
    }
  );

  type SmokeTestBody = {
    deviceId?: string;
    payload?: IngestBody;
    pointOverrides?: Partial<NonNullable<IngestBody["points"]>[number]>;
  };

  fastify.post<{ Body: SmokeTestBody }>("/v1/admin/ingest-smoke-test", async (req, rep) => {
    fastify.log.info({ bodyKeys: Object.keys(req.body ?? {}) }, "ingest smoke test requested");
    await requireUser(req).catch(() => ({})); // allow unauthenticated usage when desired

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

    const deviceIds = Array.from(new Set(payload.points.map((point) => point.device_id).filter((id): id is string => Boolean(id))));
    const primaryDeviceId = deviceIds[0] || requestedDeviceId;
    if (!primaryDeviceId) {
      return rep.code(400).send({ error: "unable to determine device_id for smoke test" });
    }
    const seedTargets = deviceIds.length ? deviceIds : [primaryDeviceId];

    async function ensureDevice(deviceId: string) {
      const ref = db().collection("devices").doc(deviceId);
      const snap = await ref.get();
      const baseData = {
        status: "ACTIVE",
        name: "Smoke Test Device",
        ownerUserId: "smoke-test",
        createdAt: new Date().toISOString(),
      };
      let secretRecord = snap.exists ? (snap.get("deviceSecret") as DeviceSecretRecord | undefined) : undefined;
      let secret: string;
      let rotated = false;
      if (secretRecord) {
        try {
          secret = decryptDeviceSecret(secretRecord);
        }
        catch (err) {
          fastify.log.warn({ deviceId, err }, "failed to decrypt existing device secret; rotating");
          secret = generateDeviceSecret();
          secretRecord = encryptDeviceSecret(secret);
          rotated = true;
        }
      }
      else {
        secret = generateDeviceSecret();
        secretRecord = encryptDeviceSecret(secret);
        rotated = true;
      }
      const previousVersion = snap.exists && typeof snap.get("deviceSecretVersion") === "number"
        ? Number(snap.get("deviceSecretVersion"))
        : 0;
      await ref.set({
        ...baseData,
        deviceSecret: secretRecord,
        deviceSecretUpdatedAt: secretRecord.createdAt,
        deviceSecretVersion: rotated ? previousVersion + 1 : Math.max(previousVersion, 1),
      }, { merge: true });
      return secret;
    }

    const deviceSecrets = new Map<string, string>();
    await Promise.all(seedTargets.map(async (deviceId) => {
      const secret = await ensureDevice(deviceId);
      deviceSecrets.set(deviceId, secret);
    }));
    fastify.log.info({ deviceIds: seedTargets }, "ingest smoke test seeded devices");

    const raw = JSON.stringify(payload);
    const primarySecret = deviceSecrets.get(primaryDeviceId);
    if (!primarySecret) {
      fastify.log.error({ primaryDeviceId }, "missing device secret after seeding");
      return rep.code(500).send({ error: "device secret unavailable after seeding" });
    }
    const signature = crypto.createHmac("sha256", primarySecret).update(raw).digest("hex");
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
