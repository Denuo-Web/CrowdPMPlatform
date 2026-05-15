import type { Firestore } from "firebase-admin/firestore";
import type { BatchVisibility, IngestBody as SharedIngestBody, IngestResult } from "@crowdpm/types";
import crypto from "node:crypto";
import {
  getDeviceDefaultBatchVisibility,
} from "../lib/batchVisibility.js";
import { normalizeOwnerIds, primaryOwnerUserId } from "../lib/deviceOwnership.js";
import { bucket as getBucket, db as getDb } from "../lib/fire.js";
import { normalizeVisibility } from "../lib/httpValidation.js";
import { IngestPayload } from "../lib/validation.js";
import { processIngestBatch } from "./ingestBatchProcessor.js";
import { updateDeviceLastSeen } from "./deviceRegistry.js";
import { buildBatchStoragePath, encodeBatchPayload } from "./batchPayloads.js";
import {
  defaultBatchVisibilityForSubscription,
  getSubscriptionSummary,
  reserveUploadQuota,
  rollbackUploadQuotaReservation,
  type UploadQuotaReservation,
} from "./accountEntitlements.js";

export type IngestBody = SharedIngestBody;

export type IngestRequest = {
  rawBody: string;
  body: IngestBody;
  deviceId: string;
  visibility?: BatchVisibility | null;
};

export type IngestErrorReason = "missing_device_id" | "device_forbidden" | "invalid_payload";

export class IngestServiceError extends Error {
  readonly statusCode: number;
  readonly reason: IngestErrorReason;

  constructor(reason: IngestErrorReason, message: string, statusCode: number) {
    super(message);
    this.reason = reason;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, IngestServiceError.prototype);
  }
}

type StorageBucket = ReturnType<typeof getBucket>;

type ResolvedIngestDependencies = {
  getBucket: () => StorageBucket;
  getDb: () => Firestore;
  processIngestBatch: typeof processIngestBatch;
  updateDeviceLastSeen: (deviceId: string, targetDb: Firestore) => Promise<void>;
  getSubscriptionSummary: typeof getSubscriptionSummary;
  reserveUploadQuota: typeof reserveUploadQuota;
  rollbackUploadQuotaReservation: typeof rollbackUploadQuotaReservation;
};

export type IngestServiceDependencies = {
  bucket?: StorageBucket;
  db?: Firestore;
  processIngestBatch?: typeof processIngestBatch;
  updateDeviceLastSeen?: (deviceId: string, targetDb: Firestore) => Promise<void>;
  getSubscriptionSummary?: typeof getSubscriptionSummary;
  reserveUploadQuota?: typeof reserveUploadQuota;
  rollbackUploadQuotaReservation?: typeof rollbackUploadQuotaReservation;
};

function normalizeStatus(value: unknown, transform: (value: string) => string): string | null {
  return typeof value === "string" ? transform(value) : null;
}

function isForbiddenDevice(status: string | null, registryStatus: string | null): boolean {
  const normalizedStatus = status ?? "";
  const normalizedRegistryStatus = registryStatus ?? "";
  return normalizedRegistryStatus === "revoked"
    || normalizedRegistryStatus === "suspended"
    || normalizedStatus === "SUSPENDED"
    || normalizedStatus === "REVOKED";
}

export class IngestService {
  private readonly deps: ResolvedIngestDependencies;

  constructor(deps: IngestServiceDependencies) {
    const configuredBucket = deps.bucket;
    const configuredDb = deps.db;
    const getBucketDep = configuredBucket ? () => configuredBucket : () => getBucket();
    const getDbDep = configuredDb ? () => configuredDb : () => getDb();
    this.deps = {
      getBucket: getBucketDep,
      getDb: getDbDep,
      processIngestBatch: deps.processIngestBatch ?? processIngestBatch,
      updateDeviceLastSeen: deps.updateDeviceLastSeen ?? updateDeviceLastSeen,
      getSubscriptionSummary: deps.getSubscriptionSummary ?? getSubscriptionSummary,
      reserveUploadQuota: deps.reserveUploadQuota ?? reserveUploadQuota,
      rollbackUploadQuotaReservation: deps.rollbackUploadQuotaReservation ?? rollbackUploadQuotaReservation,
    };
  }

