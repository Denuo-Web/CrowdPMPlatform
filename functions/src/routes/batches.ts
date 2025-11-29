import type { FastifyPluginAsync } from "fastify";
import { bucket } from "../lib/fire.js";
import { IngestBatch as IngestBatchSchema } from "../lib/validation.js";
import type { IngestBatch } from "../lib/validation.js";
import { type BatchVisibility } from "../lib/batchVisibility.js";
import { loadOwnedDeviceDocs } from "../lib/deviceOwnership.js";
import { timestampToMillis } from "../lib/time.js";
import { httpError } from "../lib/httpError.js";
import { normalizeTimestamp, normalizeVisibility } from "../lib/httpValidation.js";
import {
  getRequestUser,
  requestParam,
  rateLimitGuard,
  requireDeviceOwnerGuard,
  requireUserGuard,
  requestUserId,
} from "../lib/routeGuards.js";

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

export const batchesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/batches", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `batches:list:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard("batches:list:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const user = getRequestUser(req);
    const { collection: devices, docs: seen } = await loadOwnedDeviceDocs(user.uid);

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
          const processedAt = normalizeTimestamp(data?.processedAt);
          const visibility = normalizeVisibility(data?.visibility);
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
        const timeA = timestampToMillis(a.processedAt) ?? 0;
        const timeB = timestampToMillis(b.processedAt) ?? 0;
        return timeB - timeA;
      });
  });

  app.get<{ Params: { deviceId: string; batchId: string } }>("/v1/batches/:deviceId/:batchId", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `batches:detail:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard((req) => `batches:detail:device:${requestParam(req, "deviceId")}`, 120, 60_000),
      rateLimitGuard("batches:detail:global", 1_000, 60_000),
      requireDeviceOwnerGuard((req) => requestParam(req, "deviceId")),
    ],
  }, async (req) => {
    const { deviceId, batchId } = req.params;
    const devSnap = req.deviceDoc;
    if (!devSnap) throw httpError(404, "not_found", "Device not found.");

    const batchRef = devSnap.ref.collection("batches").doc(batchId);
    const batchSnap = await batchRef.get();
    if (!batchSnap.exists) {
      throw httpError(404, "not_found", "Batch not found.");
    }
    const batchData = batchSnap.data() as { path?: unknown; count?: unknown; processedAt?: unknown; visibility?: unknown } | undefined;
    const path = typeof batchData?.path === "string" ? batchData.path : null;
    if (!path) {
      throw httpError(404, "not_found", "Batch payload unavailable.");
    }

    let points: IngestBatch["points"];
    try {
      const [buf] = await bucket().file(path).download();
      const parsed = IngestBatchSchema.safeParse(JSON.parse(buf.toString("utf8")));
      if (!parsed.success) {
        app.log.error({ batchId, deviceId, issues: parsed.error.flatten() }, "invalid batch payload");
        throw httpError(500, "invalid_batch", "Stored batch payload is invalid.");
      }
      points = parsed.data.points;
    }
    catch (err) {
      app.log.error({ err, batchId, deviceId }, "failed to read batch payload");
      throw httpError(500, "storage_error", "Unable to read batch payload.");
    }

    const processedAt = normalizeTimestamp(batchData?.processedAt);
    const count = typeof batchData?.count === "number" ? batchData.count : points.length;
    const visibility = normalizeVisibility(batchData?.visibility);

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
