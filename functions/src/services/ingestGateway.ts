import { onRequest } from "firebase-functions/v2/https";
import { PubSub } from "@google-cloud/pubsub";
import crypto from "node:crypto";
import { bucket, db } from "../lib/fire.js";
import { verifyHmac } from "../lib/crypto.js";
import type { Request } from "firebase-functions/v2/https";

const pubsub = new PubSub();
const TOPIC = process.env.INGEST_TOPIC || "ingest.raw";

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
  signature?: string;
  deviceId?: string;
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

export async function ingestPayload(raw: string, body: IngestBody, options: IngestOptions = {}) {
  const { signature, deviceId: deviceIdOverride } = options;
  verifyHmac(raw, signature);

  const deviceId = deviceIdOverride || body.points?.[0]?.device_id || body.device_id;
  if (!deviceId) throw HTTPError(400, "missing device_id");

  const dev = await db().collection("devices").doc(deviceId).get();
  if (!dev.exists || dev.get("status") === "SUSPENDED") throw HTTPError(403, "device not allowed");

  const batchId = crypto.randomUUID();
  const path = `ingest/${deviceId}/${batchId}.json`;
  await bucket().file(path).save(raw, { contentType: "application/json" });
  await pubsub.topic(TOPIC).publishMessage({ json: { deviceId, batchId, path } });

  return { accepted: true, batchId, deviceId, storagePath: path };
}

export const ingestGateway = onRequest({ cors: true }, async (req, res) => {
  const requestWithRawBody = req as RequestWithRawBody;
  const rawBody = requestWithRawBody.rawBody;
  const raw = typeof rawBody === "string"
    ? rawBody
    : rawBody?.toString() ?? JSON.stringify(req.body ?? {});
  const body = (req.body ?? {}) as IngestBody;
  try {
    const result = await ingestPayload(raw, body, {
      signature: req.header("x-signature") || undefined,
      deviceId: pickFirstQueryParam(req.query["device_id"]),
    });
    res.status(202).json(result);
  }
  catch (err) {
    const statusCode = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
    const message = err instanceof Error ? err.message : "unexpected error";
    res.status(statusCode && statusCode >= 100 ? statusCode : 500).send(message);
  }
});
