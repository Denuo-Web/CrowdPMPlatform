import { gzipSync } from "node:zlib";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { batchesRoutes } from "../../src/routes/batches.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { withRateLimitsEnabled } from "../helpers/rateLimitEnv.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rateLimitOrThrow: vi.fn(),
  bucketDelete: vi.fn(),
}));

type BatchRecord = {
  id: string;
  data: Record<string, unknown>;
};

let batchRecords = new Map<string, BatchRecord>();
let storagePayloads = new Map<string, Buffer>();
let batchSetCalls: Array<{ batchId: string; payload: Record<string, unknown>; merge: boolean }> = [];
let batchDeleteCalls: string[] = [];

function gzipPayload(payload: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
}

function makeBatchDoc(id: string) {
  const resolve = () => batchRecords.get(id);
  const set = async (payload: Record<string, unknown>, options?: { merge?: boolean }) => {
    const merge = Boolean(options?.merge);
    batchSetCalls.push({ batchId: id, payload, merge });
    const existing = resolve();
    const nextData = merge ? { ...(existing?.data ?? {}), ...payload } : { ...payload };
    batchRecords.set(id, { id, data: nextData });
  };
  const deleteDoc = async () => {
    batchDeleteCalls.push(id);
    batchRecords.delete(id);
  };
  return {
    id,
    ref: {
      set,
      delete: deleteDoc,
    },
    set,
    delete: deleteDoc,
    get: async () => {
      const record = resolve();
      return {
        id,
        exists: Boolean(record),
        data: () => record?.data ?? {},
        get: (field: string) => record?.data[field],
        ref: makeBatchDoc(id).ref,
      };
    },
  };
}

function makeQuery() {
  const filters: Array<{ field: string; op: string; value: unknown }> = [];
  let limitValue: number | null = null;
  const query = {
    where: vi.fn((field: string, op: string, value: unknown) => {
      filters.push({ field, op, value });
      return query;
    }),
    orderBy: vi.fn(() => query),
    limit: vi.fn((value: number) => {
      limitValue = value;
      return query;
    }),
    get: vi.fn(async () => {
      let records = Array.from(batchRecords.values()).filter((record) => filters.every((filter) => {
        const actual = record.data[filter.field];
        if (filter.op === "array-contains") {
          return Array.isArray(actual) && actual.includes(filter.value);
        }
        if (filter.op === "==") {
          return actual === filter.value;
        }
        throw new Error(`unexpected op ${filter.op}`);
      }));
      records = records.sort((a, b) => String(b.data.processedAt).localeCompare(String(a.data.processedAt)));
      if (limitValue !== null) {
        records = records.slice(0, limitValue);
      }
      return {
        docs: records.map((record) => ({
          id: record.id,
          data: () => record.data,
          get: (field: string) => record.data[field],
          ref: makeBatchDoc(record.id).ref,
        })),
      };
    }),
  };
  return query;
}

const mockDb = {
  collection: vi.fn((name: string) => {
    if (name !== "batches") throw new Error(`unexpected collection ${name}`);
    return {
      doc: (id: string) => makeBatchDoc(id),
      where: (...args: [string, string, unknown]) => makeQuery().where(...args),
      orderBy: (...args: unknown[]) => makeQuery().orderBy(...args),
      limit: (...args: [number]) => makeQuery().limit(...args),
    };
  }),
};

const mockBucket = {
  file: vi.fn((path: string) => ({
    download: async () => {
      const payload = storagePayloads.get(path);
      if (!payload) throw new Error("missing payload");
      return [payload];
    },
    delete: mocks.bucketDelete,
  })),
};

