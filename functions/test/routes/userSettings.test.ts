import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userSettingsRoutes } from "../../src/routes/userSettings.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";
import { withRateLimitsEnabled } from "../helpers/rateLimitEnv.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rateLimitOrThrow: vi.fn(),
}));

let dbStore = new Map<string, Record<string, unknown>>();
let nextGetError: Error | null = null;

const defaultTheme = {
  appearance: "dark",
  accentColor: "iris",
  grayColor: "auto",
  panelBackground: "translucent",
  radius: "full",
  scaling: "100%",
};

const expectedFreeSubscription = {
  planId: "free_community",
  label: "Free / Community",
  source: "free",
  status: "active",
  billingInterval: null,
  canManageBilling: false,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  videoDownloadAccess: "preview_watermarked",
  limits: {
    maxActiveDevices: 2,
    maxStoredBatchesTotal: 100,
    maxStoredPrivateBatches: 0,
    monthlyPoints: 100_000,
    maxPointsPerBatch: 5_000,
  },
};

const expectedOffers = [
  {
    offerId: "pro_monthly",
    planId: "pro",
    action: "checkout",
    billingInterval: "month",
    currency: "usd",
    unitAmount: 900,
  },
  {
    offerId: "pro_yearly",
    planId: "pro",
    action: "checkout",
    billingInterval: "year",
    currency: "usd",
    unitAmount: 9900,
  },
  {
    offerId: "research_contact",
    planId: "research_lab",
    action: "contact",
    billingInterval: null,
    currency: null,
    unitAmount: null,
  },
];

function makeDocRef(path: string) {
  return {
    get: vi.fn(async () => {
      if (nextGetError) throw nextGetError;
      const data = dbStore.get(path);
      return {
        exists: Boolean(data),
        data: () => data,
        get: (field: string) => data?.[field],
      };
    }),
    set: vi.fn(async (payload: Record<string, unknown>, options?: { merge?: boolean }) => {
      const prev = dbStore.get(path) ?? {};
      const next = options?.merge ? { ...prev, ...payload } : { ...payload };
      dbStore.set(path, next);
    }),
  };
}

function matchesFilter(data: Record<string, unknown>, field: string, op: string, value: unknown): boolean {
  const actual = data[field];
  if (op === "array-contains") {
    return Array.isArray(actual) && actual.includes(value);
  }
  if (op === "==") {
    return actual === value;
  }
  throw new Error(`unsupported op ${op}`);
}

function queryDocs(collectionName: string, filters: Array<{ field: string; op: string; value: unknown }>) {
  return Array.from(dbStore.entries())
    .filter(([path]) => path.startsWith(`${collectionName}/`))
    .map(([path, data]) => ({
      id: path.slice(collectionName.length + 1),
      data,
    }))
    .filter(({ data }) => filters.every((filter) => matchesFilter(data, filter.field, filter.op, filter.value)));
}

function makeQuery(collectionName: string, filters: Array<{ field: string; op: string; value: unknown }> = []) {
  return {
    where: (field: string, op: string, value: unknown) => makeQuery(collectionName, [...filters, { field, op, value }]),
    get: async () => {
      const docs = queryDocs(collectionName, filters).map(({ id, data }) => ({
        id,
        data: () => data,
        get: (field: string) => data[field],
      }));
      return {
        docs,
        forEach: (callback: (doc: typeof docs[number]) => void) => docs.forEach(callback),
      };
    },
    count: () => ({
      get: async () => ({
        data: () => ({ count: queryDocs(collectionName, filters).length }),
      }),
    }),
  };
}

const mockDb = {
  collection: vi.fn((name: string) => ({
    doc: (id: string) => makeDocRef(`${name}/${id}`),
    where: (field: string, op: string, value: unknown) => makeQuery(name, [{ field, op, value }]),
  })),
};

