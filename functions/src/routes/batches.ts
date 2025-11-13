import type { FastifyPluginAsync } from "fastify";
import { bucket, db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import { IngestBatch as IngestBatchSchema } from "../lib/validation.js";
import type { IngestBatch } from "../lib/validation.js";
import {
  DEFAULT_BATCH_VISIBILITY,
  normalizeBatchVisibility,
  type BatchVisibility,
} from "../lib/batchVisibility.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";

type BatchSummary = {
  batchId: string;
  deviceId: string;
  deviceName?: string | null;
  count: number;
  processedAt: string | null;
  visibility: BatchVisibility;
};

type BatchDetail = BatchSummary & {
  points: IngestBatch["points"];
};

type DeviceRecord = Record<string, unknown>;

function normaliseTimestamp(input: unknown): string | null {
  if (!input) return null;
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (typeof input === "number") {
    return Number.isFinite(input) ? new Date(input).toISOString() : null;
  }
  if (input instanceof Date) {
    return input.toISOString();
  }
  if (typeof input === "object" && "toDate" in input && typeof (input as { toDate?: () => Date }).toDate === "function") {
    try {
      return (input as { toDate: () => Date }).toDate().toISOString();
    }
    catch {
      return null;
    }
  }
  return null;
}

async function loadOwnedDevices(userId: string) {
  const devices = db().collection("devices");
  const [multiOwnerSnap, legacySnap] = await Promise.all([
    devices.where("ownerUserIds", "array-contains", userId).get(),
    devices.where("ownerUserId", "==", userId).get(),
  ]);

  const seen = new Map<string, DeviceRecord>();
  [multiOwnerSnap, legacySnap].forEach((snap) => {
    snap.forEach((doc) => {
      if (!seen.has(doc.id)) {
        seen.set(doc.id, doc.data());
      }
    });
  });
  return { devices, seen };
}

export const batchesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/batches", async (req) => {
    const user = await requireUser(req);
    rateLimitOrThrow(`batches:list:${user.uid}`, 30, 60_000);
    rateLimitOrThrow("batches:list:global", 1_000, 60_000);
    const { devices, seen } = await loadOwnedDevices(user.uid);

    const summaries = await Promise.all(
      Array.from(seen.entries()).map(async ([deviceId, deviceData]) => {
        const deviceName = typeof deviceData?.name === "string" ? deviceData.name : null;
        const batchSnap = await devices.doc(deviceId).collection("batches")
          .orderBy("processedAt", "desc")
          .limit(10)
          .get();

        return batchSnap.docs.map((doc) => {
          const data = doc.data() as { count?: unknown; processedAt?: unknown; visibility?: unknown } | undefined;
          const count = typeof data?.count === "number" ? data.count : 0;
          const processedAt = normaliseTimestamp(data?.processedAt);
          const visibility = normalizeBatchVisibility(data?.visibility) ?? DEFAULT_BATCH_VISIBILITY;
          return {
            batchId: doc.id,
            deviceId,
            deviceName,
            count,
            processedAt,
            visibility,
          } as BatchSummary;
        });
      })
    );

    return summaries
      .flat()
      .sort((a, b) => {
        const timeA = a.processedAt ? Date.parse(a.processedAt) : 0;
        const timeB = b.processedAt ? Date.parse(b.processedAt) : 0;
        return timeB - timeA;
      });
  });

  app.get<{ Params: { deviceId: string; batchId: string } }>("/v1/batches/:deviceId/:batchId", async (req, rep) => {
    const user = await requireUser(req);
    rateLimitOrThrow(`batches:detail:${user.uid}`, 60, 60_000);
    const { deviceId, batchId } = req.params;
    rateLimitOrThrow(`batches:detail:device:${deviceId}`, 120, 60_000);
    rateLimitOrThrow("batches:detail:global", 1_000, 60_000);

    const devRef = db().collection("devices").doc(deviceId);
    const devSnap = await devRef.get();
    if (!devSnap.exists) {
      return rep.code(404).send({ error: "not_found", message: "Device not found." });
    }

    const ownerUserId = devSnap.get("ownerUserId");
    const ownerUserIds = devSnap.get("ownerUserIds");
    const ownerList = Array.isArray(ownerUserIds)
      ? ownerUserIds.filter((id): id is string => typeof id === "string" && id.length > 0)
      : [];
    const isOwner = ownerUserId === user.uid || ownerList.includes(user.uid);
    if (!isOwner) {
      return rep.code(403).send({ error: "forbidden", message: "You do not have access to this device." });
    }

    const batchRef = devRef.collection("batches").doc(batchId);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) {
      return rep.code(404).send({ error: "not_found", message: "Batch not found." });
    }
    const batchData = batchSnap.data() as { path?: unknown; count?: unknown; processedAt?: unknown; visibility?: unknown } | undefined;
    const path = typeof batchData?.path === "string" ? batchData.path : null;
    if (!path) {
      return rep.code(404).send({ error: "not_found", message: "Batch payload unavailable." });
    }

    let points: IngestBatch["points"];
    try {
      const [buf] = await bucket().file(path).download();
      const parsed = IngestBatchSchema.safeParse(JSON.parse(buf.toString("utf8")));
      if (!parsed.success) {
        app.log.error({ batchId, deviceId, issues: parsed.error.flatten() }, "invalid batch payload");
        return rep.code(500).send({ error: "invalid_batch", message: "Stored batch payload is invalid." });
      }
      points = parsed.data.points;
    }
    catch (err) {
      app.log.error({ err, batchId, deviceId }, "failed to read batch payload");
      return rep.code(500).send({ error: "storage_error", message: "Unable to read batch payload." });
    }

    const processedAt = normaliseTimestamp(batchData?.processedAt);
    const count = typeof batchData?.count === "number" ? batchData.count : points.length;
    const visibility = normalizeBatchVisibility(batchData?.visibility) ?? DEFAULT_BATCH_VISIBILITY;

    const response: BatchDetail = {
      batchId,
      deviceId,
      deviceName: typeof devSnap.get("name") === "string" ? devSnap.get("name") : null,
      count,
      processedAt,
      points,
      visibility,
    };
    return response;
  });
};
