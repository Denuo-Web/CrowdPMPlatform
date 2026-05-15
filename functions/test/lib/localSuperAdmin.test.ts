import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLocalSuperAdmin } from "../../src/lib/localSuperAdmin.js";

const mocks = vi.hoisted(() => ({
  getUserByEmail: vi.fn(),
  createUser: vi.fn(),
  setCustomUserClaims: vi.fn(),
}));

vi.mock("../../src/lib/fire.js", () => ({
  app: () => ({
    auth: () => mocks,
  }),
}));

const originalAuthEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const originalFunctionsEmulator = process.env.FUNCTIONS_EMULATOR;

beforeEach(() => {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  delete process.env.FUNCTIONS_EMULATOR;
  mocks.getUserByEmail.mockReset();
  mocks.createUser.mockReset();
  mocks.setCustomUserClaims.mockReset();
});

afterEach(() => {
  if (originalAuthEmulatorHost === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  else process.env.FIREBASE_AUTH_EMULATOR_HOST = originalAuthEmulatorHost;
  if (originalFunctionsEmulator === undefined) delete process.env.FUNCTIONS_EMULATOR;
  else process.env.FUNCTIONS_EMULATOR = originalFunctionsEmulator;
  vi.clearAllMocks();
});

describe("ensureLocalSuperAdmin", () => {
  it("creates the default emulator super admin when missing", async () => {
    mocks.getUserByEmail.mockRejectedValue(Object.assign(new Error("not found"), { code: "auth/user-not-found" }));
    mocks.createUser.mockResolvedValue({ uid: "admin-1", customClaims: undefined });

    await ensureLocalSuperAdmin();

    expect(mocks.getUserByEmail).toHaveBeenCalledWith("admin@crowdpm.dev");
    expect(mocks.createUser).toHaveBeenCalledWith({
      email: "admin@crowdpm.dev",
      password: "crowdpm-dev",
      emailVerified: true,
      displayName: "CrowdPM Admin",
      disabled: false,
    });
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith("admin-1", {
      roles: ["super_admin"],
    });
  });

  it("refreshes super admin claims for an existing emulator user", async () => {
    mocks.getUserByEmail.mockResolvedValue({
      uid: "admin-1",
      customClaims: { organization: "crowdpm", roles: ["moderator"], admin: false },
    });

    await ensureLocalSuperAdmin();

    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.setCustomUserClaims).toHaveBeenCalledWith("admin-1", {
      organization: "crowdpm",
      roles: ["super_admin"],
    });
  });

  it("does nothing outside the emulator", async () => {
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FUNCTIONS_EMULATOR;

    await ensureLocalSuperAdmin();

    expect(mocks.getUserByEmail).not.toHaveBeenCalled();
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.setCustomUserClaims).not.toHaveBeenCalled();
  });
});
