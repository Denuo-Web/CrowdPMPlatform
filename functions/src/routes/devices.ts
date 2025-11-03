import type { FastifyPluginAsync } from "fastify";
import type { DocumentSnapshot, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import {
  decryptDeviceSecret,
  encryptDeviceSecret,
  generateDeviceSecret,
  hashClaimPassphrase,
  type DeviceSecretRecord,
} from "../lib/deviceSecrets.js";

const RATE_LIMITS = {
  claim: { max: 5, timeWindow: "1 minute" },
  bootstrap: { max: 30, timeWindow: "1 minute" },
};

type DeviceDocument = DocumentSnapshot | QueryDocumentSnapshot;

type ClaimTxnResult =
  | { outcome: "NOT_FOUND" }
  | { outcome: "CONFLICT"; status: unknown; deviceId: unknown }
  | { outcome: "SUCCESS"; deviceId: string; ingestSecret: string };

type BootstrapTxnResult =
  | { outcome: "NOT_FOUND" }
  | { outcome: "UNCLAIMED"; deviceId: string }
  | { outcome: "SUSPENDED"; deviceId: string }
  | { outcome: "DELIVERED"; deviceId: string; deliveredAt: string }
  | { outcome: "ERROR"; deviceId: string; reason: string }
  | { outcome: "SUCCESS"; deviceId: string; ownerUserId: string; ingestSecret: string; deliveredAt: string };

function serialiseDevice(doc: DeviceDocument) {
  const data = doc.data();
  if (!data) return { id: doc.id };
  const {
    deviceSecret,
    claimPassphraseHash,
    bootstrapSecretDeliveredBy,
    ...rest
  } = data;
  return { id: doc.id, ...rest };
}

async function recordAudit(collection: string, payload: Record<string, unknown>) {
  await db().collection(collection).add({ ...payload, createdAt: new Date().toISOString() });
}

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/devices", async (req) => {
    await requireUser(req).catch(() => ({})); // allow unauth read in dev
    const snap = await db().collection("devices").get();
    return snap.docs.map(serialiseDevice);
  });

  app.post<{ Body: { name?: string } }>("/v1/devices", async (req, rep) => {
    const user = await requireUser(req);
    const { name } = req.body ?? {};
    const ref = db().collection("devices").doc();
    const secret = generateDeviceSecret();
    const encryptedSecret = encryptDeviceSecret(secret);
    const nowIso = new Date().toISOString();
    await ref.set({
      name,
      ownerUserId: user.uid,
      status: "ACTIVE",
      createdAt: nowIso,
      claimedAt: nowIso,
      claimPassphraseHash: null,
      claimPassphraseCreatedAt: null,
      claimPassphraseConsumedAt: null,
      deviceSecret: encryptedSecret,
      deviceSecretUpdatedAt: encryptedSecret.createdAt,
      deviceSecretVersion: 1,
      bootstrapSecretDeliveredAt: null,
      bootstrapSecretDeliveredBy: null,
    });
    await recordAudit("deviceProvisionAudit", {
      outcome: "DIRECT_CREATE",
      deviceId: ref.id,
      userId: user.uid,
    });
    return rep.code(201).send({ id: ref.id, ingestSecret: secret });
  });

  app.get("/v1/devices/claims", async (req) => {
    const user = await requireUser(req);
    const devicesColl = db().collection("devices");
    const snap = await devicesColl.where("ownerUserId", "==", user.uid).get();
    return snap.docs
      .map((doc) => serialiseDevice(doc))
      .sort((a, b) => {
        const aTime = typeof a.claimedAt === "string" ? Date.parse(a.claimedAt) : NaN;
        const bTime = typeof b.claimedAt === "string" ? Date.parse(b.claimedAt) : NaN;
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return bTime - aTime;
      });
  });

  app.delete<{ Params: { deviceId: string } }>("/v1/devices/claims/:deviceId", async (req, rep) => {
    const user = await requireUser(req);
    const { deviceId } = req.params;
    if (!deviceId) {
      throw httpError(400, "device id is required");
    }

    const firestore = db();
    const deviceRef = firestore.collection("devices").doc(deviceId);
    const nowIso = new Date().toISOString();

    const outcome = await firestore.runTransaction(async (tx) => {
      const snap = await tx.get(deviceRef);
      if (!snap.exists) return { outcome: "NOT_FOUND" } as const;

      const data = snap.data();
      if (!data || data.ownerUserId !== user.uid) {
        if (!data) return { outcome: "NOT_FOUND" } as const;
        return { outcome: "FORBIDDEN" } as const;
      }

      const passphraseHash = typeof data.claimPassphraseHash === "string" ? data.claimPassphraseHash : null;
      const currentVersion = typeof data.deviceSecretVersion === "number" ? data.deviceSecretVersion : 0;

      const newSecret = generateDeviceSecret();
      const encryptedSecret = encryptDeviceSecret(newSecret);

      tx.set(deviceRef, {
        status: "UNCLAIMED",
        ownerUserId: null,
        claimedAt: null,
        claimPassphraseConsumedAt: null,
        deviceSecret: encryptedSecret,
        deviceSecretUpdatedAt: encryptedSecret.createdAt,
        deviceSecretVersion: currentVersion + 1,
        bootstrapSecretDeliveredAt: null,
        bootstrapSecretDeliveredBy: null,
      }, { merge: true });

      if (passphraseHash) {
        const passphraseRef = firestore.collection("devicePassphrases").doc(passphraseHash);
        tx.set(passphraseRef, {
          status: "UNCLAIMED",
          claimedAt: null,
          lastUpdatedAt: nowIso,
          bootstrapDeliveredAt: null,
        }, { merge: true });
      }

      return { outcome: "SUCCESS", passphraseHash } as const;
    });

    if (outcome.outcome === "NOT_FOUND") {
      throw httpError(404, "device not found");
    }
    if (outcome.outcome === "FORBIDDEN") {
      throw httpError(403, "device not owned by user");
    }

    await recordAudit("deviceClaimAudit", {
      outcome: "REVOKE",
      deviceId,
      userId: user.uid,
      ip: req.ip,
      passphraseHash: outcome.passphraseHash,
    });

    return rep.code(204).send();
  });

  type ClaimBody = { passphrase?: string };
  app.post<{ Body: ClaimBody }>("/v1/devices/claim", { config: { rateLimit: RATE_LIMITS.claim } }, async (req, rep) => {
    const user = await requireUser(req);
    const passphrase = req.body?.passphrase;
    if (typeof passphrase !== "string" || !passphrase.trim()) {
      await recordAudit("deviceClaimAudit", {
        outcome: "INVALID",
        reason: "missing-passphrase",
        ip: req.ip,
        userId: user.uid,
      });
      throw httpError(400, "passphrase is required");
    }

    let passphraseHash: string;
    try {
      passphraseHash = hashClaimPassphrase(passphrase);
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "hash-error";
      await recordAudit("deviceClaimAudit", {
        outcome: "INVALID",
        reason: message,
        ip: req.ip,
        userId: user.uid,
      });
      if (message.includes("CLAIM_PASSPHRASE_PEPPER")) {
        throw httpError(500, "claiming temporarily unavailable");
      }
      throw httpError(400, "passphrase is invalid");
    }

    const devicesColl = db().collection("devices");
    const passphraseRef = db().collection("devicePassphrases").doc(passphraseHash);

    const nowIso = new Date().toISOString();
    const result = await db().runTransaction<ClaimTxnResult>(async (tx) => {
      const matches = await tx.get(
        devicesColl
          .where("claimPassphraseHash", "==", passphraseHash)
          .where("status", "==", "UNCLAIMED")
          .limit(1)
      );
      if (matches.empty) {
        const passphraseDoc = await tx.get(passphraseRef);
        if (passphraseDoc.exists) {
          return {
            outcome: "CONFLICT",
            status: passphraseDoc.get("status"),
            deviceId: passphraseDoc.get("deviceId"),
          } satisfies ClaimTxnResult;
        }
        return { outcome: "NOT_FOUND" } satisfies ClaimTxnResult;
      }

      const deviceDoc = matches.docs[0];
      const deviceRef = deviceDoc.ref;
      const currentVersion = typeof deviceDoc.get("deviceSecretVersion") === "number"
        ? Number(deviceDoc.get("deviceSecretVersion"))
        : 0;
      const newSecret = generateDeviceSecret();
      const encryptedSecret = encryptDeviceSecret(newSecret);

      tx.set(deviceRef, {
        ownerUserId: user.uid,
        claimedAt: nowIso,
        status: "ACTIVE",
        claimPassphraseHash: passphraseHash,
        claimPassphraseConsumedAt: nowIso,
        deviceSecret: encryptedSecret,
        deviceSecretUpdatedAt: encryptedSecret.createdAt,
        deviceSecretVersion: currentVersion + 1,
        bootstrapSecretDeliveredAt: null,
        bootstrapSecretDeliveredBy: null,
      }, { merge: true });
      tx.set(passphraseRef, {
        deviceId: deviceRef.id,
        status: "CLAIMED",
        claimedAt: nowIso,
        lastUpdatedAt: nowIso,
      }, { merge: true });

      return {
        outcome: "SUCCESS",
        deviceId: deviceRef.id,
        ingestSecret: newSecret,
      } satisfies ClaimTxnResult;
    });

    if (result.outcome === "NOT_FOUND") {
      await recordAudit("deviceClaimAudit", {
        outcome: "NOT_FOUND",
        passphraseHash,
        ip: req.ip,
        userId: user.uid,
      });
      throw httpError(404, "passphrase not recognised or already claimed");
    }

    if (result.outcome === "CONFLICT") {
      await recordAudit("deviceClaimAudit", {
        outcome: "CONFLICT",
        passphraseHash,
        ip: req.ip,
        userId: user.uid,
        deviceId: result.deviceId,
        status: result.status,
      });
      throw httpError(409, "passphrase already claimed");
    }

    const updatedSnap = await devicesColl.doc(result.deviceId).get();
    await recordAudit("deviceClaimAudit", {
      outcome: "SUCCESS",
      passphraseHash,
      ip: req.ip,
      userId: user.uid,
      deviceId: result.deviceId,
    });

    return rep.code(200).send({
      deviceId: result.deviceId,
      ingestSecret: result.ingestSecret,
      device: serialiseDevice(updatedSnap),
    });
  });

  type BootstrapBody = { passphrase?: string; deviceId?: string };
  app.post<{ Body: BootstrapBody }>(
    "/v1/devices/bootstrap",
    { config: { rateLimit: RATE_LIMITS.bootstrap } },
    async (req, rep) => {
      const passphrase = req.body?.passphrase;
      if (typeof passphrase !== "string" || !passphrase.trim()) {
        await recordAudit("deviceBootstrapAudit", {
          outcome: "INVALID",
          reason: "missing-passphrase",
          ip: req.ip,
        });
        throw httpError(400, "passphrase is required");
      }

      let passphraseHash: string;
      try {
        passphraseHash = hashClaimPassphrase(passphrase);
      }
      catch (err) {
        const message = err instanceof Error ? err.message : "hash-error";
        await recordAudit("deviceBootstrapAudit", {
          outcome: "INVALID",
          reason: message,
          ip: req.ip,
        });
        if (message.includes("CLAIM_PASSPHRASE_PEPPER")) {
          throw httpError(500, "bootstrap temporarily unavailable");
        }
        throw httpError(400, "passphrase is invalid");
      }

      const devicesColl = db().collection("devices");
      const matches = await devicesColl
        .where("claimPassphraseHash", "==", passphraseHash)
        .limit(1)
        .get();

      if (matches.empty) {
        await recordAudit("deviceBootstrapAudit", {
          outcome: "NOT_FOUND",
          passphraseHash,
          ip: req.ip,
        });
        throw httpError(404, "device not found");
      }

      const deviceDoc = matches.docs[0];
      if (req.body?.deviceId && req.body.deviceId !== deviceDoc.id) {
        await recordAudit("deviceBootstrapAudit", {
          outcome: "DEVICE_MISMATCH",
          passphraseHash,
          ip: req.ip,
          expectedDeviceId: deviceDoc.id,
          providedDeviceId: req.body.deviceId,
        });
        throw httpError(409, "device id mismatch");
      }

      const passphraseRef = db().collection("devicePassphrases").doc(passphraseHash);
      const nowIso = new Date().toISOString();
      const outcome = await db().runTransaction<BootstrapTxnResult>(async (tx) => {
        const fresh = await tx.get(deviceDoc.ref);
        if (!fresh.exists) return { outcome: "NOT_FOUND" } satisfies BootstrapTxnResult;

        const status = fresh.get("status");
        const ownerUserId = fresh.get("ownerUserId") as string | undefined;
        const deliveredAt = fresh.get("bootstrapSecretDeliveredAt") as string | null;
        const deviceId = fresh.id;

        if (status === "UNCLAIMED" || !ownerUserId) {
          return { outcome: "UNCLAIMED", deviceId } satisfies BootstrapTxnResult;
        }
        if (status === "SUSPENDED") {
          return { outcome: "SUSPENDED", deviceId } satisfies BootstrapTxnResult;
        }
        if (deliveredAt) {
          return { outcome: "DELIVERED", deviceId, deliveredAt } satisfies BootstrapTxnResult;
        }

        const secretRecord = fresh.get("deviceSecret") as DeviceSecretRecord | undefined;
        if (!secretRecord) {
          return { outcome: "ERROR", deviceId, reason: "missing-secret" } satisfies BootstrapTxnResult;
        }

        let secret: string;
        try {
          secret = decryptDeviceSecret(secretRecord);
        }
        catch (err) {
          return { outcome: "ERROR", deviceId, reason: err instanceof Error ? err.message : "decrypt-failed" } satisfies BootstrapTxnResult;
        }

        tx.set(fresh.ref, {
          bootstrapSecretDeliveredAt: nowIso,
          bootstrapSecretDeliveredBy: { ip: req.ip ?? null, at: nowIso },
        }, { merge: true });
        tx.set(passphraseRef, {
          bootstrapDeliveredAt: nowIso,
          lastUpdatedAt: nowIso,
        }, { merge: true });

        return {
          outcome: "SUCCESS",
          deviceId,
          ownerUserId,
          ingestSecret: secret,
          deliveredAt: nowIso,
        } satisfies BootstrapTxnResult;
      });

      await recordAudit("deviceBootstrapAudit", {
        outcome: outcome.outcome,
        deviceId: "deviceId" in outcome ? outcome.deviceId : undefined,
        passphraseHash,
        ip: req.ip,
      });

      if (outcome.outcome === "NOT_FOUND") throw httpError(404, "device not found");
      if (outcome.outcome === "UNCLAIMED") {
        return rep.code(200).send({ status: "UNCLAIMED", deviceId: outcome.deviceId });
      }
      if (outcome.outcome === "SUSPENDED") {
        return rep.code(423).send({ status: "SUSPENDED", deviceId: outcome.deviceId });
      }
      if (outcome.outcome === "DELIVERED") {
        return rep.code(200).send({
          status: "DELIVERED",
          deviceId: outcome.deviceId,
          deliveredAt: outcome.deliveredAt,
        });
      }
      if (outcome.outcome === "ERROR") {
        throw httpError(500, "device secret unavailable");
      }

      return rep.code(200).send({
        status: "CLAIMED",
        deviceId: outcome.deviceId,
        ownerUserId: outcome.ownerUserId,
        ingestSecret: outcome.ingestSecret,
        deliveredAt: outcome.deliveredAt,
      });
    }
  );
};
