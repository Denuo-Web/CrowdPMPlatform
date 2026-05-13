import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminRoutes } from "../../src/routes/admin.js";
import { toHttpError } from "../../src/lib/httpError.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  dbSet: vi.fn(),
}));

const mockDb = {
  collection: vi.fn((name: string) => {
    if (name !== "devices") throw new Error(`unexpected collection ${name}`);
    return {
      doc: () => ({
        set: mocks.dbSet,
      }),
    };
  }),
};

vi.mock("../../src/lib/fire.js", () => ({
  db: () => mockDb,
}));

vi.mock("../../src/auth/firebaseVerify.js", () => ({
  requireUser: mocks.requireUser,
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
  mocks.dbSet.mockReset();

  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer invalid") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer admin") return { uid: "admin-1", admin: true, roles: ["admin"] };
    return { uid: "user-123", email: "user@example.com", roles: [] };
  });
  mocks.dbSet.mockResolvedValue(undefined);
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
    });

    expect(res.statusCode).toBe(204);
    expect(mocks.dbSet).toHaveBeenCalledWith({ status: "SUSPENDED" }, { merge: true });
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
