import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminSubmissionsRoutes } from "../../src/routes/adminSubmissions.js";
import { toHttpError } from "../../src/lib/httpError.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  writeModerationAudit: vi.fn(),
}));

type BatchRecord = {
  id: string;
  data: Record<string, unknown>;
};

let batchRecords = new Map<string, BatchRecord>();

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
      if (limitValue !== null) records = records.slice(0, limitValue);
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

function makeDoc(id: string) {
  return {
    get: async () => {
      const record = batchRecords.get(id);
      return {
        id,
        exists: Boolean(record),
        data: () => record?.data ?? {},
        get: (field: string) => record?.data[field],
      };
    },
    set: async (payload: Record<string, unknown>, options?: { merge?: boolean }) => {
      const existing = batchRecords.get(id);
      const nextData = options?.merge
        ? { ...(existing?.data ?? {}), ...payload }
        : { ...payload };
      batchRecords.set(id, { id, data: nextData });
    },
  };
}

const mockDb = {
  collection: vi.fn((name: string) => {
    if (name !== "batches") throw new Error(`unexpected collection ${name}`);
    return {
      where: (...args: [string, string, unknown]) => makeQuery().where(...args),
      orderBy: (...args: unknown[]) => makeQuery().orderBy(...args),
      limit: (...args: [number]) => makeQuery().limit(...args),
      doc: (id: string) => makeDoc(id),
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
      "batch-1",
      {
        id: "batch-1",
        data: {
          deviceId: "device-1",
          deviceNameSnapshot: "North",
          count: 2,
          processedAt: "2024-01-01T00:00:00.000Z",
          visibility: "public",
          moderationState: "approved",
        },
      },
    ],
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
  it("allows moderators to list root batch submissions", async () => {
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
    });
    await app.close();
  });
});

describe("PATCH /v1/admin/submissions/:deviceId/:batchId", () => {
  it("allows moderators to quarantine a root batch and writes audit", async () => {
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
      targetId: "batches/batch-1",
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
    });
    await app.close();
  });
});
