import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairingRoutes } from "../../src/routes/pairing.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";

const mocks = vi.hoisted(() => ({
  startPairingSession: vi.fn(),
  findSessionByDeviceCode: vi.fn(),
  ensureSessionActive: vi.fn(),
  sessionExpired: vi.fn(),
  updatePollMetadata: vi.fn(),
  recordRegistrationToken: vi.fn(),
  markSessionRedeemed: vi.fn(),
  verifyDpopProof: vi.fn(),
  issueRegistrationToken: vi.fn(),
  verifyRegistrationToken: vi.fn(),
  issueDeviceAccessToken: vi.fn(),
  registerDevice: vi.fn(),
  getDevice: vi.fn(),
  updateDeviceLastSeen: vi.fn(),
  rateLimitOrThrow: vi.fn(),
  calculateJwkThumbprint: vi.fn(),
  authGetUser: vi.fn(),
}));

vi.mock("../../src/services/devicePairing.js", () => ({
  startPairingSession: mocks.startPairingSession,
  findSessionByDeviceCode: mocks.findSessionByDeviceCode,
  ensureSessionActive: mocks.ensureSessionActive,
  sessionExpired: mocks.sessionExpired,
  updatePollMetadata: mocks.updatePollMetadata,
  recordRegistrationToken: mocks.recordRegistrationToken,
  markSessionRedeemed: mocks.markSessionRedeemed,
}));

vi.mock("../../src/services/deviceTokens.js", () => ({
  issueRegistrationToken: mocks.issueRegistrationToken,
  verifyRegistrationToken: mocks.verifyRegistrationToken,
  issueDeviceAccessToken: mocks.issueDeviceAccessToken,
}));

vi.mock("../../src/services/deviceRegistry.js", () => ({
  registerDevice: mocks.registerDevice,
  getDevice: mocks.getDevice,
  updateDeviceLastSeen: mocks.updateDeviceLastSeen,
}));

vi.mock("../../src/lib/dpop.js", () => ({
  verifyDpopProof: mocks.verifyDpopProof,
}));

vi.mock("../../src/lib/fire.js", () => ({
  app: () => ({
    auth: () => ({
      getUser: mocks.authGetUser,
    }),
  }),
}));

