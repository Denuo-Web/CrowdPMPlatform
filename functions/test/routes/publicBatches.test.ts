import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicBatchesRoutes } from "../../src/routes/publicBatches.js";
import { toHttpError } from "../../src/lib/httpError.js";

type BatchRecord = {
  deviceId: string;
  batchId: string;
  data: Record<string, unknown>;
};

let batchRecords = new Map<string, BatchRecord>();
let deviceNames = new Map<string, string>();
let storagePayloads = new Map<string, unknown>();

function batchKey(deviceId: string, batchId: string): string {
  return `${deviceId}/${batchId}`;
}

function makeBatchQueryDoc(record: BatchRecord) {
  return {
    id: record.batchId,
    data: () => ({ ...record.data, deviceId: record.deviceId }),
    ref: {
      parent: {
        parent: { id: record.deviceId },
      },
    },
  };
}

const mockDb = {
  collectionGroup: vi.fn(() => {
    const filters: Array<{ field: string; value: unknown }> = [];
    const query = {
      where: vi.fn((field: string, _op: string, value: unknown) => {
        filters.push({ field, value });
        return query;
      }),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: async () => {
        const docs = Array.from(batchRecords.values())
          .filter((record) => filters.every((filter) => record.data[filter.field] === filter.value))
          .map((record) => makeBatchQueryDoc(record));
        return { docs };
      },
    };
    return query;
  }),
  collection: vi.fn((name: string) => {
    if (name !== "devices") throw new Error(`unexpected collection ${name}`);
    return {
      doc: (deviceId: string) => ({
        get: async () => ({
          exists: deviceNames.has(deviceId),
          id: deviceId,
          get: (field: string) => (field === "name" ? deviceNames.get(deviceId) : undefined),
        }),
        collection: (child: string) => {
          if (child !== "batches") throw new Error(`unexpected child ${child}`);
          return {
            doc: (batchId: string) => ({
              get: async () => {
                const record = batchRecords.get(batchKey(deviceId, batchId));
                return {
                  exists: Boolean(record),
                  data: () => (record ? { ...record.data, deviceId: record.deviceId } : {}),
                };
              },
            }),
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
      return [Buffer.from(JSON.stringify(payload), "utf8")];
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

beforeEach(() => {
  batchRecords = new Map([
    [
      batchKey("device-1", "batch-approved"),
      {
        deviceId: "device-1",
        batchId: "batch-approved",
        data: {
          path: "ingest/device-1/batch-approved.json",
          count: 1,
          processedAt: "2024-01-02T00:00:00.000Z",
          visibility: "public",
          moderationState: "approved",
        },
      },
    ],
    [
      batchKey("device-1", "batch-private"),
      {
        deviceId: "device-1",
        batchId: "batch-private",
        data: {
          path: "ingest/device-1/batch-private.json",
          count: 1,
          processedAt: "2024-01-03T00:00:00.000Z",
          visibility: "private",
          moderationState: "approved",
        },
      },
    ],
    [
      batchKey("device-2", "batch-quarantined"),
      {
        deviceId: "device-2",
        batchId: "batch-quarantined",
        data: {
          path: "ingest/device-2/batch-quarantined.json",
          count: 1,
          processedAt: "2024-01-04T00:00:00.000Z",
          visibility: "public",
          moderationState: "quarantined",
        },
      },
    ],
  ]);

  deviceNames = new Map([
    ["device-1", "North"],
    ["device-2", "South"],
  ]);

  storagePayloads = new Map([
    [
      "ingest/device-1/batch-approved.json",
      {
        points: [{
          device_id: "device-1",
          pollutant: "pm25",
          value: 11,
          unit: "\u00b5g/m\u00b3",
          lat: 45,
          lon: -122,
          timestamp: "2024-01-02T00:00:00.000Z",
        }],
      },
    ],
  ]);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/public/batches", () => {
  it("returns only approved public batches", async () => {
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
  it("returns detail for approved public batches", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/public/batches/device-1/batch-approved" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      batchId: "batch-approved",
      deviceId: "device-1",
      visibility: "public",
      moderationState: "approved",
      points: expect.any(Array),
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
      error_description: "Batch not found.",
    });
    await app.close();
  });
});
