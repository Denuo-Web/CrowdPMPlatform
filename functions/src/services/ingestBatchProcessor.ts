import type { firestore } from "firebase-admin";
import type { BatchVisibility } from "@crowdpm/types";
import {
  DEFAULT_BATCH_VISIBILITY,
  getDeviceDefaultBatchVisibility,
  normalizeBatchVisibility,
} from "../lib/batchVisibility.js";
import { bucket, db, hourBucket } from "../lib/fire.js";
import { toDate } from "../lib/time.js";
import { IngestBatch } from "../lib/validation.js";

export type ProcessIngestBatchRequest = {
  deviceId: string;
  batchId: string;
  path: string;
  visibility?: unknown;
  payload?: unknown;
};

export type ProcessIngestBatchResult = {
  count: number;
  visibility: BatchVisibility;
};

function parseBatch(input: unknown) {
  const parsed = IngestBatch.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export async function processIngestBatch(request: ProcessIngestBatchRequest): Promise<ProcessIngestBatchResult> {
  const devRef = db().collection("devices").doc(request.deviceId);
  let devSnap: firestore.DocumentSnapshot | null = null;
  const providedVisibility = normalizeBatchVisibility(request.visibility);

  const resolveVisibility = async (): Promise<BatchVisibility> => {
    if (providedVisibility) return providedVisibility;
    if (!devSnap) {
      try {
        devSnap = await devRef.get();
      }
      catch (err) {
        console.warn({ err, deviceId: request.deviceId }, "failed to load device for visibility");
        return DEFAULT_BATCH_VISIBILITY;
      }
    }
    const fallback = await getDeviceDefaultBatchVisibility(devSnap);
    return fallback ?? DEFAULT_BATCH_VISIBILITY;
  };

  const markFailed = async (reason: string): Promise<ProcessIngestBatchResult> => {
    const visibility = await resolveVisibility();
    try {
      await devRef.collection("batches").doc(request.batchId).set(
        {
          path: request.path,
          count: 0,
          processedAt: new Date(),
          visibility,
          error: reason,
        },
        { merge: true }
      );
    }
    catch (err) {
      console.error({ err, deviceId: request.deviceId, batchId: request.batchId }, "failed to mark batch as failed");
    }
    return { count: 0, visibility };
  };

  let parsedBatch = request.payload ? parseBatch(request.payload) : null;
  if (!parsedBatch) {
    try {
      const [buf] = await bucket().file(request.path).download();
      parsedBatch = parseBatch(JSON.parse(buf.toString("utf8")));
      if (!parsedBatch) {
        console.warn({ deviceId: request.deviceId, batchId: request.batchId }, "invalid ingest payload for batch");
        return markFailed("invalid ingest payload");
      }
    }
    catch (err) {
      console.warn({ err, deviceId: request.deviceId, batchId: request.batchId }, "failed to load batch payload");
      return markFailed("failed to load batch payload");
    }
  }

  devSnap = devSnap ?? await devRef.get();
  const calib = (devSnap.exists && devSnap.get("calibration")) || {};

  const pts = parsedBatch.points.filter((point) => point.device_id === request.deviceId);
  for (let i = 0; i < pts.length; i += 400) {
    const chunk = pts.slice(i, i + 400);
    const batch = db().batch();
    for (const point of chunk) {
      const ts = toDate(point.timestamp);
      if (!ts) {
        continue;
      }
      const bucketId = hourBucket(ts);
      const ref = devRef.collection("measures").doc(bucketId).collection("rows").doc();
      const value = typeof calib.pm25_scale === "number"
        ? point.value * calib.pm25_scale + (calib.pm25_offset || 0)
        : point.value;
      batch.set(ref, {
        deviceId: point.device_id,
        pollutant: point.pollutant,
        value,
        unit: point.unit,
        lat: point.lat,
        lon: point.lon,
        altitude: point.altitude ?? null,
        precision: point.precision ?? null,
        timestamp: ts,
        flags: point.flags ?? 0,
      });
    }
    await batch.commit();
  }

  const fallbackVisibility = providedVisibility ? null : await getDeviceDefaultBatchVisibility(devSnap);
  const visibility = providedVisibility ?? fallbackVisibility ?? DEFAULT_BATCH_VISIBILITY;
  await devRef.collection("batches").doc(request.batchId).set(
    {
      path: request.path,
      count: pts.length,
      processedAt: new Date(),
      visibility,
    },
    { merge: true }
  );

  return { count: pts.length, visibility };
}
