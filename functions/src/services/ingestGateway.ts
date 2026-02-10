import { onRequest } from "firebase-functions/v2/https";
import type { Request } from "firebase-functions/v2/https";
import { normalizeBatchVisibility } from "../lib/batchVisibility.js";
import { verifyDeviceAccessToken } from "./deviceTokens.js";
import { verifyDpopProof } from "../lib/dpop.js";
import { canonicalRequestUrl } from "../lib/http.js";
import { ingestService, type IngestBody } from "./ingestService.js";
import { httpError, toHttpError } from "../lib/httpError.js";

type RequestWithRawBody = Request & { rawBody?: Buffer | string };

type GatewayResponse = {
  status(code: number): GatewayResponse;
  json(payload: unknown): void;
  setHeader(name: string, value: string): void;
};

type IngestFn = (request: Parameters<typeof ingestService.ingest>[0]) => ReturnType<typeof ingestService.ingest>;

type IngestGatewayDependencies = {
  verifyDeviceAccessToken: typeof verifyDeviceAccessToken;
  verifyDpopProof: typeof verifyDpopProof;
  ingest: IngestFn;
};

const defaultDependencies: IngestGatewayDependencies = {
  verifyDeviceAccessToken,
  verifyDpopProof,
  ingest: (request) => ingestService.ingest(request),
};

function pickFirstQueryParam(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.find((v): v is string => typeof v === "string");
  return undefined;
}

function requestHeader(req: RequestWithRawBody, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  const fromGet = req.get(lowerName) || req.header(lowerName);
  if (typeof fromGet === "string" && fromGet.trim().length > 0) return fromGet;
  const rawHeader = req.headers[lowerName];
  if (typeof rawHeader === "string") return rawHeader;
  if (Array.isArray(rawHeader)) return rawHeader.find((value): value is string => typeof value === "string");
  return undefined;
}

function normalizeRawBody(req: RequestWithRawBody): string {
  const rawBody = req.rawBody;
  return typeof rawBody === "string"
    ? rawBody
    : rawBody?.toString() ?? JSON.stringify(req.body ?? {});
}

export async function ingestGatewayHandler(
  req: RequestWithRawBody,
  res: GatewayResponse,
  dependencies: IngestGatewayDependencies = defaultDependencies
): Promise<void> {
  const raw = normalizeRawBody(req);
  const body = (req.body ?? {}) as IngestBody;

  try {
    const authHeader = requestHeader(req, "authorization") ?? "";
    if (!authHeader.toLowerCase().startsWith("bearer ")) {
      throw httpError(401, "invalid_request", "missing bearer token");
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      throw httpError(401, "invalid_request", "missing bearer token");
    }

    const accessToken = await dependencies.verifyDeviceAccessToken(token);
    const htu = canonicalRequestUrl(req.url, req.headers);
    const dpopProof = requestHeader(req, "dpop");
    const verifiedProof = await dependencies.verifyDpopProof(dpopProof, {
      method: req.method.toUpperCase(),
      htu,
      expectedThumbprint: accessToken.cnf.jkt,
    });
    if (verifiedProof.thumbprint !== accessToken.cnf.jkt) {
      throw httpError(401, "invalid_token", "DPoP key mismatch");
    }

    const deviceIdFromToken = accessToken.device_id;
    const payloadDeviceId = body.points?.[0]?.device_id || body.device_id;
    if (payloadDeviceId && payloadDeviceId !== deviceIdFromToken) {
      throw httpError(400, "device_id_mismatch", "device_id mismatch between payload and token");
    }

    const result = await dependencies.ingest({
      rawBody: raw,
      body,
      deviceId: deviceIdFromToken,
      visibility: normalizeBatchVisibility(
        pickFirstQueryParam(req.query["visibility"]) ?? requestHeader(req, "x-batch-visibility")
      ),
    });

    res.status(202).json(result);
  }
  catch (err) {
    const normalized = toHttpError(err);
    if (normalized.headers) {
      for (const [name, value] of Object.entries(normalized.headers)) {
        res.setHeader(name, value);
      }
    }
    res.status(normalized.statusCode).json(normalized.body);
  }
}

export const ingestGateway = onRequest({ cors: true }, async (req, res) => {
  await ingestGatewayHandler(req as RequestWithRawBody, res as unknown as GatewayResponse);
});
