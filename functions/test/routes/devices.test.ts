import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { devicesRoutes } from "../../src/routes/devices.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
  requireUser: vi.fn(),
  rateLimitOrThrow: vi.fn(),
}));

vi.mock("../../src/services/devicesService.js", () => ({
  getDevicesService: () => ({
    list: mocks.list,
    create: mocks.create,
    revoke: mocks.revoke,
  }),
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
  await app.register(devicesRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  mocks.list.mockReset();
  mocks.create.mockReset();
  mocks.revoke.mockReset();
  mocks.requireUser.mockReset();
  mocks.rateLimitOrThrow.mockReset();

  mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer invalid") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    return { uid: "user-123", email: "user@example.com" };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("devices routes", () => {
  it("GET /v1/devices happy path returns list", async () => {
    const app = await buildApp();
    const devices = [{ id: "device-1", name: "Sensor 1" }];
    mocks.list.mockResolvedValue(devices);

    const res = await app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(devices);
    expect(mocks.list).toHaveBeenCalledWith("user-123");
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith("devices:list:user-123", 60, 60_000);
    await app.close();
  });

  it("POST /v1/devices happy path creates device", async () => {
    const app = await buildApp();
    const created = { id: "device-2", name: "Alpha" };
    mocks.create.mockResolvedValue(created);

    const res = await app.inject({
      method: "POST",
      url: "/v1/devices",
      payload: { name: "Alpha" },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual(created);
    expect(mocks.create).toHaveBeenCalledWith("user-123", { name: "Alpha" });
    await app.close();
  });

  it("POST /v1/devices with empty body passes undefined name", async () => {
    const app = await buildApp();
    const created = { id: "device-3" };
    mocks.create.mockResolvedValue(created);

    const res = await app.inject({
      method: "POST",
      url: "/v1/devices",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith("user-123", { name: undefined });
    await app.close();
  });

  it("POST /v1/devices/:id/revoke happy path returns status", async () => {
    const app = await buildApp();
    mocks.revoke.mockResolvedValue(undefined);

    const res = await app.inject({
      method: "POST",
      url: "/v1/devices/device-9/revoke",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "revoked" });
    expect(mocks.revoke).toHaveBeenCalledWith("device-9", "user-123");
    await app.close();
  });

  it("auth: missing token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/devices" });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("error mapping: service error preserves status + body", async () => {
    const app = await buildApp();
    mocks.list.mockRejectedValue(Object.assign(new Error("device missing"), { statusCode: 404, code: "not_found" }));

    const res = await app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "device missing" });
    await app.close();
  });

  it("rate limit: guard returns 429 with retry-after", async () => {
    const app = await buildApp();
    mocks.rateLimitOrThrow.mockImplementation(() => {
      throw new RateLimitError(6);
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/devices",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("6");
    expect(res.json()).toEqual({ error: "rate_limited", retry_after: 6 });
    await app.close();
  });
});
