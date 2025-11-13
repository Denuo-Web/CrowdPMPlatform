import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
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
  type SessionSnapshot,
} from "../services/devicePairing.js";
import { canonicalRequestUrl, coarsenIpForDisplay, deriveNetworkHint, extractClientIp } from "../lib/http.js";
import { verifyDpopProof } from "../lib/dpop.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";
import { issueRegistrationToken, verifyRegistrationToken, issueDeviceAccessToken } from "../services/deviceTokens.js";
import { registerDevice, getDevice } from "../services/deviceRegistry.js";

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

function respondWithError(rep: FastifyReply, err: unknown, fallbackStatus = 500) {
  const status = typeof err === "object" && err && "statusCode" in err && typeof (err as { statusCode?: unknown }).statusCode === "number"
    ? Number((err as { statusCode: unknown }).statusCode)
    : fallbackStatus;
  const message = err instanceof Error ? err.message : "unexpected error";
  return rep.code(status).send({ error: message });
}

export const pairingRoutes: FastifyPluginAsync = async (app) => {
  app.post("/device/start", async (req, rep) => {
    const parsed = startSchema.safeParse(req.body);
    if (!parsed.success) {
      return rep.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
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

    let sessionResult;
    try {
      sessionResult = await startPairingSession({
        pubKe: parsed.data.pub_ke,
        model: parsed.data.model,
        version: parsed.data.version,
        nonce: parsed.data.nonce,
        requesterIp: coarsenIpForDisplay(clientIp),
        requesterAsn: networkHint,
      });
    }
    catch (err) {
      return respondWithError(rep, err);
    }

    const expiresIn = Math.max(0, Math.floor((sessionResult.session.expiresAt.getTime() - Date.now()) / 1000));
    return rep.code(200).send({
      device_code: sessionResult.session.deviceCode,
      user_code: sessionResult.session.userCode,
      verification_uri: sessionResult.verificationUri,
      verification_uri_complete: sessionResult.verificationUriComplete,
      poll_interval: sessionResult.session.pollInterval,
      expires_in: expiresIn,
    });
  });

  app.post("/device/token", async (req, rep) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      return rep.code(400).send({ error: "invalid_request", details: parsed.error.flatten() });
    }
    rateLimitOrThrow(`pairing:device-token:${parsed.data.device_code}`, 15, 60_000);
    rateLimitOrThrow("pairing:device-token:global", 1_000, 60_000);
    let session: SessionSnapshot;
    try {
      session = await findSessionByDeviceCode(parsed.data.device_code);
    }
    catch (err) {
      return respondWithError(rep, err, 404);
    }
    if (sessionExpired(session)) {
      await session.ref.set({ status: "expired" }, { merge: true });
      return rep.code(400).send({ error: "expired_token" });
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
      return respondWithError(rep, err, 401);
    }

    const now = Date.now();
    const lastPoll = session.lastPollAt?.getTime() ?? 0;
    if (now - lastPoll < session.pollInterval * 1000) {
      const nextInterval = Math.min(session.pollInterval + 5, 30);
      await updatePollMetadata(session.deviceCode, nextInterval);
      return rep.code(400).send({ error: "slow_down", poll_interval: nextInterval });
    }
    await updatePollMetadata(session.deviceCode, session.pollInterval);

    if (session.status === "pending" || !session.accId) {
      return rep.code(400).send({ error: "authorization_pending" });
    }
    if (session.status === "redeemed") {
      return rep.code(400).send({ error: "expired_token" });
    }

    let issued;
    try {
      issued = await issueRegistrationToken({
        deviceCode: session.deviceCode,
        accountId: session.accId,
        sessionId: session.id,
        confirmationThumbprint: session.pubKeThumbprint,
      });
    }
    catch (err) {
      return respondWithError(rep, err);
    }
    const expiresAt = new Date(Date.now() + issued.expiresIn * 1000);
    await recordRegistrationToken(session.deviceCode, issued.jti, expiresAt);

    return rep.code(200).send({ registration_token: issued.token, expires_in: issued.expiresIn });
  });

  app.post("/device/register", async (req, rep) => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || !authHeader.toLowerCase().startsWith("bearer ")) {
      return rep.code(401).send({ error: "invalid_request", error_description: "missing registration token" });
    }
    const rawToken = authHeader.slice(7).trim();
    let verifiedToken;
    try {
      verifiedToken = await verifyRegistrationToken(rawToken);
    }
    catch (err) {
      return rep.code(401).send({ error: "invalid_token", error_description: err instanceof Error ? err.message : "invalid registration token" });
    }
    rateLimitOrThrow(`pairing:register:device:${verifiedToken.device_code}`, 10, 60_000);
    rateLimitOrThrow(`pairing:register:account:${verifiedToken.acc_id}`, 50, 60_000);
    rateLimitOrThrow("pairing:register:global", 1_000, 60_000);

    const proof = req.headers["dpop"];
    let session: SessionSnapshot;
    try {
      session = await findSessionByDeviceCode(verifiedToken.device_code);
    }
    catch (err) {
      return respondWithError(rep, err, 404);
    }
    if (!session.accId || session.accId !== verifiedToken.acc_id) {
      return rep.code(403).send({ error: "forbidden", error_description: "session not authorized for account" });
    }
    if (session.registrationTokenJti !== verifiedToken.jti) {
      return rep.code(403).send({ error: "invalid_token", error_description: "token does not match active session" });
    }
    if (session.registrationTokenExpiresAt && session.registrationTokenExpiresAt.getTime() <= Date.now()) {
      return rep.code(400).send({ error: "expired_token" });
    }
    ensureSessionActive(session);

    const proofValue = typeof proof === "string" ? proof : Array.isArray(proof) ? proof[0] : undefined;
    const htu = fastifyRequestUrl(req);
    try {
      await verifyDpopProof(proofValue, {
        method: req.method.toUpperCase(),
        htu,
        expectedThumbprint: verifiedToken.cnf.jkt,
      });
    }
    catch (err) {
      return respondWithError(rep, err, 401);
    }

    const payload = registerSchema.safeParse(req.body);
    if (!payload.success) {
      return rep.code(400).send({ error: "invalid_request", details: payload.error.flatten() });
    }
    if (payload.data.csr) {
      return rep.code(400).send({ error: "unsupported_grant_type", error_description: "CSR enrollment is not yet supported" });
    }
    const jwk = payload.data.jwk_pub_kl;
    if (!jwk) {
      return rep.code(400).send({ error: "invalid_request", error_description: "jwk_pub_kl is required" });
    }

    let thumbprint: string;
    try {
      thumbprint = await calculateJwkThumbprint(jwk, "sha256");
    }
    catch (err) {
      return respondWithError(rep, err, 400);
    }
    let result;
    try {
      result = await registerDevice({
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
    }
    catch (err) {
      return respondWithError(rep, err);
    }
    return rep.code(200).send({
      device_id: result.deviceId,
      jwk_pub_kl: jwk,
      issued_at: Math.floor(result.createdAt.getTime() / 1000),
    });
  });

  app.post("/device/access-token", async (req, rep) => {
    const payload = deviceTokenSchema.safeParse(req.body);
    if (!payload.success) {
      return rep.code(400).send({ error: "invalid_request", details: payload.error.flatten() });
    }
    rateLimitOrThrow(`device:token:${payload.data.device_id}`, 12, 60_000);
    rateLimitOrThrow("device:token:global", 500, 60_000);
    let device;
    try {
      device = await getDevice(payload.data.device_id);
    }
    catch (err) {
      return respondWithError(rep, err);
    }
    if (!device) {
      return rep.code(403).send({ error: "forbidden", error_description: "device not found" });
    }
    if (device.registryStatus !== "active" || device.status === "REVOKED" || device.status === "SUSPENDED") {
      return rep.code(403).send({ error: "forbidden", error_description: "device not active" });
    }

    const proof = req.headers["dpop"];
    const htu = fastifyRequestUrl(req);
    let verifiedProof;
    try {
      verifiedProof = await verifyDpopProof(typeof proof === "string" ? proof : Array.isArray(proof) ? proof[0] : undefined, {
        method: req.method.toUpperCase(),
        htu,
        expectedThumbprint: device.pubKlThumbprint,
      });
    }
    catch (err) {
      return respondWithError(rep, err, 401);
    }

    let token;
    try {
      token = await issueDeviceAccessToken({
        deviceId: device.id,
        accountId: device.accId,
        confirmationThumbprint: verifiedProof.thumbprint,
        scope: payload.data.scope,
      });
    }
    catch (err) {
      return respondWithError(rep, err);
    }
    return rep.code(200).send({
      token_type: "DPoP",
      access_token: token.token,
      expires_in: token.expiresIn,
      device_id: device.id,
    });
  });
};
