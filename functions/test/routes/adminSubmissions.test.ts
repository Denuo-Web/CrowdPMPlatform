import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSubmissionsRoutes } from "../../src/routes/adminSubmissions.js";
import { toHttpError } from "../../src/lib/httpError.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  writeModerationAudit: vi.fn(),
}));

type BatchRecord = {
  deviceId: string;
  batchId: string;
  data: Record<string, unknown>;
};

type DeviceRecord = {
  name?: string;
};

let batchRecords = new Map<string, BatchRecord>();
let deviceRecords = new Map<string, DeviceRecord>();

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
    const query = {
      where: vi.fn(() => query),
      orderBy: vi.fn(() => query),
      limit: vi.fn(() => query),
      get: async () => ({ docs: Array.from(batchRecords.values()).map((record) => makeBatchQueryDoc(record)) }),
    };
    return query;
  }),
  collection: vi.fn((name: string) => {
    if (name !== "devices") throw new Error(`unexpected collection ${name}`);
    return {
      doc: (deviceId: string) => ({
        get: async () => {
          const device = deviceRecords.get(deviceId);
          return {
            id: deviceId,
            exists: Boolean(device),
            get: (field: string) => device?.[field as keyof DeviceRecord],
            data: () => device ?? {},
          };
        },
        collection: (child: string) => {
          if (child !== "batches") throw new Error(`unexpected child collection ${child}`);
          return {
            doc: (batchId: string) => ({
              get: async () => {
                const record = batchRecords.get(batchKey(deviceId, batchId));
                return {
                  exists: Boolean(record),
                  data: () => (record ? { ...record.data, deviceId: record.deviceId } : {}),
                };
              },
              set: async (payload: Record<string, unknown>, options?: { merge?: boolean }) => {
                const key = batchKey(deviceId, batchId);
                const existing = batchRecords.get(key);
                if (options?.merge && existing) {
                  batchRecords.set(key, {
                    ...existing,
                    data: { ...existing.data, ...payload },
                  });
                  return;
                }
                batchRecords.set(key, {
                  deviceId,
                  batchId,
                  data: { ...(existing?.data ?? {}), ...payload },
                });
              },
            }),
          };
        },
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
  await app.register(adminSubmissionsRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.writeModerationAudit.mockReset();

  batchRecords = new Map([
    [
      batchKey("device-1", "batch-1"),
      {
        deviceId: "device-1",
        batchId: "batch-1",
        data: {
          count: 2,
          processedAt: "2024-01-01T00:00:00.000Z",
          visibility: "public",
          moderationState: "approved",
        },
      },
    ],
  ]);
  deviceRecords = new Map([
    ["device-1", { name: "North" }],
  ]);

  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer mod") return { uid: "mod-1", roles: ["moderator"] };
    if (auth === "Bearer super") return { uid: "admin-1", roles: ["super_admin"] };
    return { uid: "user-1", roles: [] };
  });
  mocks.writeModerationAudit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/admin/submissions", () => {
  it("allows moderators to list submissions", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/submissions",
      headers: { authorization: "Bearer mod" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      submissions: [
        {
          batchId: "batch-1",
          deviceId: "device-1",
          deviceName: "North",
          count: 2,
          processedAt: "2024-01-01T00:00:00.000Z",
          visibility: "public",
          moderationState: "approved",
          moderationReason: null,
          moderatedBy: null,
          moderatedAt: null,
        },
      ],
    });
    await app.close();
  });

  it("denies non-moderators", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/submissions",
      headers: { authorization: "Bearer user" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "forbidden",
      message: "You do not have permission to access this resource.",
      error_description: "You do not have permission to access this resource.",
    });
    await app.close();
  });
});

describe("PATCH /v1/admin/submissions/:deviceId/:batchId", () => {
  it("allows moderators to quarantine a batch and writes audit", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/submissions/device-1/batch-1",
      headers: { authorization: "Bearer mod" },
      payload: { moderationState: "quarantined", reason: "spam source" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      batchId: "batch-1",
      deviceId: "device-1",
      moderationState: "quarantined",
      moderationReason: "spam source",
      moderatedBy: "mod-1",
    }));
    expect(mocks.writeModerationAudit).toHaveBeenCalledWith(expect.objectContaining({
      targetType: "submission",
      targetId: "devices/device-1/batches/batch-1",
      action: "submission.quarantined",
    }));
    await app.close();
  });

  it("returns 404 when target batch is missing", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/submissions/device-404/batch-404",
      headers: { authorization: "Bearer mod" },
      payload: { moderationState: "quarantined" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: "not_found",
      message: "Batch not found.",
      error_description: "Batch not found.",
    });
    await app.close();
  });
});
