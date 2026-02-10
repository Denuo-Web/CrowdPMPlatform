import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activationRoutes } from "../../src/routes/activation.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";

const mocks = vi.hoisted(() => ({
  findSessionByUserCode: vi.fn(),
  authorizeSession: vi.fn(),
  sessionForClient: vi.fn(),
  requireUser: vi.fn(),
  rateLimitOrThrow: vi.fn(),
}));

vi.mock("../../src/services/devicePairing.js", () => ({
  findSessionByUserCode: mocks.findSessionByUserCode,
  authorizeSession: mocks.authorizeSession,
  sessionForClient: mocks.sessionForClient,
}));

vi.mock("../../src/auth/firebaseVerify.js", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("../../src/lib/rateLimiter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/rateLimiter.js")>();
  return { ...actual, rateLimitOrThrow: mocks.rateLimitOrThrow };
});

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, req, rep) => {
    const normalized = toHttpError(err);
    if (normalized.headers) rep.headers(normalized.headers);
    rep.code(normalized.statusCode).send(normalized.body);
  });
  await app.register(activationRoutes);
  await app.ready();
  return app;
}

const clientSession = {
  device_code: "device-abc",
  user_code: "ABCD-EFGH",
  model: "sensor-1",
  version: "1.0",
  status: "pending",
  fingerprint: "fp-123",
  requested_at: "2024-01-01T00:00:00.000Z",
  expires_at: "2024-01-01T00:10:00.000Z",
  requester_ip: "203.0.113.5",
  requester_asn: "AS123",
  poll_interval: 5,
};

const session = {
  accId: "acc-1",
};

beforeEach(() => {
  mocks.findSessionByUserCode.mockReset();
  mocks.authorizeSession.mockReset();
  mocks.sessionForClient.mockReset();
  mocks.requireUser.mockReset();
  mocks.rateLimitOrThrow.mockReset();

  mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  mocks.sessionForClient.mockReturnValue(clientSession);
  mocks.requireUser.mockImplementation(async (req, options) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer invalid") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer mfa" && options?.requireSecondFactorIfEnrolled) {
      throw Object.assign(new Error("second_factor_required"), { statusCode: 401 });
    }
    return { uid: "user-123", email: "user@example.com" };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/device-activation", () => {
  it("happy path: returns session for client with viewer + authorized account", async () => {
    const app = await buildApp();
    mocks.findSessionByUserCode.mockResolvedValue(session);

    const res = await app.inject({
      method: "GET",
      url: "/v1/device-activation?user_code=ab-cd-efgh",
      headers: {
        authorization: "Bearer ok",
        "x-forwarded-for": "203.0.113.5",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ...clientSession,
      authorized_account: "acc-1",
      viewer_account: "user-123",
    });
    expect(mocks.findSessionByUserCode).toHaveBeenCalledWith("ABCDEFGH");
    expect(mocks.sessionForClient).toHaveBeenCalledWith(session);
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith("activation:code:ABCDEFGH", 100, 60_000);
    await app.close();
  });

  it("auth: missing token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/device-activation?user_code=ABCDEFGH",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "unauthorized",
      message: "unauthorized",
      error_description: "unauthorized",
    });
    expect(mocks.findSessionByUserCode).not.toHaveBeenCalled();
    await app.close();
  });

  it("validation: invalid query returns 400 with details", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/device-activation?user_code=short",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    expect(res.json().details).toBeTruthy();
    await app.close();
  });

  it("resource existence: pairing code not found returns 404", async () => {
    const app = await buildApp();
    mocks.findSessionByUserCode.mockRejectedValue(Object.assign(new Error("Pairing code not found"), { statusCode: 404 }));

    const res = await app.inject({
      method: "GET",
      url: "/v1/device-activation?user_code=ABCDEFGH",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: "not_found",
      message: "Pairing code not found",
      error_description: "Pairing code not found",
    });
    await app.close();
  });

  it("boundary: normalizes user_code before lookup", async () => {
    const app = await buildApp();
    mocks.findSessionByUserCode.mockResolvedValue(session);

    const res = await app.inject({
      method: "GET",
      url: "/v1/device-activation?user_code=ab cd-1234",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.findSessionByUserCode).toHaveBeenCalledWith("ABCD1234");
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith("activation:code:ABCD1234", 100, 60_000);
    await app.close();
  });

  it("error mapping: service error preserves status + body", async () => {
    const app = await buildApp();
    mocks.findSessionByUserCode.mockRejectedValue(
      Object.assign(new Error("upstream down"), { statusCode: 503, code: "unavailable" })
    );

    const res = await app.inject({
      method: "GET",
      url: "/v1/device-activation?user_code=ABCDEFGH",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: "unavailable",
      message: "upstream down",
      error_description: "upstream down",
    });
    await app.close();
  });

  it("error mapping: rate limiting returns 429 with retry-after", async () => {
    const app = await buildApp();
    mocks.rateLimitOrThrow.mockImplementation((key: string) => {
      if (key.startsWith("activation:get:ip:")) {
        throw new RateLimitError(9);
      }
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/device-activation?user_code=ABCDEFGH",
      headers: { authorization: "Bearer ok", "x-forwarded-for": "203.0.113.5" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("9");
    expect(res.json()).toEqual({ error: "rate_limited", retry_after: 9 });
    await app.close();
  });
});

describe("POST /v1/device-activation/authorize", () => {
  it("happy path: authorizes session and returns client response", async () => {
    const app = await buildApp();
    mocks.authorizeSession.mockResolvedValue(session);

    const res = await app.inject({
      method: "POST",
      url: "/v1/device-activation/authorize",
      payload: { user_code: "ab-cd-efgh" },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ...clientSession,
      authorized_account: "acc-1",
    });
    expect(mocks.authorizeSession).toHaveBeenCalledWith("ABCDEFGH", "user-123");
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith("activation:code:ABCDEFGH", 40, 60_000);
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith("activation:authorize:user-123:code:ABCDEFGH", 5, 300_000);
    await app.close();
  });

  it("auth: missing token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/device-activation/authorize",
      payload: { user_code: "ABCDEFGH" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "unauthorized",
      message: "unauthorized",
      error_description: "unauthorized",
    });
    await app.close();
  });

  it("auth: second factor required returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/device-activation/authorize",
      payload: { user_code: "ABCDEFGH" },
      headers: { authorization: "Bearer mfa" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "unauthorized",
      message: "second_factor_required",
      error_description: "second_factor_required",
    });
    await app.close();
  });

  it("validation: invalid body returns 400 with details", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/device-activation/authorize",
      payload: { user_code: "short" },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
    expect(res.json().details).toBeTruthy();
    await app.close();
  });

  it("resource existence: pairing code not found returns 404", async () => {
    const app = await buildApp();
    mocks.authorizeSession.mockRejectedValue(Object.assign(new Error("Pairing code not found"), { statusCode: 404 }));

    const res = await app.inject({
      method: "POST",
      url: "/v1/device-activation/authorize",
      payload: { user_code: "ABCDEFGH" },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: "not_found",
      message: "Pairing code not found",
      error_description: "Pairing code not found",
    });
    await app.close();
  });

  it("error mapping: service error preserves status + body", async () => {
    const app = await buildApp();
    mocks.authorizeSession.mockRejectedValue(
      Object.assign(new Error("Pairing code expired"), { statusCode: 410, code: "gone" })
    );

    const res = await app.inject({
      method: "POST",
      url: "/v1/device-activation/authorize",
      payload: { user_code: "ABCDEFGH" },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({
      error: "gone",
      message: "Pairing code expired",
      error_description: "Pairing code expired",
    });
    await app.close();
  });
});
