import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batchesRoutes } from "../../src/routes/batches.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";

const mocks = vi.hoisted(() => ({
  loadOwnedDeviceDocs: vi.fn(),
  userOwnsDevice: vi.fn(),
  requireUser: vi.fn(),
  rateLimitOrThrow: vi.fn(),
  bucketDownload: vi.fn(),
}));

type DeviceSnapConfig = {
  exists: boolean;
  data?: Record<string, unknown>;
  batches?: Record<string, { exists: boolean; data?: Record<string, unknown> }>;
};

let currentDeviceSnap: DeviceSnapConfig | null = null;

function makeBatchDocSnapshot(config?: { exists: boolean; data?: Record<string, unknown> }) {
  const exists = config?.exists ?? false;
  const data = config?.data ?? {};
  return {
    exists,
    data: () => data,
  };
}

function makeDeviceSnapshot(deviceId: string, config: DeviceSnapConfig) {
  const data = config.data ?? {};
  const ref = {
    collection: (name: string) => {
      if (name !== "batches") {
        throw new Error(`unexpected collection ${name}`);
      }
      return {
        doc: (batchId: string) => ({
          get: async () => makeBatchDocSnapshot(config.batches?.[batchId]),
        }),
      };
    },
  };
  return {
    exists: config.exists,
    data: () => data,
    get: (field: string) => data[field],
    ref,
  };
}

const mockDb = {
  collection: vi.fn((name: string) => ({
    doc: (id: string) => ({
      get: async () => {
        if (!currentDeviceSnap) return makeDeviceSnapshot(id, { exists: false });
        return makeDeviceSnapshot(id, currentDeviceSnap);
      },
    }),
  })),
};

const mockBucket = {
  file: vi.fn(() => ({
    download: mocks.bucketDownload,
  })),
};

vi.mock("../../src/lib/fire.js", () => ({
  db: () => mockDb,
  bucket: () => mockBucket,
}));

vi.mock("../../src/lib/deviceOwnership.js", () => ({
  loadOwnedDeviceDocs: mocks.loadOwnedDeviceDocs,
  userOwnsDevice: mocks.userOwnsDevice,
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
  await app.register(batchesRoutes);
  await app.ready();
  return app;
}

function makeBatchQuery(docs: Array<{ id: string; data: () => Record<string, unknown> }>) {
  const query = {
    orderBy: vi.fn(() => query),
    limit: vi.fn(() => query),
    get: vi.fn(async () => ({ docs })),
  };
  return query;
}

beforeEach(() => {
  mocks.loadOwnedDeviceDocs.mockReset();
  mocks.userOwnsDevice.mockReset();
  mocks.requireUser.mockReset();
  mocks.rateLimitOrThrow.mockReset();
  mocks.bucketDownload.mockReset();
  currentDeviceSnap = null;

  mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  mocks.userOwnsDevice.mockReturnValue(true);
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

describe("GET /v1/batches", () => {
  it("happy path returns sorted batch summaries", async () => {
    const app = await buildApp();

    const deviceDocs = new Map<string, Record<string, unknown>>([
      ["device-1", { name: "North" }],
      ["device-2", { name: "South" }],
    ]);

    const device1Query = makeBatchQuery([
      {
        id: "batch-a",
        data: () => ({ count: 1, processedAt: "2024-01-01T02:00:00.000Z", visibility: "public" }),
      },
    ]);
    const device2Query = makeBatchQuery([
      {
        id: "batch-b",
        data: () => ({ count: 2, processedAt: "2024-01-02T02:00:00.000Z", visibility: "private" }),
      },
    ]);

    const devicesCollection = {
      doc: (deviceId: string) => ({
        collection: () => (deviceId === "device-1" ? device1Query : device2Query),
      }),
    };

    mocks.loadOwnedDeviceDocs.mockResolvedValue({ collection: devicesCollection, docs: deviceDocs });

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        batchId: "batch-b",
        deviceId: "device-2",
        deviceName: "South",
        count: 2,
        processedAt: "2024-01-02T02:00:00.000Z",
        visibility: "private",
      },
      {
        batchId: "batch-a",
        deviceId: "device-1",
        deviceName: "North",
        count: 1,
        processedAt: "2024-01-01T02:00:00.000Z",
        visibility: "public",
      },
    ]);

    expect(device1Query.orderBy).toHaveBeenCalledWith("processedAt", "desc");
    expect(device1Query.limit).toHaveBeenCalledWith(10);
    expect(device2Query.orderBy).toHaveBeenCalledWith("processedAt", "desc");
    expect(device2Query.limit).toHaveBeenCalledWith(10);
    await app.close();
  });

  it("empty list returns []", async () => {
    const app = await buildApp();
    mocks.loadOwnedDeviceDocs.mockResolvedValue({ collection: { doc: () => ({ collection: () => makeBatchQuery([]) }) }, docs: new Map() });

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    await app.close();
  });

  it("auth: missing token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/batches" });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
    await app.close();
  });

  it("error mapping: loadOwnedDeviceDocs preserves status + body", async () => {
    const app = await buildApp();
    mocks.loadOwnedDeviceDocs.mockRejectedValue(Object.assign(new Error("db_down"), { statusCode: 503, code: "db_down" }));

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: "db_down" });
    await app.close();
  });
});

