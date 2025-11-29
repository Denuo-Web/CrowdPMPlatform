import { PubSub } from "@google-cloud/pubsub";
import type { Firestore } from "firebase-admin/firestore";
import crypto from "node:crypto";
import {
  DEFAULT_BATCH_VISIBILITY,
  getDeviceDefaultBatchVisibility,
  normalizeBatchVisibility,
  type BatchVisibility,
} from "../lib/batchVisibility.js";
import { bucket as getBucket, db as getDb } from "../lib/fire.js";
import { getIngestTopic } from "../lib/runtimeConfig.js";
import { updateDeviceLastSeen } from "./deviceRegistry.js";

export type IngestPoint = {
  device_id: string;
  pollutant: string;
  value: number;
  unit?: string;
  lat?: number;
  lon?: number;
  altitude?: number | null;
  precision?: number | null;
  timestamp: string;
  flags?: number;
};

export type IngestBody = {
  device_id?: string;
  points?: IngestPoint[];
};

export type IngestRequest = {
  rawBody: string;
  body: IngestBody;
  deviceId: string;
  visibility?: BatchVisibility | null;
};

export type IngestResult = {
  accepted: true;
  batchId: string;
  deviceId: string;
  storagePath: string;
  visibility: BatchVisibility;
};

export type IngestErrorReason = "MISSING_DEVICE_ID" | "DEVICE_FORBIDDEN";

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
  pubsub: PubSub;
  bucket: StorageBucket;
  db: Firestore;
  resolveTopicName: () => string;
  isEmulatorPubSub: () => boolean;
  updateDeviceLastSeen: (deviceId: string, targetDb: Firestore) => Promise<void>;
};

export type IngestServiceDependencies = Partial<Omit<ResolvedIngestDependencies, "resolveTopicName" | "isEmulatorPubSub" | "updateDeviceLastSeen">> & {
  resolveTopicName?: () => string;
  isEmulatorPubSub?: () => boolean;
  updateDeviceLastSeen?: (deviceId: string, targetDb: Firestore) => Promise<void>;
};

function defaultIsEmulatorPubSub(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" || Boolean(process.env.PUBSUB_EMULATOR_HOST);
}

function isAlreadyExistsError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = Number((err as { code?: unknown }).code);
  return code === 6 || code === 409;
}

export class IngestService {
  private readonly deps: ResolvedIngestDependencies;
  private topicName: string | null = null;
  private readonly ensuredTopics = new Map<string, Promise<void>>();

  constructor(deps: IngestServiceDependencies) {
    this.deps = {
      pubsub: deps.pubsub ?? new PubSub(),
      bucket: deps.bucket ?? getBucket(),
      db: deps.db ?? getDb(),
      resolveTopicName: deps.resolveTopicName ?? getIngestTopic,
      isEmulatorPubSub: deps.isEmulatorPubSub ?? defaultIsEmulatorPubSub,
      updateDeviceLastSeen: deps.updateDeviceLastSeen ?? updateDeviceLastSeen,
    };
  }

  async ingest(request: IngestRequest): Promise<IngestResult> {
    const deviceId = request.deviceId || request.body.points?.[0]?.device_id || request.body.device_id;
    if (!deviceId) {
      throw new IngestServiceError("MISSING_DEVICE_ID", "missing device_id", 400);
    }

    const devRef = this.deps.db.collection("devices").doc(deviceId);
    const devSnap = await devRef.get();
    const status = typeof devSnap.get("status") === "string" ? String(devSnap.get("status")).toUpperCase() : null;
    const registryStatus = typeof devSnap.get("registryStatus") === "string" ? String(devSnap.get("registryStatus")).toLowerCase() : null;
    const forbidden = registryStatus === "revoked" || registryStatus === "suspended" || status === "SUSPENDED" || status === "REVOKED";
    if (!devSnap.exists || forbidden) {
      throw new IngestServiceError("DEVICE_FORBIDDEN", "device not allowed", 403);
    }

    const requestedVisibility = normalizeBatchVisibility(request.visibility);
    const ownerDefaultVisibility = await getDeviceDefaultBatchVisibility(devSnap);
    const visibility = requestedVisibility ?? ownerDefaultVisibility ?? DEFAULT_BATCH_VISIBILITY;

    const batchId = crypto.randomUUID();
    const path = `ingest/${deviceId}/${batchId}.json`;
    await this.deps.bucket.file(path).save(request.rawBody, { contentType: "application/json" });

    const topicName = this.resolveIngestTopic();
    await this.ensureTopicExists(topicName);
    await this.deps.pubsub.topic(topicName).publishMessage({ json: { deviceId, batchId, path, visibility } });

    const matchingPointCount = Array.isArray(request.body.points)
      ? request.body.points.filter((point) => point.device_id === deviceId).length
      : 0;
    await devRef.collection("batches").doc(batchId).set({
      path,
      count: matchingPointCount,
      processedAt: null,
      visibility,
    }, { merge: true });

    await this.deps.updateDeviceLastSeen(deviceId, this.deps.db).catch(() => {});

    return { accepted: true, batchId, deviceId, storagePath: path, visibility };
  }

  private resolveIngestTopic(): string {
    if (!this.topicName) {
      this.topicName = this.deps.resolveTopicName();
    }
    return this.topicName;
  }

  private async ensureTopicExists(topicName: string): Promise<void> {
    if (!this.deps.isEmulatorPubSub()) return;
    if (!this.ensuredTopics.has(topicName)) {
      const ensurePromise = (async () => {
        const topic = this.deps.pubsub.topic(topicName);
        const [exists] = await topic.exists();
        if (exists) return;
        try {
          await this.deps.pubsub.createTopic(topicName);
        }
        catch (err) {
          if (!isAlreadyExistsError(err)) throw err;
        }
      })().catch((err) => {
        this.ensuredTopics.delete(topicName);
        throw err;
      });
      this.ensuredTopics.set(topicName, ensurePromise);
    }
    const pending = this.ensuredTopics.get(topicName);
    if (pending) await pending;
  }
}

export function createIngestService(overrides?: IngestServiceDependencies): IngestService {
  return new IngestService(overrides ?? {});
}

export const ingestService = createIngestService();
