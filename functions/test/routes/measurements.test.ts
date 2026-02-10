import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measurementsRoutes } from "../../src/routes/measurements.js";
import { httpError, toHttpError } from "../../src/lib/httpError.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";

const mocks = vi.hoisted(() => ({
  fetchRange: vi.fn(),
  requireUser: vi.fn(),
  rateLimitOrThrow: vi.fn(),
}));

vi.mock("../../src/services/measurementsService.js", () => ({
  getMeasurementsService: () => ({ fetchRange: mocks.fetchRange }),
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
  await app.register(measurementsRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  mocks.fetchRange.mockReset();
  mocks.requireUser.mockReset();
  mocks.rateLimitOrThrow.mockReset();

  mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 29, retryAfterSeconds: 0 });
  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer invalid") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer smoke") {
      return { uid: "smoke-user", email: "smoke-tester@crowdpm.dev" };
    }
    return { uid: "user-123", email: "user@example.com" };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/measurements", () => {
  it("happy path: returns measurements with expected status + shape", async () => {
    const app = await buildApp();
    const payload = [{
      id: "row-1",
      deviceId: "device-123",
      pollutant: "pm25",
      value: 12,
      unit: "ug/m3",
      lat: 45,
      lon: -122,
      timestamp: "2024-01-01T00:00:00.000Z",
    }];
    mocks.fetchRange.mockResolvedValue(payload);

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-123&t0=2024-01-01T00:00:00.000Z&t1=2024-01-01T01:00:00.000Z&limit=10",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(payload);
    expect(mocks.fetchRange).toHaveBeenCalledWith({
      userId: "user-123",
      deviceId: "device-123",
      pollutant: "pm25",
      start: "2024-01-01T00:00:00.000Z",
      end: "2024-01-01T01:00:00.000Z",
      limit: "10",
    });
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith("measurements:user:user-123", 30, 60_000);
    await app.close();
  });

  it("auth: missing token returns 401", async () => {
    const app = await buildApp();
    mocks.fetchRange.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-123&t0=2024-01-01T00:00:00.000Z&t1=2024-01-01T01:00:00.000Z",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "unauthorized",
      message: "unauthorized",
      error_description: "unauthorized",
    });
    expect(mocks.fetchRange).not.toHaveBeenCalled();
    await app.close();
  });

  it("auth: invalid token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-123&t0=2024-01-01T00:00:00.000Z&t1=2024-01-01T01:00:00.000Z",
      headers: { authorization: "Bearer invalid" },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "unauthorized",
      message: "unauthorized",
      error_description: "unauthorized",
    });
    expect(mocks.fetchRange).not.toHaveBeenCalled();
    await app.close();
  });

  it("auth: smoke-test email does not bypass measurement rules", async () => {
    const app = await buildApp();
    mocks.fetchRange.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-123&t0=2024-01-01T00:00:00.000Z&t1=2024-01-01T01:00:00.000Z",
      headers: { authorization: "Bearer smoke" },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.fetchRange).toHaveBeenCalledWith(expect.objectContaining({ userId: "smoke-user" }));
    await app.close();
  });

  it("auth: forbidden user maps to 403", async () => {
    const app = await buildApp();
    mocks.fetchRange.mockRejectedValue(httpError(403, "forbidden", "You do not have access to this device."));

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-999&t0=2024-01-01T00:00:00.000Z&t1=2024-01-01T01:00:00.000Z",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      message: "You do not have access to this device.",
      error_description: "You do not have access to this device.",
    });
    await app.close();
  });

  it("validation: missing required query values returns empty list", async () => {
    const app = await buildApp();
    mocks.fetchRange.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(mocks.fetchRange).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: undefined,
      start: undefined,
      end: undefined,
    }));
    await app.close();
  });

  it("validation: malformed timestamps still return empty list", async () => {
    const app = await buildApp();
    mocks.fetchRange.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-123&t0=not-a-date&t1=also-bad",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("resource existence: missing device yields empty list", async () => {
    const app = await buildApp();
    mocks.fetchRange.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=missing-device&t0=2024-01-01T00:00:00.000Z&t1=2024-01-01T01:00:00.000Z",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("boundary/limits: forwards raw limit and timestamp range", async () => {
    const app = await buildApp();
    mocks.fetchRange.mockResolvedValue([]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-123&t0=2024-02-01T01:00:00.000Z&t1=2024-02-01T00:00:00.000Z&limit=99999",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.fetchRange).toHaveBeenCalledWith(expect.objectContaining({
      start: "2024-02-01T01:00:00.000Z",
      end: "2024-02-01T00:00:00.000Z",
      limit: "99999",
    }));
    await app.close();
  });

  it("error mapping: service errors map to status + body", async () => {
    const app = await buildApp();
    const err = Object.assign(new Error("bad query"), { statusCode: 400, code: "invalid_query" });
    mocks.fetchRange.mockRejectedValue(err);

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-123&t0=2024-01-01T00:00:00.000Z&t1=2024-01-01T01:00:00.000Z",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_query",
      message: "bad query",
      error_description: "bad query",
    });
    await app.close();
  });

  it("error mapping: rate limit guard returns 429 with retry-after", async () => {
    const app = await buildApp();
    mocks.rateLimitOrThrow.mockImplementation(() => {
      throw new RateLimitError(12);
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/measurements?device_id=device-123&t0=2024-01-01T00:00:00.000Z&t1=2024-01-01T01:00:00.000Z",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("12");
    expect(res.json()).toEqual({ error: "rate_limited", retry_after: 12 });
    await app.close();
  });
});