vi.mock("../../src/lib/fire.js", () => ({
  db: () => mockDb,
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
  await app.register(userSettingsRoutes);
  await app.ready();
  return app;
}

withRateLimitsEnabled();

beforeEach(() => {
  dbStore = new Map<string, Record<string, unknown>>();
  nextGetError = null;
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

describe("user settings routes", () => {
  it("GET /v1/user/settings returns defaults when missing", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/user/settings",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      defaultBatchVisibility: "public",
      interleavedRendering: false,
      theme: defaultTheme,
      themeSaveUnlocked: false,
      subscription: expectedFreeSubscription,
      subscriptionOffers: expectedOffers,
    });
    await app.close();
  });

  it("GET /v1/user/settings reconciles usage from live devices and batches", async () => {
    const app = await buildApp();
    dbStore.set("accountEntitlements/user-123", {
      activeDeviceCount: 0,
      storedBatchCount: 0,
      storedPrivateBatchCount: 0,
    });
    dbStore.set("devices/device-1", {
      ownerUserIds: ["user-123"],
      status: "ACTIVE",
      registryStatus: "active",
    });
    dbStore.set("devices/device-2", {
      ownerUserIds: ["user-123"],
      status: "ACTIVE",
      registryStatus: "active",
    });
    dbStore.set("devices/device-revoked", {
      ownerUserIds: ["user-123"],
      status: "REVOKED",
      registryStatus: "revoked",
    });
    dbStore.set("batches/batch-1", {
      ownerUserIds: ["user-123"],
      visibility: "public",
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/user/settings",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      subscription: {
        ...expectedFreeSubscription,
        usage: {
          activeDevices: 2,
          storedBatchesTotal: 1,
          storedPrivateBatches: 0,
        },
      },
    });
    await app.close();
  });

  it("PUT /v1/user/settings updates visibility + interleaved", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/user/settings",
      payload: { defaultBatchVisibility: "public", interleavedRendering: "true" },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      defaultBatchVisibility: "public",
      interleavedRendering: true,
      theme: defaultTheme,
      themeSaveUnlocked: false,
      subscription: expectedFreeSubscription,
      subscriptionOffers: expectedOffers,
    });
    await app.close();
  });

  it("PUT /v1/user/settings updates and merges theme preferences", async () => {
    const app = await buildApp();
    dbStore.set("userSettings/user-123", {
      themeSaveUnlocked: true,
    });

    const res = await app.inject({
      method: "PUT",
      url: "/v1/user/settings",
      payload: {
        theme: {
          appearance: "light",
          accentColor: "blue",
          grayColor: "slate",
          panelBackground: "solid",
          radius: "medium",
          scaling: "105%",
        },
      },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      defaultBatchVisibility: "public",
      interleavedRendering: false,
      theme: {
        appearance: "light",
        accentColor: "blue",
        grayColor: "slate",
        panelBackground: "solid",
        radius: "medium",
        scaling: "105%",
      },
      themeSaveUnlocked: true,
      subscription: expectedFreeSubscription,
      subscriptionOffers: expectedOffers,
    });

    const partial = await app.inject({
      method: "PUT",
      url: "/v1/user/settings",
      payload: { theme: { accentColor: "teal" } },
      headers: { authorization: "Bearer ok" },
    });

    expect(partial.statusCode).toBe(200);
    expect(partial.json()).toMatchObject({
      theme: {
        appearance: "light",
        accentColor: "teal",
        grayColor: "slate",
        panelBackground: "solid",
        radius: "medium",
        scaling: "105%",
      },
      themeSaveUnlocked: true,
    });
    await app.close();
  });

  it("PUT /v1/user/settings rejects theme updates until theme saving is unlocked", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/user/settings",
      payload: { theme: { accentColor: "teal" } },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "theme_save_locked",
      message: "Purchase the theme save unlock to persist theme preferences.",
    });
    await app.close();
  });

  it("validation: missing fields returns 400", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/user/settings",
      payload: {},
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "missing_fields",
      message: "Provide defaultBatchVisibility, interleavedRendering, or theme to update.",
    });
    await app.close();
  });

  it("validation: invalid visibility returns 400", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/user/settings",
      payload: { defaultBatchVisibility: "hidden" },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_visibility",
      message: "defaultBatchVisibility must be 'public' or 'private'.",
    });
    await app.close();
  });

  it("validation: invalid interleavedRendering returns 400", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PUT",
      url: "/v1/user/settings",
      payload: { interleavedRendering: "maybe" },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_interleaved",
      message: "interleavedRendering must be boolean.",
    });
    await app.close();
  });

  it("validation: invalid theme returns 400", async () => {
    const app = await buildApp();
    dbStore.set("userSettings/user-123", {
      themeSaveUnlocked: true,
    });

    const res = await app.inject({
      method: "PUT",
      url: "/v1/user/settings",
      payload: { theme: { accentColor: "neon" } },
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_theme",
      message: "theme contains an unsupported value.",
    });
    await app.close();
  });

  it("auth: missing token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/user/settings" });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "unauthorized",
      message: "unauthorized",
    });
    await app.close();
  });

  it("error mapping: db error preserves status + body", async () => {
    const app = await buildApp();
    nextGetError = Object.assign(new Error("db_down"), { statusCode: 503, code: "db_down" });

    const res = await app.inject({
      method: "GET",
      url: "/v1/user/settings",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      error: "db_down",
      message: "db_down",
    });
    await app.close();
  });

  it("rate limit: guard returns 429 with retry-after", async () => {
    const app = await buildApp();
    mocks.rateLimitOrThrow.mockImplementation(() => {
      throw new RateLimitError(4);
    });

    const res = await app.inject({
      method: "GET",
      url: "/v1/user/settings",
      headers: { authorization: "Bearer ok" },
    });

    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("4");
    expect(res.json()).toEqual({ error: "rate_limited", retry_after: 4 });
    await app.close();
  });
});