describe("GET /v1/batches/:deviceId/:batchId", () => {
  it("happy path returns batch detail payload", async () => {
    const app = await buildApp();
    currentDeviceSnap = {
      exists: true,
      data: { name: "Alpha" },
      batches: {
        "batch-1": {
          exists: true,
          data: { path: "ingest/device-1/batch-1.json", count: 1, processedAt: "2024-01-01T00:00:00.000Z", visibility: "public" },
        },
      },
    };
    const batchPayload = {
      points: [{
        device_id: "device-1",
        pollutant: "pm25",
        value: 12,
        unit: "\u00b5g/m\u00b3",
        lat: 45,
        lon: -122,
        timestamp: "2024-01-01T00:00:00.000Z",
      }],
    };
    mocks.bucketDownload.mockResolvedValue([Buffer.from(JSON.stringify(batchPayload), "utf8")]);

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches/device-1/batch-1",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.batchId).toBe("batch-1");
    expect(body.deviceId).toBe("device-1");
    expect(body.deviceName).toBe("Alpha");
    expect(body.count).toBe(1);
    expect(body.points).toHaveLength(1);
    await app.close();
  });

  it("resource existence: device not found returns 404", async () => {
    const app = await buildApp();
    currentDeviceSnap = { exists: false };

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches/device-404/batch-1",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "Device not found" });
    await app.close();
  });

  it("resource existence: batch not found returns 404", async () => {
    const app = await buildApp();
    currentDeviceSnap = { exists: true, data: {}, batches: { "batch-1": { exists: false } } };

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches/device-1/batch-1",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "Batch not found." });
    await app.close();
  });

  it("resource existence: batch payload missing returns 404", async () => {
    const app = await buildApp();
    currentDeviceSnap = { exists: true, data: {}, batches: { "batch-1": { exists: true, data: { count: 1 } } } };

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches/device-1/batch-1",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "Batch payload unavailable." });
    await app.close();
  });

  it("auth: forbidden device returns 403", async () => {
    const app = await buildApp();
    currentDeviceSnap = { exists: true, data: {}, batches: {} };
    mocks.userOwnsDevice.mockReturnValue(false);

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches/device-1/batch-1",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "forbidden", message: "You do not have access to this device." });
    await app.close();
  });

  it("error mapping: storage errors return 500", async () => {
    const app = await buildApp();
    currentDeviceSnap = {
      exists: true,
      data: {},
      batches: { "batch-1": { exists: true, data: { path: "ingest/device-1/batch-1.json" } } },
    };
    mocks.bucketDownload.mockRejectedValue(new Error("storage down"));

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches/device-1/batch-1",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "storage_error", message: "Unable to read batch payload." });
    await app.close();
  });

  it("rate limit: guard returns 429 with retry-after", async () => {
    const app = await buildApp();
    mocks.rateLimitOrThrow.mockImplementation(() => {
      throw new RateLimitError(8);
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/batches/device-1/batch-1",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("8");
    expect(res.json()).toEqual({ error: "rate_limited", retry_after: 8 });
    await app.close();
  });
});