vi.mock("../../src/lib/fire.js", () => ({
  db: () => mockDb,
  bucket: () => mockBucket,
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

function seedBatch(id: string, overrides?: Record<string, unknown>) {
  const storagePath = `ingest/v2/user-123/device-1/${id}.json.gz`;
  batchRecords.set(id, {
    id,
    data: {
      batchId: id,
      deviceId: "device-1",
      deviceNameSnapshot: "North",
      ownerUserId: "user-123",
      ownerUserIds: ["user-123"],
      storagePath,
      count: 1,
      processedAt: "2024-01-02T00:00:00.000Z",
      visibility: "public",
      moderationState: "approved",
      ...overrides,
    },
  });
  storagePayloads.set(storagePath, gzipPayload({
    points: [{
      device_id: "device-1",
      pollutant: "pm25",
      value: 11,
      unit: "\u00b5g/m\u00b3",
      lat: 45,
      lon: -122,
      timestamp: "2024-01-02T00:00:00.000Z",
    }],
  }));
}

withRateLimitsEnabled();

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.rateLimitOrThrow.mockReset();
  mocks.bucketDelete.mockReset();
  batchRecords = new Map();
  storagePayloads = new Map();
  batchSetCalls = [];
  batchDeleteCalls = [];

  mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  mocks.bucketDelete.mockResolvedValue(undefined);
  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer mod") return { uid: "user-123", roles: ["moderator"] };
    return { uid: "user-123", email: "user@example.com", roles: [] };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/batches", () => {
  it("returns owned root batch summaries", async () => {
    const app = await buildApp();
    seedBatch("batch-a", { processedAt: "2024-01-01T00:00:00.000Z" });
    seedBatch("batch-b", { processedAt: "2024-01-03T00:00:00.000Z", visibility: "private" });
    seedBatch("batch-other", { ownerUserId: "other", ownerUserIds: ["other"] });

    const res = await app.inject({ method: "GET", url: "/v1/batches", headers: { authorization: "Bearer ok" } });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((row: { batchId: string }) => row.batchId)).toEqual(["batch-b", "batch-a"]);
    expect(res.json()[0]).toMatchObject({
      deviceId: "device-1",
      deviceName: "North",
      visibility: "private",
    });
    await app.close();
  });

  it("hides quarantined batches for non-moderators", async () => {
    const app = await buildApp();
    seedBatch("batch-approved");
    seedBatch("batch-quarantined", { moderationState: "quarantined", processedAt: "2024-01-04T00:00:00.000Z" });

    const res = await app.inject({ method: "GET", url: "/v1/batches", headers: { authorization: "Bearer ok" } });

    expect(res.statusCode).toBe(200);
    expect(res.json().map((row: { batchId: string }) => row.batchId)).toEqual(["batch-approved"]);
    await app.close();
  });
});

describe("GET /v1/batches/:deviceId/:batchId", () => {
  it("returns gzipped batch detail payload", async () => {
    const app = await buildApp();
    seedBatch("batch-1");

    const res = await app.inject({ method: "GET", url: "/v1/batches/device-1/batch-1", headers: { authorization: "Bearer ok" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      batchId: "batch-1",
      deviceId: "device-1",
      points: [expect.objectContaining({ value: 11 })],
    });
    await app.close();
  });

  it("rejects callers that do not own the batch", async () => {
    const app = await buildApp();
    seedBatch("batch-1", { ownerUserId: "other", ownerUserIds: ["other"] });

    const res = await app.inject({ method: "GET", url: "/v1/batches/device-1/batch-1", headers: { authorization: "Bearer ok" } });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "forbidden" });
    await app.close();
  });
});

describe("PATCH /v1/batches/:deviceId/:batchId", () => {
  it("updates visibility on the root batch document", async () => {
    const app = await buildApp();
    seedBatch("batch-1", { visibility: "private" });

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/batches/device-1/batch-1",
      headers: { authorization: "Bearer ok" },
      payload: { visibility: "public" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ batchId: "batch-1", visibility: "public" });
    expect(batchSetCalls).toEqual([
      {
        batchId: "batch-1",
        payload: expect.objectContaining({ visibility: "public", updatedAt: expect.any(Date) }),
        merge: true,
      },
    ]);
    await app.close();
  });
});

describe("DELETE /v1/batches/:deviceId/:batchId", () => {
  it("deletes storage payload and root batch metadata", async () => {
    const app = await buildApp();
    seedBatch("batch-1");

    const res = await app.inject({ method: "DELETE", url: "/v1/batches/device-1/batch-1", headers: { authorization: "Bearer ok" } });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "deleted", deviceId: "device-1", batchId: "batch-1" });
    expect(mocks.bucketDelete).toHaveBeenCalledWith({ ignoreNotFound: true });
    expect(batchDeleteCalls).toEqual(["batch-1"]);
    await app.close();
  });
});
