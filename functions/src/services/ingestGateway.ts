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
type IngestBody = {
  device_id?: string;
  points?: IngestPoint[];
};

function pickFirstQueryParam(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === "string");
  return undefined;
}

export const ingestGateway = onRequest({ cors: true }, async (req, res) => {
  const requestWithRawBody = req as RequestWithRawBody;
  const rawBody = requestWithRawBody.rawBody;
  const raw = typeof rawBody === "string"
    ? rawBody
    : rawBody?.toString() ?? JSON.stringify(req.body ?? {});
  try { verifyHmac(raw, req.header("x-signature") || undefined); }
  catch { res.status(401).send("unauthorized"); return; }

  const body = (req.body ?? {}) as IngestBody;
  const deviceId = pickFirstQueryParam(req.query["device_id"]) || body.points?.[0]?.device_id || body.device_id;
  if (!deviceId) { res.status(400).send("missing device_id"); return; }

  const dev = await db().collection("devices").doc(deviceId).get();
  if (!dev.exists || dev.get("status") === "SUSPENDED") { res.status(403).send("device not allowed"); return; }

  const batchId = crypto.randomUUID();
  const path = `ingest/${deviceId}/${batchId}.json`;
  await bucket().file(path).save(raw, { contentType: "application/json" });
  await pubsub.topic(TOPIC).publishMessage({ json: { deviceId, batchId, path } });

  res.status(202).json({ accepted: true, batchId });
});