vi.mock("../../src/lib/rateLimiter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/rateLimiter.js")>();
  return { ...actual, rateLimitOrThrow: mocks.rateLimitOrThrow };
});

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return { ...actual, calculateJwkThumbprint: mocks.calculateJwkThumbprint };
});

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, req, rep) => {
    const normalized = toHttpError(err);
    if (normalized.headers) rep.headers(normalized.headers);
    rep.code(normalized.statusCode).send(normalized.body);
  });
  await app.register(pairingRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  mocks.startPairingSession.mockReset();
  mocks.findSessionByDeviceCode.mockReset();
  mocks.ensureSessionActive.mockReset();
  mocks.sessionExpired.mockReset();
  mocks.updatePollMetadata.mockReset();
  mocks.recordRegistrationToken.mockReset();
  mocks.markSessionRedeemed.mockReset();
  mocks.verifyDpopProof.mockReset();
  mocks.issueRegistrationToken.mockReset();
  mocks.verifyRegistrationToken.mockReset();
  mocks.issueDeviceAccessToken.mockReset();
  mocks.registerDevice.mockReset();
  mocks.getDevice.mockReset();
  mocks.updateDeviceLastSeen.mockReset();
  mocks.rateLimitOrThrow.mockReset();
  mocks.calculateJwkThumbprint.mockReset();
  mocks.authGetUser.mockReset();

  mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 });
  mocks.sessionExpired.mockReturnValue(false);
  mocks.verifyDpopProof.mockResolvedValue({ thumbprint: "thumbprint-1" });
  mocks.calculateJwkThumbprint.mockResolvedValue("thumbprint-kl");
  mocks.updatePollMetadata.mockResolvedValue(undefined);
  mocks.recordRegistrationToken.mockResolvedValue(undefined);
  mocks.markSessionRedeemed.mockResolvedValue(undefined);
  mocks.ensureSessionActive.mockReturnValue(undefined);
  mocks.authGetUser.mockResolvedValue({ disabled: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /device/start", () => {
  it("happy path returns session info", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2024-01-01T00:00:00.000Z").getTime());
    const app = await buildApp();

    mocks.startPairingSession.mockResolvedValue({
      session: {
        deviceCode: "device-code-1",
        userCode: "ABCD-EFGH",
        pollInterval: 5,
        expiresAt: new Date("2024-01-01T00:01:00.000Z"),
      },
      verificationUri: "https://example.com/activate",
      verificationUriComplete: "https://example.com/activate?code=ABCD-EFGH",
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/start",
      headers: { "x-forwarded-for": "203.0.113.5", "x-client-asn": "123" },
      payload: { pub_ke: "ZmFrZS1wdWItaw", model: "model-x", version: "1.0" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      device_code: "device-code-1",
      user_code: "ABCD-EFGH",
      verification_uri: "https://example.com/activate",
      verification_uri_complete: "https://example.com/activate?code=ABCD-EFGH",
      poll_interval: 5,
      expires_in: 60,
    });
    expect(mocks.startPairingSession).toHaveBeenCalledWith(expect.objectContaining({
      model: "model-x",
      version: "1.0",
      requesterIp: "203.0.113.0/24",
      requesterAsn: "AS123",
    }));
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith("pairing:start:model:model-x", 200, 60_000);
    await app.close();
    nowSpy.mockRestore();
  });

  it("validation: invalid body returns 400", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/device/start",
      payload: { model: "" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    await app.close();
  });

  it("rate limit: returns 429 with retry-after", async () => {
    const app = await buildApp();
    mocks.rateLimitOrThrow.mockImplementation(() => {
      throw new RateLimitError(5);
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/start",
      payload: { pub_ke: "ZmFrZS1wdWItaw", model: "model-x", version: "1.0" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("5");
    expect(res.json()).toEqual({ error: "rate_limited", retry_after: 5 });
    await app.close();
  });
});

describe("POST /device/token", () => {
  const deviceCode = "device-code-123456";
  it("happy path issues registration token", async () => {
    const app = await buildApp();
    const session = {
      deviceCode,
      id: deviceCode,
      accId: "acc-1",
      status: "authorized",
      pubKeThumbprint: "thumb-1",
      pollInterval: 5,
      lastPollAt: new Date("2023-12-31T23:00:00.000Z"),
      ref: { set: vi.fn() },
    };
    mocks.findSessionByDeviceCode.mockResolvedValue(session);
    mocks.issueRegistrationToken.mockResolvedValue({ token: "reg-token", expiresIn: 60, jti: "jti-1" });

    const res = await app.inject({
      method: "POST",
      url: "/device/token",
      headers: { dpop: "proof" },
      payload: { device_code: deviceCode },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ registration_token: "reg-token", expires_in: 60 });
    expect(mocks.recordRegistrationToken).toHaveBeenCalledWith(deviceCode, "jti-1", expect.any(Date));
    await app.close();
  });

  it("validation: invalid body returns 400", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/device/token",
      payload: { device_code: "short" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    await app.close();
  });

  it("expired session returns 400 expired_token", async () => {
    const app = await buildApp();
    mocks.sessionExpired.mockReturnValue(true);
    const ref = { set: vi.fn() };
    mocks.findSessionByDeviceCode.mockResolvedValue({
      deviceCode,
      pubKeThumbprint: "thumb-1",
      pollInterval: 5,
      ref,
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/token",
      headers: { dpop: "proof" },
      payload: { device_code: deviceCode },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "expired_token" });
    expect(ref.set).toHaveBeenCalledWith({ status: "expired" }, { merge: true });
    await app.close();
  });

  it("authorization pending returns 400", async () => {
    const app = await buildApp();
    mocks.findSessionByDeviceCode.mockResolvedValue({
      deviceCode,
      pubKeThumbprint: "thumb-1",
      pollInterval: 5,
      status: "pending",
      ref: { set: vi.fn() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/token",
      headers: { dpop: "proof" },
      payload: { device_code: deviceCode },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "authorization_pending" });
    await app.close();
  });

  it("slow down returns 400 with next poll_interval", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(new Date("2024-01-01T00:00:00.000Z").getTime());
    const app = await buildApp();
    mocks.findSessionByDeviceCode.mockResolvedValue({
      deviceCode,
      id: deviceCode,
      accId: "acc-1",
      status: "authorized",
      pubKeThumbprint: "thumb-1",
      pollInterval: 10,
      lastPollAt: new Date(Date.now()),
      ref: { set: vi.fn() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/token",
      headers: { dpop: "proof" },
      payload: { device_code: deviceCode },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "slow_down", poll_interval: 15 });
    expect(mocks.updatePollMetadata).toHaveBeenCalledWith(deviceCode, 15);
    await app.close();
    nowSpy.mockRestore();
  });

  it("invalid DPoP returns 401", async () => {
    const app = await buildApp();
    mocks.verifyDpopProof.mockRejectedValue(Object.assign(new Error("invalid_dpop"), { statusCode: 401, code: "invalid_dpop" }));
    mocks.findSessionByDeviceCode.mockResolvedValue({
      deviceCode,
      id: deviceCode,
      accId: "acc-1",
      status: "authorized",
      pubKeThumbprint: "thumb-1",
      pollInterval: 5,
      ref: { set: vi.fn() },
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/token",
      headers: { dpop: "proof" },
      payload: { device_code: deviceCode },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "invalid_dpop",
      message: "invalid_dpop",
      error_description: "invalid_dpop",
    });
    await app.close();
  });
});

describe("POST /device/register", () => {
  const jwk = { kty: "OKP", crv: "Ed25519", x: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };

  it("happy path registers device", async () => {
    const app = await buildApp();
    mocks.verifyRegistrationToken.mockResolvedValue({
      device_code: "device-code-1",
      acc_id: "acc-1",
      jti: "jti-1",
      cnf: { jkt: "thumb-1" },
    });
    mocks.findSessionByDeviceCode.mockResolvedValue({
      deviceCode: "device-code-1",
      accId: "acc-1",
      registrationTokenJti: "jti-1",
      registrationTokenExpiresAt: new Date(Date.now() + 600_000),
      pubKeThumbprint: "thumb-ke",
      model: "sensor",
      version: "1.0",
      fingerprint: "fp-1",
      status: "authorized",
    });
    mocks.registerDevice.mockResolvedValue({ deviceId: "device-1", createdAt: new Date("2024-01-01T00:00:00.000Z") });

    const res = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { authorization: "Bearer reg-token", dpop: "proof" },
      payload: { jwk_pub_kl: jwk },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      device_id: "device-1",
      jwk_pub_kl: jwk,
      issued_at: 1704067200,
    });
    expect(mocks.markSessionRedeemed).toHaveBeenCalledWith("device-code-1", "device-1");
    await app.close();
  });

  it("auth: missing registration token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/device/register",
      payload: { jwk_pub_kl: jwk },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "invalid_request",
      message: "missing registration token",
      error_description: "missing registration token",
    });
    await app.close();
  });

  it("auth: invalid registration token returns 401", async () => {
    const app = await buildApp();
    mocks.verifyRegistrationToken.mockRejectedValue(
      Object.assign(new Error("bad token"), { statusCode: 401, code: "invalid_token" })
    );

    const res = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { authorization: "Bearer bad" },
      payload: { jwk_pub_kl: jwk },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "invalid_token",
      message: "bad token",
      error_description: "bad token",
    });
    await app.close();
  });

  it("auth: session not authorized returns 403", async () => {
    const app = await buildApp();
    mocks.verifyRegistrationToken.mockResolvedValue({
      device_code: "device-code-1",
      acc_id: "acc-1",
      jti: "jti-1",
      cnf: { jkt: "thumb-1" },
    });
    mocks.findSessionByDeviceCode.mockResolvedValue({
      deviceCode: "device-code-1",
      accId: "other",
      registrationTokenJti: "jti-1",
      registrationTokenExpiresAt: new Date(Date.now() + 600_000),
      status: "authorized",
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { authorization: "Bearer reg-token", dpop: "proof" },
      payload: { jwk_pub_kl: jwk },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      message: "session not authorized for account",
      error_description: "session not authorized for account",
    });
    await app.close();
  });

  it("validation: CSR payload returns 400", async () => {
    const app = await buildApp();
    mocks.verifyRegistrationToken.mockResolvedValue({
      device_code: "device-code-1",
      acc_id: "acc-1",
      jti: "jti-1",
      cnf: { jkt: "thumb-1" },
    });
    mocks.findSessionByDeviceCode.mockResolvedValue({
      deviceCode: "device-code-1",
      accId: "acc-1",
      registrationTokenJti: "jti-1",
      registrationTokenExpiresAt: new Date(Date.now() + 600_000),
      status: "authorized",
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { authorization: "Bearer reg-token", dpop: "proof" },
      payload: { csr: "-----BEGIN CERTIFICATE REQUEST-----" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "unsupported_grant_type",
      message: "CSR enrollment is not yet supported",
      error_description: "CSR enrollment is not yet supported",
    });
    await app.close();
  });

  it("validation: missing jwk returns 400", async () => {
    const app = await buildApp();
    mocks.verifyRegistrationToken.mockResolvedValue({
      device_code: "device-code-1",
      acc_id: "acc-1",
      jti: "jti-1",
      cnf: { jkt: "thumb-1" },
    });
    mocks.findSessionByDeviceCode.mockResolvedValue({
      deviceCode: "device-code-1",
      accId: "acc-1",
      registrationTokenJti: "jti-1",
      registrationTokenExpiresAt: new Date(Date.now() + 600_000),
      status: "authorized",
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/register",
      headers: { authorization: "Bearer reg-token", dpop: "proof" },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_request",
      message: "jwk_pub_kl is required",
      error_description: "jwk_pub_kl is required",
    });
    await app.close();
  });
});

