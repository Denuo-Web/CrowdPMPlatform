import { onMessagePublished } from "firebase-functions/v2/pubsub";
import type { firestore } from "firebase-admin";
import { bucket, db, hourBucket } from "../lib/fire.js";
import { IngestBatch } from "../lib/validation.js";
import { ingestTopicParam } from "../lib/runtimeConfig.js";
import {
  DEFAULT_BATCH_VISIBILITY,
  getDeviceDefaultBatchVisibility,
  normalizeBatchVisibility,
} from "../lib/batchVisibility.js";

export const ingestWorker = onMessagePublished(
  {
    // Allow the runtime to resolve the topic param lazily without calling `.value()` during deploys.
    topic: ingestTopicParam as unknown as string,
  },
  async (event) => {
    const msg = event.data.message.json as { deviceId: string; batchId: string; path: string; visibility?: string };
    const providedVisibility = normalizeBatchVisibility(msg.visibility);
    const devRef = db().collection("devices").doc(msg.deviceId);
    let devSnap: firestore.DocumentSnapshot | null = null;

    const resolveVisibility = async (): Promise<string> => {
      if (providedVisibility) return providedVisibility;
      if (!devSnap) {
        try {
          devSnap = await devRef.get();
        }
        catch (err) {
          console.warn({ err, deviceId: msg.deviceId }, "failed to load device for visibility");
          return DEFAULT_BATCH_VISIBILITY;
        }
      }
      const fallback = await getDeviceDefaultBatchVisibility(devSnap);
      return fallback ?? DEFAULT_BATCH_VISIBILITY;
    };

    const markFailed = async (reason: string) => {
      const visibility = await resolveVisibility();
      try {
        await devRef.collection("batches").doc(msg.batchId)
          .set({ path: msg.path, count: 0, processedAt: new Date(), visibility, error: reason }, { merge: true });
      }
      catch (err) {
        console.error({ err, deviceId: msg.deviceId, batchId: msg.batchId }, "failed to mark batch as failed");
      }
    };

    let parsedBatch: IngestBatch;
    try {
      const [buf] = await bucket().file(msg.path).download();
      const parsed = IngestBatch.safeParse(JSON.parse(buf.toString("utf8")));
      if (!parsed.success) {
        console.warn({ issues: parsed.error.flatten(), deviceId: msg.deviceId, batchId: msg.batchId }, "invalid ingest payload for batch");
        await markFailed("invalid ingest payload");
        return;
      }
      parsedBatch = parsed.data;
    }
    catch (err) {
      console.warn({ err, deviceId: msg.deviceId, batchId: msg.batchId }, "failed to load batch payload");
      await markFailed("failed to load batch payload");
      return;
    }

    devSnap = devSnap ?? await devRef.get();
    const calib = (devSnap.exists && devSnap.get("calibration")) || {};

    const pts = parsedBatch.points.filter(p => p.device_id === msg.deviceId);
    for (let i = 0; i < pts.length; i += 400) {
      const chunk = pts.slice(i, i + 400);
      const batch = db().batch();
      for (const p of chunk) {
        const ts = new Date(p.timestamp);
        const b = hourBucket(ts);
        const ref = devRef.collection("measures").doc(b).collection("rows").doc();
        const value = typeof calib.pm25_scale === "number"
          ? p.value * calib.pm25_scale + (calib.pm25_offset || 0) : p.value;
        batch.set(ref, {
          deviceId: p.device_id, pollutant: p.pollutant, value,
          unit: p.unit, lat: p.lat, lon: p.lon,
          altitude: p.altitude ?? null, precision: p.precision ?? null,
          timestamp: ts, flags: p.flags ?? 0
        });
      }
      await batch.commit();
    }
    const fallbackVisibility = providedVisibility ? null : await getDeviceDefaultBatchVisibility(devSnap);
    const visibility = providedVisibility ?? fallbackVisibility ?? DEFAULT_BATCH_VISIBILITY;
    await devRef.collection("batches").doc(msg.batchId)
      .set({ path: msg.path, count: pts.length, processedAt: new Date(), visibility }, { merge: true });
  }
);
