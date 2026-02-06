import type { Firestore } from "firebase-admin/firestore";
import type { BatchVisibility, IngestBody as SharedIngestBody, IngestResult } from "@crowdpm/types";
import crypto from "node:crypto";
import {
  DEFAULT_BATCH_VISIBILITY,
  getDeviceDefaultBatchVisibility,
} from "../lib/batchVisibility.js";
import { bucket as getBucket, db as getDb } from "../lib/fire.js";
import { normalizeVisibility } from "../lib/httpValidation.js";
import { IngestPayload } from "../lib/validation.js";
import { processIngestBatch } from "./ingestBatchProcessor.js";
import { updateDeviceLastSeen } from "./deviceRegistry.js";

export type IngestBody = SharedIngestBody;

export type IngestRequest = {
  rawBody: string;
  body: IngestBody;
  deviceId: string;
  visibility?: BatchVisibility | null;
};

export type IngestErrorReason = "MISSING_DEVICE_ID" | "DEVICE_FORBIDDEN" | "INVALID_PAYLOAD";

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
};

export type IngestServiceDependencies = {
  bucket?: StorageBucket;
  db?: Firestore;
  processIngestBatch?: typeof processIngestBatch;
  updateDeviceLastSeen?: (deviceId: string, targetDb: Firestore) => Promise<void>;
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
    };
  }

  async ingest(request: IngestRequest): Promise<IngestResult> {
    const db = this.deps.getDb();
    const bucket = this.deps.getBucket();
    const { parsedBody, canonicalRawBody } = this.normalizeIngestPayload(request.rawBody);
    const payloadDeviceId = parsedBody.device_id || parsedBody.points?.[0]?.device_id;
    const deviceId = request.deviceId || payloadDeviceId;
    if (!deviceId) {
      throw new IngestServiceError("MISSING_DEVICE_ID", "missing device_id", 400);
    }
    if (payloadDeviceId && payloadDeviceId !== deviceId) {
      throw new IngestServiceError("INVALID_PAYLOAD", "device_id mismatch between payload and request", 400);
    }

    const devRef = db.collection("devices").doc(deviceId);
    const devSnap = await devRef.get();
    if (!devSnap.exists) {
      throw new IngestServiceError("DEVICE_FORBIDDEN", "device not allowed", 403);
    }
    const status = normalizeStatus(devSnap.get("status"), (value) => value.toUpperCase());
    const registryStatus = normalizeStatus(devSnap.get("registryStatus"), (value) => value.toLowerCase());
    if (isForbiddenDevice(status, registryStatus)) {
      throw new IngestServiceError("DEVICE_FORBIDDEN", "device not allowed", 403);
    }

    const ownerDefaultVisibility = await getDeviceDefaultBatchVisibility(devSnap);
    const visibility = normalizeVisibility(request.visibility, ownerDefaultVisibility ?? DEFAULT_BATCH_VISIBILITY);

    const batchId = crypto.randomUUID();
    const path = `ingest/${deviceId}/${batchId}.json`;
    await bucket.file(path).save(canonicalRawBody, { contentType: "application/json" });

    const processed = await this.deps.processIngestBatch({
      deviceId,
      batchId,
      path,
      visibility,
      payload: parsedBody,
    });

    await this.deps.updateDeviceLastSeen(deviceId, db).catch((err) => {
      console.error({ err, deviceId }, "failed to update device last seen");
    });

    return { accepted: true, batchId, deviceId, storagePath: path, visibility: processed.visibility };
  }

  private normalizeIngestPayload(rawBody: string): { parsedBody: IngestPayload; canonicalRawBody: string } {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    }
    catch {
      throw new IngestServiceError("INVALID_PAYLOAD", "invalid JSON payload", 400);
    }

    const parsed = IngestPayload.safeParse(parsedJson);
    if (!parsed.success) {
      throw new IngestServiceError("INVALID_PAYLOAD", "invalid ingest payload", 400);
    }

    return {
      parsedBody: parsed.data,
      canonicalRawBody: JSON.stringify(parsed.data),
    };
  }
}

export function createIngestService(overrides?: IngestServiceDependencies): IngestService {
  return new IngestService(overrides ?? {});
}

export const ingestService = createIngestService();