describe("POST /device/access-token", () => {
  const deviceId = "device-12345";
  it("happy path returns device access token", async () => {
    const app = await buildApp();
    mocks.getDevice.mockResolvedValue({
      id: deviceId,
      accId: "acc-1",
      registryStatus: "active",
      status: "ACTIVE",
      pubKlThumbprint: "thumb-1",
    });
    mocks.issueDeviceAccessToken.mockResolvedValue({ token: "access-token", expiresIn: 600 });

    const res = await app.inject({
      method: "POST",
      url: "/device/access-token",
      headers: { dpop: "proof" },
      payload: { device_id: deviceId, scope: ["ingest"] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      token_type: "DPoP",
      access_token: "access-token",
      expires_in: 600,
      device_id: deviceId,
    });
    await app.close();
  });

  it("validation: invalid body returns 400", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/device/access-token",
      payload: { device_id: "short" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    await app.close();
  });

  it("forbidden: inactive device returns 403", async () => {
    const app = await buildApp();
    mocks.getDevice.mockResolvedValue({
      id: deviceId,
      accId: "acc-1",
      registryStatus: "inactive",
      status: "REVOKED",
      pubKlThumbprint: "thumb-1",
    });

    const res = await app.inject({
      method: "POST",
      url: "/device/access-token",
      headers: { dpop: "proof" },
      payload: { device_id: deviceId },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      message: "device not active",
      error_description: "device not active",
    });
    await app.close();
  });

  it("forbidden: disabled owner account returns 403", async () => {
    const app = await buildApp();
    mocks.getDevice.mockResolvedValue({
      id: deviceId,
      accId: "acc-1",
      registryStatus: "active",
      status: "ACTIVE",
      pubKlThumbprint: "thumb-1",
    });
    mocks.authGetUser.mockResolvedValue({ disabled: true });

    const res = await app.inject({
      method: "POST",
      url: "/device/access-token",
      headers: { dpop: "proof" },
      payload: { device_id: deviceId },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      message: "device account disabled",
      error_description: "device account disabled",
    });
    await app.close();
  });

  it("invalid DPoP returns 401", async () => {
    const app = await buildApp();
    mocks.getDevice.mockResolvedValue({
      id: deviceId,
      accId: "acc-1",
      registryStatus: "active",
      status: "ACTIVE",
      pubKlThumbprint: "thumb-1",
    });
    mocks.verifyDpopProof.mockRejectedValue(Object.assign(new Error("invalid_dpop"), { statusCode: 401, code: "invalid_dpop" }));

    const res = await app.inject({
      method: "POST",
      url: "/device/access-token",
      headers: { dpop: "proof" },
      payload: { device_id: deviceId },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "invalid_dpop",
      message: "invalid_dpop",
      error_description: "invalid_dpop",
    });
    await app.close();
  });

  it("error mapping: token issue failure returns 500", async () => {
    const app = await buildApp();
    mocks.getDevice.mockResolvedValue({
      id: deviceId,
      accId: "acc-1",
      registryStatus: "active",
      status: "ACTIVE",
      pubKlThumbprint: "thumb-1",
    });
    mocks.issueDeviceAccessToken.mockRejectedValue(Object.assign(new Error("token error"), { statusCode: 500, code: "token_error" }));

    const res = await app.inject({
      method: "POST",
      url: "/device/access-token",
      headers: { dpop: "proof" },
      payload: { device_id: deviceId },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: "token_error",
      message: "token error",
      error_description: "token error",
    });
    await app.close();
  });
});
