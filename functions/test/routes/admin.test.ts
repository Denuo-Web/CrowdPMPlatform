import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminRoutes } from "../../src/routes/admin.js";
import { toHttpError } from "../../src/lib/httpError.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  suspendDevice: vi.fn(),
  writeModerationAudit: vi.fn(),
}));

vi.mock("../../src/auth/firebaseVerify.js", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("../../src/services/deviceRegistry.js", () => ({
  suspendDevice: mocks.suspendDevice,
}));

vi.mock("../../src/lib/moderationAudit.js", () => ({
  writeModerationAudit: mocks.writeModerationAudit,
}));

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, req, rep) => {
    const normalized = toHttpError(err);
    if (normalized.headers) rep.headers(normalized.headers);
    rep.code(normalized.statusCode).send(normalized.body);
  });
  await app.register(adminRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.suspendDevice.mockReset();
  mocks.writeModerationAudit.mockReset();

  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer invalid") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer admin") return { uid: "admin-1", roles: ["super_admin"] };
    return { uid: "user-123", email: "user@example.com", roles: [] };
  });
  mocks.suspendDevice.mockResolvedValue({
    before: { status: "ACTIVE", registryStatus: "active" },
    after: { status: "SUSPENDED", registryStatus: "suspended", suspendedBy: "admin-1" },
  });
  mocks.writeModerationAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /v1/admin/devices/:id/suspend", () => {
  it("happy path suspends device for admin user", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/devices/device-1/suspend",
      headers: { authorization: "Bearer admin" },
      payload: { reason: "abuse report" },
    });

    expect(res.statusCode).toBe(204);
    expect(mocks.suspendDevice).toHaveBeenCalledWith("device-1", "admin-1", "abuse report");
    expect(mocks.writeModerationAudit).toHaveBeenCalledWith(expect.objectContaining({
      actorUid: "admin-1",
      targetType: "device",
      targetId: "devices/device-1",
      action: "device.suspended",
      reason: "abuse report",
    }));
    await app.close();
  });

  it("validation: invalid reason returns 400", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/devices/device-1/suspend",
      headers: { authorization: "Bearer admin" },
      payload: { reason: "x".repeat(501) },
    });

    expect(res.statusCode).toBe(400);
    expect(mocks.suspendDevice).not.toHaveBeenCalled();
    await app.close();
  });

  it("auth: missing token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/devices/device-1/suspend",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "unauthorized",
      message: "unauthorized",
    });
    await app.close();
  });

  it("auth: non-admin user returns 403", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/devices/device-1/suspend",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      message: "You do not have permission to access this resource.",
    });
    await app.close();
  });
});
