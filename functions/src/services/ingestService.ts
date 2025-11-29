import { PubSub } from "@google-cloud/pubsub";
import type { Firestore } from "firebase-admin/firestore";
import type { BatchVisibility, IngestBody as SharedIngestBody, IngestResult, IngestPoint } from "@crowdpm/types";
import crypto from "node:crypto";
import {
  DEFAULT_BATCH_VISIBILITY,
  getDeviceDefaultBatchVisibility,
} from "../lib/batchVisibility.js";
import { bucket as getBucket, db as getDb } from "../lib/fire.js";
import { getIngestTopic } from "../lib/runtimeConfig.js";
import { normalizeVisibility } from "../lib/httpValidation.js";
import { IngestPayload } from "../lib/validation.js";
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
    const { parsedBody, canonicalRawBody } = this.normalizeIngestPayload(request.rawBody);
    const payloadDeviceId = parsedBody.device_id || parsedBody.points?.[0]?.device_id;
    const deviceId = request.deviceId || payloadDeviceId;
    if (!deviceId) {
      throw new IngestServiceError("MISSING_DEVICE_ID", "missing device_id", 400);
    }
    if (payloadDeviceId && payloadDeviceId !== deviceId) {
      throw new IngestServiceError("INVALID_PAYLOAD", "device_id mismatch between payload and request", 400);
    }

    const devRef = this.deps.db.collection("devices").doc(deviceId);
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
    await this.deps.bucket.file(path).save(canonicalRawBody, { contentType: "application/json" });

    const topicName = this.resolveIngestTopic();
    await this.ensureTopicExists(topicName);
    await this.deps.pubsub.topic(topicName).publishMessage({ json: { deviceId, batchId, path, visibility } });

    const matchingPointCount = parsedBody.points.filter((point: IngestPoint) => point.device_id === deviceId).length;
    await devRef.collection("batches").doc(batchId).set({
      path,
      count: matchingPointCount,
      processedAt: null,
      visibility,
    }, { merge: true });

    await this.deps.updateDeviceLastSeen(deviceId, this.deps.db).catch((err) => {
      console.error({ err, deviceId }, "failed to update device last seen");
    });

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
