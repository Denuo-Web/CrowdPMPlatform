import { onRequest } from "firebase-functions/v2/https";
import { PubSub } from "@google-cloud/pubsub";
import crypto from "node:crypto";
import { bucket, db } from "../lib/fire.js";
import { deviceTokenPrivateKeySecret, getIngestTopic } from "../lib/runtimeConfig.js";
import type { Request } from "firebase-functions/v2/https";
import {
  DEFAULT_BATCH_VISIBILITY,
  getDeviceDefaultBatchVisibility,
  normalizeBatchVisibility,
  type BatchVisibility,
} from "../lib/batchVisibility.js";
import { verifyDeviceAccessToken } from "./deviceTokens.js";
import { verifyDpopProof } from "../lib/dpop.js";
import { canonicalRequestUrl } from "../lib/http.js";
import { getDevice, updateDeviceLastSeen } from "./deviceRegistry.js";

const pubsub = new PubSub();
const TOPIC = getIngestTopic();

type RequestWithRawBody = Request & { rawBody?: Buffer | string };
type IngestPoint = {
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

type IngestOptions = {
  deviceId: string;
  visibility?: BatchVisibility | null;
};

const HTTPError = (statusCode: number, message: string) => {
  const error = Object.assign(new Error(message), { statusCode });
  return error;
};

function pickFirstQueryParam(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === "string");
  return undefined;
}

export async function ingestPayload(raw: string, body: IngestBody, options: IngestOptions) {
  const deviceId = options.deviceId || body.points?.[0]?.device_id || body.device_id;
  if (!deviceId) throw HTTPError(400, "missing device_id");

  const dev = await db().collection("devices").doc(deviceId).get();
  if (!dev.exists || dev.get("status") === "SUSPENDED") throw HTTPError(403, "device not allowed");
  const requestedVisibility = normalizeBatchVisibility(options.visibility);
  const ownerDefaultVisibility = await getDeviceDefaultBatchVisibility(dev);
  const visibility = requestedVisibility ?? ownerDefaultVisibility ?? DEFAULT_BATCH_VISIBILITY;

  const batchId = crypto.randomUUID();
  const path = `ingest/${deviceId}/${batchId}.json`;
  await bucket().file(path).save(raw, { contentType: "application/json" });
  await pubsub.topic(TOPIC).publishMessage({ json: { deviceId, batchId, path, visibility } });

  await updateDeviceLastSeen(deviceId).catch(() => {});

  return { accepted: true, batchId, deviceId, storagePath: path, visibility };
}

export const ingestGateway = onRequest({ cors: true, secrets: [deviceTokenPrivateKeySecret] }, async (req, res) => {
  const requestWithRawBody = req as RequestWithRawBody;
  const rawBody = requestWithRawBody.rawBody;
  const raw = typeof rawBody === "string"
    ? rawBody
    : rawBody?.toString() ?? JSON.stringify(req.body ?? {});
  const body = (req.body ?? {}) as IngestBody;
  try {
    const authHeader = req.get("authorization") || req.header("authorization") || "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      res.status(401).send("missing bearer token");
      return;
    }
    const token = authHeader.slice(7).trim();
    const accessToken = await verifyDeviceAccessToken(token);
    const htu = canonicalRequestUrl(req.url, req.headers);
    const dpopProof = req.get("dpop") || req.header("dpop");
    const verifiedProof = await verifyDpopProof(dpopProof, {
      method: req.method.toUpperCase(),
      htu,
      expectedThumbprint: accessToken.cnf.jkt,
    });
    if (verifiedProof.thumbprint !== accessToken.cnf.jkt) {
      throw HTTPError(401, "DPoP key mismatch");
    }

    const deviceIdFromToken = accessToken.device_id;
    const payloadDeviceId = body.points?.[0]?.device_id || body.device_id;
    if (payloadDeviceId && payloadDeviceId !== deviceIdFromToken) {
      throw HTTPError(400, "device_id mismatch between payload and token");
    }

    const deviceRecord = await getDevice(deviceIdFromToken);
    if (!deviceRecord || deviceRecord.registryStatus !== "active" || deviceRecord.status === "SUSPENDED" || deviceRecord.status === "REVOKED") {
      throw HTTPError(403, "device not allowed");
    }

    const result = await ingestPayload(raw, body, {
      deviceId: deviceIdFromToken,
      visibility: normalizeBatchVisibility(
        pickFirstQueryParam(req.query["visibility"]) ?? req.header("x-batch-visibility")
      ) ?? undefined,
    });
    res.status(202).json(result);
  }
  catch (err) {
    const statusCode = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
    const message = err instanceof Error ? err.message : "unexpected error";
    res.status(statusCode && statusCode >= 100 ? statusCode : 500).send(message);
  }
});
