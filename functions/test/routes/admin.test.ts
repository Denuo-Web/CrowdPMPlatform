import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminRoutes } from "../../src/routes/admin.js";
import { toHttpError } from "../../src/lib/httpError.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  authorizeSmokeTestUser: vi.fn(),
  runSmokeTest: vi.fn(),
  userOwnsDevice: vi.fn(),
  dbSet: vi.fn(),
  dbDelete: vi.fn(),
  dbGet: vi.fn(),
  recursiveDelete: vi.fn(),
  deleteFiles: vi.fn(),
}));

type DeviceDoc = {
  exists: boolean;
  data?: Record<string, unknown>;
};

let deviceDocs = new Map<string, DeviceDoc>();

const mockDb = {
  collection: vi.fn(() => ({
    doc: (id: string) => ({
      set: mocks.dbSet,
      delete: mocks.dbDelete,
      get: async () => {
        const entry = deviceDocs.get(id);
        return {
          exists: entry?.exists ?? false,
          data: () => entry?.data ?? {},
        };
      },
    }),
  })),
};

const mockBucket = {
  deleteFiles: mocks.deleteFiles,
};

const mockApp = {
  firestore: () => ({
    recursiveDelete: mocks.recursiveDelete,
  }),
};

vi.mock("../../src/lib/fire.js", () => ({
  db: () => mockDb,
  bucket: () => mockBucket,
  app: () => mockApp,
}));

vi.mock("../../src/services/ingestSmokeTestService.js", () => ({
  authorizeSmokeTestUser: mocks.authorizeSmokeTestUser,
  getIngestSmokeTestService: () => ({ runSmokeTest: mocks.runSmokeTest }),
  SmokeTestServiceError: class SmokeTestServiceError extends Error {
    readonly statusCode: number;
    readonly reason: string;

    constructor(reason: string, message: string, statusCode: number) {
      super(message);
      this.reason = reason;
      this.statusCode = statusCode;
    }
  },
}));

vi.mock("../../src/lib/deviceOwnership.js", () => ({
  userOwnsDevice: mocks.userOwnsDevice,
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
  mocks.authorizeSmokeTestUser.mockReset();
  mocks.runSmokeTest.mockReset();
  mocks.userOwnsDevice.mockReset();
  mocks.dbSet.mockReset();
  mocks.dbDelete.mockReset();
  mocks.dbGet.mockReset();
  mocks.recursiveDelete.mockReset();
  mocks.deleteFiles.mockReset();
  deviceDocs = new Map<string, DeviceDoc>();

  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer invalid") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer admin") return { uid: "admin-1", admin: true, roles: ["admin"] };
    if (auth === "Bearer smoke") return { uid: "smoke-1", email: "smoke-tester@crowdpm.dev" };
    return { uid: "user-123", email: "user@example.com", roles: [] };
  });
  mocks.authorizeSmokeTestUser.mockImplementation(() => undefined);
  mocks.userOwnsDevice.mockReturnValue(true);
  mocks.runSmokeTest.mockResolvedValue({
    accepted: true,
    batchId: "batch-1",
    deviceId: "device-1",
    storagePath: "ingest/device-1/batch-1.json",
    visibility: "private",
    payload: { points: [] },
    points: [],
    seededDeviceId: "device-1",
    seededDeviceIds: ["device-1"],
  });
  mocks.recursiveDelete.mockResolvedValue(undefined);
  mocks.deleteFiles.mockResolvedValue(undefined);
  mocks.dbDelete.mockResolvedValue(undefined);
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
      error_description: "unauthorized",
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
      message: "You do not have permission to suspend devices.",
      error_description: "You do not have permission to suspend devices.",
    });
    await app.close();
  });
});

describe("POST /v1/admin/ingest-smoke-test", () => {
  it("happy path returns smoke test result", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/ingest-smoke-test",
      headers: { authorization: "Bearer smoke" },
      payload: { payload: { points: [] } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({ batchId: "batch-1", deviceId: "device-1" }));
    await app.close();
  });

  it("auth: smoke test forbidden returns 403", async () => {
    const app = await buildApp();
    mocks.authorizeSmokeTestUser.mockImplementation(() => {
      throw Object.assign(new Error("Caller lacks permission to run smoke tests"), { statusCode: 403, code: "FORBIDDEN" });
    });

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/ingest-smoke-test",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      message: "Caller lacks permission to run smoke tests",
      error_description: "Caller lacks permission to run smoke tests",
    });
    await app.close();
  });

  it("error mapping: runSmokeTest errors map to status + body", async () => {
    const app = await buildApp();
    mocks.runSmokeTest.mockRejectedValue(Object.assign(new Error("invalid payload"), { statusCode: 400, code: "INVALID_PAYLOAD" }));

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/ingest-smoke-test",
      headers: { authorization: "Bearer smoke" },
      payload: { payload: { points: [] } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_payload",
      message: "invalid payload",
      error_description: "invalid payload",
    });
    await app.close();
  });
});

describe("POST /v1/admin/ingest-smoke-test/cleanup", () => {
  it("happy path clears device data", async () => {
    const app = await buildApp();
    deviceDocs.set("device-1", { exists: true, data: { ownerUserId: "user-123" } });

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/ingest-smoke-test/cleanup",
      headers: { authorization: "Bearer smoke" },
      payload: { deviceId: "device-1" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      clearedDeviceId: "device-1",
      clearedDeviceIds: ["device-1"],
      failedDeletions: [],
    });
    expect(mocks.recursiveDelete).toHaveBeenCalled();
    expect(mocks.deleteFiles).toHaveBeenCalledWith({ prefix: "ingest/device-1/" });
    expect(mocks.dbDelete).toHaveBeenCalled();
    await app.close();
  });

  it("auth: forbidden device returns 403 with list", async () => {
    const app = await buildApp();
    deviceDocs.set("device-1", { exists: true, data: { ownerUserId: "other-user" } });
    mocks.userOwnsDevice.mockReturnValue(false);

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/ingest-smoke-test/cleanup",
      headers: { authorization: "Bearer smoke" },
      payload: { deviceId: "device-1" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      message: "You do not have permission to delete one or more devices.",
      error_description: "You do not have permission to delete one or more devices.",
      forbiddenDeviceIds: ["device-1"],
    });
    await app.close();
  });

  it("partial failures return 207 with failedDeletions", async () => {
    const app = await buildApp();
    deviceDocs.set("device-1", { exists: true, data: { ownerUserId: "user-123" } });
    mocks.recursiveDelete.mockRejectedValue(new Error("firestore failed"));

    const res = await app.inject({
      method: "POST",
      url: "/v1/admin/ingest-smoke-test/cleanup",
      headers: { authorization: "Bearer smoke" },
      payload: { deviceId: "device-1" },
    });

    expect(res.statusCode).toBe(207);
    expect(res.json().failedDeletions.length).toBeGreaterThan(0);
    await app.close();
  });
});
