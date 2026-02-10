import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userSettingsRoutes } from "../../src/routes/userSettings.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rateLimitOrThrow: vi.fn(),
}));

let dbStore = new Map<string, Record<string, unknown>>();
let nextGetError: Error | null = null;

function makeDocRef(path: string) {
  return {
    get: vi.fn(async () => {
      if (nextGetError) throw nextGetError;
      const data = dbStore.get(path);
      return {
        exists: Boolean(data),
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

const mockDb = {
  collection: vi.fn((name: string) => ({
    doc: (id: string) => makeDocRef(`${name}/${id}`),
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
    expect(res.json()).toEqual({ defaultBatchVisibility: "private", interleavedRendering: false });
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
    expect(res.json()).toEqual({ defaultBatchVisibility: "public", interleavedRendering: true });
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
      message: "Provide defaultBatchVisibility or interleavedRendering to update.",
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

  it("auth: missing token returns 401", async () => {
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/v1/user/settings" });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
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
    expect(res.json()).toEqual({ error: "db_down" });
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