  async ingest(request: IngestRequest): Promise<IngestResult> {
    const db = this.deps.getDb();
    const bucket = this.deps.getBucket();
    const parsedBody = this.normalizeIngestPayload(request.rawBody);
    const payloadDeviceId = parsedBody.device_id || parsedBody.points?.[0]?.device_id;
    const deviceId = request.deviceId || payloadDeviceId;
    if (!deviceId) {
      throw new IngestServiceError("missing_device_id", "missing device_id", 400);
    }
    if (payloadDeviceId && payloadDeviceId !== deviceId) {
      throw new IngestServiceError("invalid_payload", "device_id mismatch between payload and request", 400);
    }

    const devRef = db.collection("devices").doc(deviceId);
    const devSnap = await devRef.get();
    if (!devSnap.exists) {
      throw new IngestServiceError("device_forbidden", "device not allowed", 403);
    }
    const devData = devSnap.data() ?? {};
    const status = normalizeStatus(devSnap.get("status"), (value) => value.toUpperCase());
    const registryStatus = normalizeStatus(devSnap.get("registryStatus"), (value) => value.toLowerCase());
    if (isForbiddenDevice(status, registryStatus)) {
      throw new IngestServiceError("device_forbidden", "device not allowed", 403);
    }
    const ownerUserIds = normalizeOwnerIds(devData);
    const effectiveOwnerUserIds = ownerUserIds;
    const ownerUserId = primaryOwnerUserId(devData);
    if (!ownerUserId || !effectiveOwnerUserIds.length) {
      throw new IngestServiceError("device_forbidden", "device owner unavailable", 403);
    }

    const mismatchedPoint = parsedBody.points.find((point) => point.device_id !== deviceId);
    if (mismatchedPoint) {
      throw new IngestServiceError("invalid_payload", "all points must match the device_id in the request", 400);
    }

    const batchId = crypto.randomUUID();
    const ownerSubscription = await this.deps.getSubscriptionSummary(ownerUserId, db);
    const ownerDefaultVisibility = await getDeviceDefaultBatchVisibility(devSnap);
    const visibility = normalizeVisibility(
      request.visibility,
      ownerDefaultVisibility ?? defaultBatchVisibilityForSubscription(ownerSubscription),
    );
    const storagePath = buildBatchStoragePath({ primaryOwnerUserId: ownerUserId, deviceId, batchId });
    const batchPayload = { ...parsedBody, device_id: deviceId };
    const encoded = encodeBatchPayload(batchPayload);
    let reservation: UploadQuotaReservation | null = null;
    let storedPayload = false;
    try {
      reservation = await this.deps.reserveUploadQuota({
        userId: ownerUserId,
        visibility,
        pointCount: batchPayload.points.length,
        targetDb: db,
      });

      await bucket.file(storagePath).save(encoded.buffer, {
        contentType: "application/gzip",
        metadata: {
          metadata: {
            crowdpmSchemaVersion: "2",
            crowdpmContentEncoding: "gzip",
          },
        },
      });
      storedPayload = true;

      const processed = await this.deps.processIngestBatch({
        deviceId,
        batchId,
        storagePath,
        compressedBytes: encoded.buffer.byteLength,
        visibility,
        payload: batchPayload,
        ownerUserIds: effectiveOwnerUserIds,
        deviceName: typeof devSnap.get("name") === "string" && devSnap.get("name").trim().length > 0
          ? devSnap.get("name").trim()
          : null,
      });

      await this.deps.updateDeviceLastSeen(deviceId, db).catch((err) => {
        console.error({ err, deviceId }, "failed to update device last seen");
      });

      return { accepted: true, batchId, deviceId, storagePath, visibility: processed.visibility };
    }
    catch (err) {
      if (storedPayload) {
        await bucket.file(storagePath).delete({ ignoreNotFound: true }).catch((cleanupErr) => {
          console.error({ err: cleanupErr, storagePath }, "failed to clean up stored batch payload after ingest failure");
        });
      }
      if (reservation) {
        await this.deps.rollbackUploadQuotaReservation({
          userId: ownerUserId,
          visibility: reservation.visibility,
          pointCount: reservation.pointCount,
          reservationMonthKey: reservation.monthKey,
          targetDb: db,
        }).catch((rollbackErr) => {
          console.error({ err: rollbackErr, ownerUserId, batchId }, "failed to roll back ingest quota reservation");
        });
      }
      throw err;
    }
  }

  private normalizeIngestPayload(rawBody: string): IngestPayload {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    }
    catch {
      throw new IngestServiceError("invalid_payload", "invalid JSON payload", 400);
    }

    const parsed = IngestPayload.safeParse(parsedJson);
    if (!parsed.success) {
      throw new IngestServiceError("invalid_payload", "invalid ingest payload", 400);
    }

    return parsed.data;
  }
}

export function createIngestService(overrides?: IngestServiceDependencies): IngestService {
  return new IngestService(overrides ?? {});
}

export const ingestService = createIngestService();
