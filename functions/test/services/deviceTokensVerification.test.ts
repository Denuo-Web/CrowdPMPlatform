import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("verifyDeviceAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("re-checks shared token state on every verification and rejects a later revocation", async () => {
    process.env.DEVICE_TOKEN_ISSUER = "crowdpm";
    process.env.DEVICE_TOKEN_AUDIENCE = "crowdpm_device_api";

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
