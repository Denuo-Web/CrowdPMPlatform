import { onRequest } from "firebase-functions/v2/https";
import { deviceTokenPrivateKeySecret } from "../lib/runtimeConfig.js";
import type { Request } from "firebase-functions/v2/https";
import { normalizeBatchVisibility } from "../lib/batchVisibility.js";
import { verifyDeviceAccessToken } from "./deviceTokens.js";
import { verifyDpopProof } from "../lib/dpop.js";
import { canonicalRequestUrl } from "../lib/http.js";
import { ingestService, IngestServiceError, type IngestBody } from "./ingestService.js";

type RequestWithRawBody = Request & { rawBody?: Buffer | string };

const HTTPError = (statusCode: number, message: string) => {
  const error = Object.assign(new Error(message), { statusCode });
  return error;
};

function pickFirstQueryParam(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === "string");
  return undefined;
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

    const result = await ingestService.ingest({
      rawBody: raw,
      body,
      deviceId: deviceIdFromToken,
      visibility: normalizeBatchVisibility(
        pickFirstQueryParam(req.query["visibility"]) ?? req.header("x-batch-visibility")
      ),
    });
    res.status(202).json(result);
  }
  catch (err) {
    const statusCode = extractStatusCode(err);
    const message = err instanceof Error ? err.message : "unexpected error";
    res.status(statusCode).send(message);
  }
});

function extractStatusCode(err: unknown): number {
  if (err instanceof IngestServiceError) return err.statusCode;
  const statusCode = typeof err === "object" && err && "statusCode" in err ? Number((err as { statusCode: unknown }).statusCode) : undefined;
  if (statusCode && statusCode >= 100) return statusCode;
  return 500;
}
