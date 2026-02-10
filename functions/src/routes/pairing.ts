import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { calculateJwkThumbprint } from "jose";
import {
  startPairingSession,
  findSessionByDeviceCode,
  ensureSessionActive,
  sessionExpired,
  updatePollMetadata,
  recordRegistrationToken,
  markSessionRedeemed,
} from "../services/devicePairing.js";
import { canonicalRequestUrl, coarsenIpForDisplay, deriveNetworkHint, extractClientIp } from "../lib/http.js";
import { verifyDpopProof } from "../lib/dpop.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";
import { issueRegistrationToken, verifyRegistrationToken, issueDeviceAccessToken } from "../services/deviceTokens.js";
import { registerDevice, getDevice } from "../services/deviceRegistry.js";
import { httpError } from "../lib/httpError.js";

const startSchema = z.object({
  pub_ke: z.string().min(10),
  model: z.string().min(1).max(64),
  version: z.string().min(1).max(64),
  nonce: z.string().max(64).optional(),
});

const tokenSchema = z.object({
  device_code: z.string().min(16),
});

const registerSchema = z.object({
  jwk_pub_kl: z.object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z.string().min(43),
  }).optional(),
  csr: z.string().optional(),
});

const deviceTokenSchema = z.object({
  device_id: z.string().min(10),
  scope: z.array(z.string()).max(8).optional(),
});

function fastifyRequestUrl(req: FastifyRequest): string {
  return canonicalRequestUrl(req.raw.url ?? req.url, req.headers);
}

