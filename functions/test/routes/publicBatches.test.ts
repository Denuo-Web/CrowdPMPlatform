import { gzipSync } from "node:zlib";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicBatchesRoutes } from "../../src/routes/publicBatches.js";
import { toHttpError } from "../../src/lib/httpError.js";

type BatchRecord = {
  id: string;
  data: Record<string, unknown>;
};

let batchRecords = new Map<string, BatchRecord>();
let appSettings = new Map<string, Record<string, unknown>>();
let storagePayloads = new Map<string, Buffer>();

function gzipPayload(payload: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
}

function makeQuery() {
  const filters: Array<{ field: string; value: unknown }> = [];
  let limitValue: number | null = null;
  const query = {
    where: vi.fn((field: string, _op: string, value: unknown) => {
      filters.push({ field, value });
      return query;
    }),
    orderBy: vi.fn(() => query),
    limit: vi.fn((value: number) => {
      limitValue = value;
      return query;
    }),
    get: async () => {
      let records = Array.from(batchRecords.values())
        .filter((record) => filters.every((filter) => record.data[filter.field] === filter.value))
        .sort((a, b) => String(b.data.processedAt).localeCompare(String(a.data.processedAt)));
      if (limitValue !== null) {
        records = records.slice(0, limitValue);
      }
      return {
        docs: records.map((record) => ({
          id: record.id,
          data: () => record.data,
          get: (field: string) => record.data[field],
        })),
      };
    },
  };
  return query;
}

const mockDb = {
  collection: vi.fn((name: string) => {
    if (name === "appSettings") {
      return {
        doc: (id: string) => ({
          get: async () => {
            const record = appSettings.get(id);
            return {
              exists: Boolean(record),
              data: () => record ?? {},
              get: (field: string) => record?.[field],
            };
          },
        }),
      };
    }
    if (name !== "batches") throw new Error(`unexpected collection ${name}`);
    return {
      where: (...args: [string, string, unknown]) => makeQuery().where(...args),
      doc: (id: string) => ({
        get: async () => {
          const record = batchRecords.get(id);
          return {
            id,
            exists: Boolean(record),
            data: () => record?.data ?? {},
            get: (field: string) => record?.data[field],
          };
        },
      }),
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
  })),
};

vi.mock("../../src/lib/fire.js", () => ({
  db: () => mockDb,
  bucket: () => mockBucket,
}));

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, req, rep) => {
    const normalized = toHttpError(err);
    if (normalized.headers) rep.headers(normalized.headers);
    rep.code(normalized.statusCode).send(normalized.body);
  });
  await app.register(publicBatchesRoutes);
  await app.ready();
  return app;
}

function seedBatch(id: string, overrides?: Record<string, unknown>) {
  const storagePath = `ingest/v2/user-1/device-1/${id}.json.gz`;
  batchRecords.set(id, {
    id,
    data: {
      batchId: id,
      deviceId: "device-1",
      deviceNameSnapshot: "North",
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

beforeEach(() => {
  batchRecords = new Map();
  appSettings = new Map([
    ["demoBatch", { deviceId: "device-1", batchId: "batch-approved" }],
  ]);
  storagePayloads = new Map();
  seedBatch("batch-approved");
  seedBatch("batch-private", { visibility: "private", processedAt: "2024-01-03T00:00:00.000Z" });
  seedBatch("batch-quarantined", {
    deviceId: "device-2",
    deviceNameSnapshot: "South",
    visibility: "public",
    moderationState: "quarantined",
    processedAt: "2024-01-04T00:00:00.000Z",
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/public/demo-batch", () => {
  it("returns the configured approved public batch", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/public/demo-batch" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      batchId: "batch-approved",
      deviceId: "device-1",
      visibility: "public",
      moderationState: "approved",
    });
    await app.close();
  });

  it("returns null when the configured batch is not public", async () => {
    appSettings.set("demoBatch", { deviceId: "device-1", batchId: "batch-private" });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/public/demo-batch" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    await app.close();
  });
});

describe("GET /v1/public/batches", () => {
  it("returns only approved public root batches", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/public/batches" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      {
        batchId: "batch-approved",
        deviceId: "device-1",
        deviceName: "North",
        count: 1,
        processedAt: "2024-01-02T00:00:00.000Z",
        visibility: "public",
        moderationState: "approved",
      },
    ]);
    await app.close();
  });
});

describe("GET /v1/public/batches/:deviceId/:batchId", () => {
  it("returns gzipped detail for approved public batches", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/public/batches/device-1/batch-approved" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      batchId: "batch-approved",
      deviceId: "device-1",
      visibility: "public",
      moderationState: "approved",
      points: [expect.objectContaining({ value: 11 })],
    }));
    await app.close();
  });

  it("returns 404 for non-approved/non-public batches", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/public/batches/device-2/batch-quarantined" });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: "not_found",
      message: "Batch not found.",
    });
    await app.close();
  });
});
