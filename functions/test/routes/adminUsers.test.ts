import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminUsersRoutes } from "../../src/routes/adminUsers.js";
import { toHttpError } from "../../src/lib/httpError.js";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  writeModerationAudit: vi.fn(),
  revokeTokensForDevice: vi.fn(),
}));

type UserRecord = {
  uid: string;
  email?: string;
  disabled: boolean;
  customClaims?: Record<string, unknown>;
  metadata: {
    creationTime?: string;
    lastSignInTime?: string;
  };
};

let users = new Map<string, UserRecord>();
let revokedRefreshTokens = new Set<string>();
let deviceOwnership = new Map<string, string[]>();

function cloneUser(user: UserRecord): UserRecord {
  return JSON.parse(JSON.stringify(user));
}

const authApi = {
  listUsers: vi.fn(async (maxResults: number) => ({
    users: Array.from(users.values()).slice(0, maxResults).map((entry) => cloneUser(entry)),
    pageToken: undefined,
  })),
  getUser: vi.fn(async (uid: string) => {
    const record = users.get(uid);
    if (!record) {
      throw Object.assign(new Error("user not found"), { code: "auth/user-not-found", statusCode: 404 });
    }
    return cloneUser(record);
  }),
  updateUser: vi.fn(async (uid: string, payload: { disabled?: boolean }) => {
    const existing = users.get(uid);
    if (!existing) throw new Error("missing user");
    users.set(uid, { ...existing, disabled: payload.disabled ?? existing.disabled });
    return cloneUser(users.get(uid)!);
  }),
  setCustomUserClaims: vi.fn(async (uid: string, claims: Record<string, unknown> | null) => {
    const existing = users.get(uid);
    if (!existing) throw new Error("missing user");
    users.set(uid, { ...existing, customClaims: claims ?? undefined });
  }),
  revokeRefreshTokens: vi.fn(async (uid: string) => {
    revokedRefreshTokens.add(uid);
  }),
};

const mockDb = {
  collection: vi.fn((name: string) => {
    if (name !== "devices") throw new Error(`unexpected collection ${name}`);
    return {
      where: (field: string, op: string, value: string) => ({
        get: async () => {
          if (op !== "==" && op !== "array-contains") {
            throw new Error("unsupported query");
          }
          const matchingIds = Array.from(deviceOwnership.entries())
            .filter(([, owners]) => {
              if (field === "ownerUserId" && op === "==") {
                return owners[0] === value;
              }
              if (field === "ownerUserIds" && op === "array-contains") {
                return owners.includes(value);
              }
              return false;
            })
            .map(([deviceId]) => deviceId);

          return {
            docs: matchingIds.map((deviceId) => ({ id: deviceId })),
          };
        },
      }),
    };
  }),
};

vi.mock("../../src/lib/fire.js", () => ({
  app: () => ({ auth: () => authApi }),
  db: () => mockDb,
}));

vi.mock("../../src/auth/firebaseVerify.js", () => ({
  requireUser: mocks.requireUser,
}));

vi.mock("../../src/lib/moderationAudit.js", () => ({
  writeModerationAudit: mocks.writeModerationAudit,
}));

vi.mock("../../src/services/deviceTokens.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/services/deviceTokens.js")>();
  return {
    ...actual,
    revokeTokensForDevice: mocks.revokeTokensForDevice,
  };
});

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, req, rep) => {
    const normalized = toHttpError(err);
    if (normalized.headers) rep.headers(normalized.headers);
    rep.code(normalized.statusCode).send(normalized.body);
  });
  await app.register(adminUsersRoutes);
  await app.ready();
  return app;
}

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.writeModerationAudit.mockReset();
  mocks.revokeTokensForDevice.mockReset();
  authApi.listUsers.mockClear();
  authApi.getUser.mockClear();
  authApi.updateUser.mockClear();
  authApi.setCustomUserClaims.mockClear();
  authApi.revokeRefreshTokens.mockClear();

  revokedRefreshTokens = new Set();
  deviceOwnership = new Map([
    ["device-1", ["user-1"]],
    ["device-2", ["user-1", "user-2"]],
  ]);

  users = new Map([
    [
      "user-1",
      {
        uid: "user-1",
        email: "user-1@example.com",
        disabled: false,
        customClaims: { roles: ["moderator"] },
        metadata: {
          creationTime: "2024-01-01T00:00:00.000Z",
          lastSignInTime: "2024-01-02T00:00:00.000Z",
        },
      },
    ],
    [
      "admin-1",
      {
        uid: "admin-1",
        email: "admin@example.com",
        disabled: false,
        customClaims: { admin: true, roles: ["super_admin"] },
        metadata: {
          creationTime: "2024-01-01T00:00:00.000Z",
          lastSignInTime: "2024-01-02T00:00:00.000Z",
        },
      },
    ],
  ]);

  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer super") return { uid: "admin-1", roles: ["super_admin"], admin: true };
    if (auth === "Bearer mod") return { uid: "mod-1", roles: ["moderator"] };
    return { uid: "user-x", roles: [] };
  });

  mocks.writeModerationAudit.mockResolvedValue(undefined);
  mocks.revokeTokensForDevice.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /v1/admin/users", () => {
  it("allows super admins to list users", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/admin/users",
      headers: { authorization: "Bearer super" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.users).toHaveLength(2);
    expect(body.users[0]).toEqual(expect.objectContaining({
      uid: "user-1",
      roles: ["moderator"],
      disabled: false,
    }));
    await app.close();
  });
});

describe("PATCH /v1/admin/users/:uid", () => {
  it("allows super admins to disable users and rotate claims", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/users/user-1",
      headers: { authorization: "Bearer super" },
      payload: { roles: ["moderator"], disabled: true, reason: "abuse" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(expect.objectContaining({
      uid: "user-1",
      disabled: true,
      roles: ["moderator"],
    }));
    expect(authApi.setCustomUserClaims).toHaveBeenCalled();
    expect(authApi.updateUser).toHaveBeenCalledWith("user-1", { disabled: true });
    expect(authApi.revokeRefreshTokens).toHaveBeenCalledWith("user-1");
    expect(mocks.revokeTokensForDevice).toHaveBeenCalledWith("device-1");
    expect(mocks.revokeTokensForDevice).toHaveBeenCalledWith("device-2");
    expect(mocks.writeModerationAudit).toHaveBeenCalledWith(expect.objectContaining({
      targetType: "user",
      targetId: "user-1",
    }));
    await app.close();
  });

  it("denies moderators from accessing user management endpoints", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "PATCH",
      url: "/v1/admin/users/user-1",
      headers: { authorization: "Bearer mod" },
      payload: { roles: ["moderator"] },
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
