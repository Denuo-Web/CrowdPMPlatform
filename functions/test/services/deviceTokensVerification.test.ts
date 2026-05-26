import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  importSPKI: vi.fn(),
  importPKCS8: vi.fn(),
  tokenDocGet: vi.fn(),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: mocks.jwtVerify,
    importSPKI: mocks.importSPKI,
    importPKCS8: mocks.importPKCS8,
  };
});

vi.mock("../../src/lib/fire.js", () => ({
  db: () => ({
    collection: (name: string) => {
      if (name !== "device_tokens") {
        throw new Error(`unexpected collection ${name}`);
      }
      return {
        doc: (id: string) => {
          void id;
          return {
          get: mocks.tokenDocGet,
          };
        },
      };
    },
  }),
}));

const testPrivateKeyFile = join(tmpdir(), `crowdpm-device-token-verification-${process.pid}.pem`);
const originalEnv = {
  DEVICE_TOKEN_AUDIENCE: process.env.DEVICE_TOKEN_AUDIENCE,
  DEVICE_TOKEN_ISSUER: process.env.DEVICE_TOKEN_ISSUER,
  DEVICE_TOKEN_PRIVATE_KEY: process.env.DEVICE_TOKEN_PRIVATE_KEY,
  DEVICE_TOKEN_PRIVATE_KEY_FILE: process.env.DEVICE_TOKEN_PRIVATE_KEY_FILE,
};

function restoreEnv(name: keyof typeof originalEnv): void {
  const originalValue = originalEnv[name];
  if (originalValue === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = originalValue;
}

describe("verifyDeviceAccessToken", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.DEVICE_TOKEN_PRIVATE_KEY;
    process.env.DEVICE_TOKEN_PRIVATE_KEY_FILE = testPrivateKeyFile;
    process.env.DEVICE_TOKEN_ISSUER = "crowdpm";
    process.env.DEVICE_TOKEN_AUDIENCE = "crowdpm_device_api";
    rmSync(testPrivateKeyFile, { force: true });
    mocks.importSPKI.mockResolvedValue({ key: "verification-key" });
    mocks.importPKCS8.mockResolvedValue({ key: "signing-key" });
    mocks.jwtVerify.mockResolvedValue({
      payload: {
        kind: "device_access",
        device_id: "device-123",
        acc_id: "user-123",
        cnf: { jkt: "jkt-123" },
        jti: "token-jti-123",
      },
    });
  });

  afterEach(() => {
    rmSync(testPrivateKeyFile, { force: true });
    restoreEnv("DEVICE_TOKEN_AUDIENCE");
    restoreEnv("DEVICE_TOKEN_ISSUER");
    restoreEnv("DEVICE_TOKEN_PRIVATE_KEY");
    restoreEnv("DEVICE_TOKEN_PRIVATE_KEY_FILE");
  });

  it("re-checks shared token state on every verification and rejects a later revocation", async () => {
    const { verifyDeviceAccessToken } = await import("../../src/services/deviceTokens.js");

    mocks.tokenDocGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          revoked: false,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          revoked: true,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      });

    await expect(verifyDeviceAccessToken("raw-token")).resolves.toMatchObject({
      device_id: "device-123",
      jti: "token-jti-123",
    });
    await expect(verifyDeviceAccessToken("raw-token")).rejects.toThrow("Device token revoked");
    expect(mocks.tokenDocGet).toHaveBeenCalledTimes(2);
  });
});