export const pairingRoutes: FastifyPluginAsync = async (app) => {
  app.post("/device/start", async (req) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    const clientIp = extractClientIp(req.headers) ?? null;
    const ipBudgetKey = clientIp ? `pairing:start:ip:${clientIp}` : null;
    const networkHint = deriveNetworkHint(req.headers, clientIp);
    const asnBudgetKey = networkHint ? `pairing:start:asn:${networkHint}` : null;
    const modelBudgetKey = `pairing:start:model:${parsed.data.model}`;

    if (ipBudgetKey) rateLimitOrThrow(ipBudgetKey, 10, 60_000);
    if (asnBudgetKey) rateLimitOrThrow(asnBudgetKey, 50, 60_000);
    rateLimitOrThrow(modelBudgetKey, 200, 60_000);
    rateLimitOrThrow("pairing:start:global", 500, 60_000);

    const sessionResult = await startPairingSession({
      pubKe: parsed.data.pub_ke,
      model: parsed.data.model,
      version: parsed.data.version,
      nonce: parsed.data.nonce,
      requesterIp: coarsenIpForDisplay(clientIp),
      requesterAsn: networkHint,
    });

    const expiresIn = Math.max(0, Math.floor((sessionResult.session.expiresAt.getTime() - Date.now()) / 1000));
    return {
      device_code: sessionResult.session.deviceCode,
      user_code: sessionResult.session.userCode,
      verification_uri: sessionResult.verificationUri,
      verification_uri_complete: sessionResult.verificationUriComplete,
      poll_interval: sessionResult.session.pollInterval,
      expires_in: expiresIn,
    };
  });

  app.post("/device/token", async (req) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    rateLimitOrThrow(`pairing:device-token:${parsed.data.device_code}`, 15, 60_000);
    rateLimitOrThrow("pairing:device-token:global", 1_000, 60_000);
    const session = await findSessionByDeviceCode(parsed.data.device_code);
    if (sessionExpired(session)) {
      await session.ref.set({ status: "expired" }, { merge: true });
      throw httpError(400, "expired_token");
    }

    const proof = req.headers["dpop"];
    const htu = fastifyRequestUrl(req);
    try {
      await verifyDpopProof(typeof proof === "string" ? proof : Array.isArray(proof) ? proof[0] : undefined, {
        method: req.method.toUpperCase(),
        htu,
        expectedThumbprint: session.pubKeThumbprint,
      });
    }
    catch (err) {
      req.log.warn({ err, deviceCode: session.deviceCode }, "invalid DPoP for device token");
      throw err;
    }

    const now = Date.now();
    const lastPoll = session.lastPollAt?.getTime() ?? 0;
    if (now - lastPoll < session.pollInterval * 1000) {
      const nextInterval = Math.min(session.pollInterval + 5, 30);
      await updatePollMetadata(session.deviceCode, nextInterval);
      throw httpError(400, "slow_down", undefined, { poll_interval: nextInterval });
    }
    await updatePollMetadata(session.deviceCode, session.pollInterval);

    if (session.status === "pending" || !session.accId) {
      throw httpError(400, "authorization_pending");
    }
    if (session.status === "redeemed") {
      throw httpError(400, "expired_token");
    }

    const accountId = session.accId;
    if (!accountId) {
      throw httpError(400, "authorization_pending");
    }

    const issued = await issueRegistrationToken({
      deviceCode: session.deviceCode,
      accountId,
      sessionId: session.id,
      confirmationThumbprint: session.pubKeThumbprint,
    });
    const expiresAt = new Date(Date.now() + issued.expiresIn * 1000);
    await recordRegistrationToken(session.deviceCode, issued.jti, expiresAt);

    return { registration_token: issued.token, expires_in: issued.expiresIn };
  });

  app.post("/device/register", async (req) => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.toLowerCase().startsWith("bearer ")) {
      throw httpError(401, "invalid_request", "missing registration token");
    }
    const rawToken = authHeader.slice(7).trim();
    const verifiedToken = await verifyRegistrationToken(rawToken);

    rateLimitOrThrow(`pairing:register:device:${verifiedToken.device_code}`, 10, 60_000);
    rateLimitOrThrow(`pairing:register:account:${verifiedToken.acc_id}`, 50, 60_000);
    rateLimitOrThrow("pairing:register:global", 1_000, 60_000);

    const proof = req.headers["dpop"];
    const session = await findSessionByDeviceCode(verifiedToken.device_code);
    if (!session.accId || session.accId !== verifiedToken.acc_id) {
      throw httpError(403, "forbidden", "session not authorized for account");
    }
    if (session.registrationTokenJti !== verifiedToken.jti) {
      throw httpError(403, "invalid_token", "token does not match active session");
    }
    if (session.registrationTokenExpiresAt && session.registrationTokenExpiresAt.getTime() <= Date.now()) {
      throw httpError(400, "expired_token");
    }
    ensureSessionActive(session);

    const proofValue = typeof proof === "string" ? proof : Array.isArray(proof) ? proof[0] : undefined;
    const htu = fastifyRequestUrl(req);
    await verifyDpopProof(proofValue, {
      method: req.method.toUpperCase(),
      htu,
      expectedThumbprint: verifiedToken.cnf.jkt,
    });

    const payload = registerSchema.safeParse(req.body);
    if (!payload.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: payload.error.flatten() });
    }
    if (payload.data.csr) {
      throw httpError(400, "unsupported_grant_type", "CSR enrollment is not yet supported");
    }
    const jwk = payload.data.jwk_pub_kl;
    if (!jwk) {
      throw httpError(400, "invalid_request", "jwk_pub_kl is required");
    }

    let thumbprint: string;
    try {
      thumbprint = await calculateJwkThumbprint(jwk, "sha256");
    }
    catch (err) {
      throw httpError(400, "invalid_request", err instanceof Error ? err.message : "invalid jwk_pub_kl");
    }

    const result = await registerDevice({
      accountId: verifiedToken.acc_id,
      model: session.model,
      version: session.version,
      pubKlJwk: jwk,
      pubKlThumbprint: thumbprint,
      keThumbprint: session.pubKeThumbprint,
      pairingDeviceCode: session.deviceCode,
      fingerprint: session.fingerprint,
    });
    await markSessionRedeemed(session.deviceCode, result.deviceId);
    return {
      device_id: result.deviceId,
      jwk_pub_kl: jwk,
      issued_at: Math.floor(result.createdAt.getTime() / 1000),
    };
  });

  app.post("/device/access-token", async (req) => {
    const payload = deviceTokenSchema.safeParse(req.body);
    if (!payload.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: payload.error.flatten() });
    }
    rateLimitOrThrow(`device:token:${payload.data.device_id}`, 12, 60_000);
    rateLimitOrThrow("device:token:global", 500, 60_000);
    const device = await getDevice(payload.data.device_id);
    if (!device) {
      throw httpError(403, "forbidden", "device not found");
    }
    if (device.registryStatus !== "active" || device.status === "REVOKED" || device.status === "SUSPENDED") {
      throw httpError(403, "forbidden", "device not active");
    }

    const proof = req.headers["dpop"];
    const htu = fastifyRequestUrl(req);
    const verifiedProof = await verifyDpopProof(typeof proof === "string" ? proof : Array.isArray(proof) ? proof[0] : undefined, {
      method: req.method.toUpperCase(),
      htu,
      expectedThumbprint: device.pubKlThumbprint,
    });

    const token = await issueDeviceAccessToken({
      deviceId: device.id,
      accountId: device.accId,
      confirmationThumbprint: verifiedProof.thumbprint,
      scope: payload.data.scope,
    });

    return {
      token_type: "DPoP",
      access_token: token.token,
      expires_in: token.expiresIn,
      device_id: device.id,
    };
  });
};
