import crypto from "node:crypto";
import type { DeviceSecretRecord } from "../../src/lib/deviceSecrets.js";
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.CLAIM_PASSPHRASE_PEPPER = "unit-test-pepper";
process.env.DEVICE_SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const requireUserMock = vi.fn(async () => ({ uid: "user-1" }));

vi.mock("../../src/lib/fire.js", async () => {
  const testEnv = await import("../testUtils/testEnv.js");
  return {
    db: () => testEnv.mockFirestore,
    bucket: () => testEnv.mockBucket,
    app: () => ({ firestore: () => ({ recursiveDelete: vi.fn() }) }),
  };
});

vi.mock("../../src/auth/firebaseVerify.js", () => ({
  requireUser: requireUserMock,
}));

vi.mock("@google-cloud/pubsub", async () => {
  const { publishedMessages } = await import("../testUtils/testEnv.js");
  return {
    PubSub: class {
      topic(name: string) {
        return {
          publishMessage: async (message: unknown) => {
            publishedMessages.push({ topic: name, message });
          },
        };
      }
    },
  };
});

const { devicesRoutes } = await import("../../src/routes/devices.js");
const { ingestPayload } = await import("../../src/services/ingestGateway.js");
const {
  decryptDeviceSecret,
  encryptDeviceSecret,
  generateDeviceSecret,
  hashClaimPassphrase,
} = await import("../../src/lib/deviceSecrets.js");
const {
  mockFirestore,
  resetTestEnv,
  getDocData,
  mockBucket,
  publishedMessages,
} = await import("../testUtils/testEnv.js");

async function buildApp() {
  const app = Fastify();
  await app.register(devicesRoutes);
  await app.ready();
  return app;
}

describe("device claim flow", () => {
  beforeEach(() => {
    resetTestEnv();
    requireUserMock.mockResolvedValue({ uid: "user-1" });
  });

  const passphrase = "alpha-bravo";

  async function seedUnclaimedDevice(deviceId = "device-123") {
    const hash = hashClaimPassphrase(passphrase);
    const initialSecret = generateDeviceSecret();
    const encrypted = encryptDeviceSecret(initialSecret);
    const nowIso = new Date().toISOString();
    const devices = mockFirestore.collection("devices");
    await devices.doc(deviceId).set({
      status: "UNCLAIMED",
      ownerUserId: null,
      claimPassphraseHash: hash,
      claimPassphraseCreatedAt: nowIso,
      claimPassphraseConsumedAt: null,
      createdAt: nowIso,
      claimedAt: null,
      deviceSecret: encrypted,
      deviceSecretUpdatedAt: encrypted.createdAt,
      deviceSecretVersion: 1,
      bootstrapSecretDeliveredAt: null,
      bootstrapSecretDeliveredBy: null,
    });
    await mockFirestore.collection("devicePassphrases").doc(hash).set({
      status: "UNCLAIMED",
      deviceId,
      createdAt: nowIso,
      lastUpdatedAt: nowIso,
    });
    return { deviceId, initialSecret, passphraseHash: hash };
  }

  it("claims an unclaimed device and rotates secret", async () => {
    const { deviceId, initialSecret, passphraseHash } = await seedUnclaimedDevice();
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/devices/claim",
      payload: { passphrase },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { ingestSecret: string; deviceId: string };
    expect(body.deviceId).toBe(deviceId);
    expect(body.ingestSecret).toBeDefined();
    expect(body.ingestSecret).not.toBe(initialSecret);

    const stored = getDocData("devices", deviceId);
    expect(stored?.status).toBe("ACTIVE");
    expect(stored?.ownerUserId).toBe("user-1");
    expect(stored?.deviceSecretVersion).toBe(2);
    const record = stored?.deviceSecret as DeviceSecretRecord;
    expect(decryptDeviceSecret(record)).toBe(body.ingestSecret);

    const passphraseEntry = getDocData("devicePassphrases", passphraseHash);
    expect(passphraseEntry?.status).toBe("CLAIMED");
    expect(passphraseEntry?.deviceId).toBe(deviceId);

    await app.close();
  });

  it("rejects unknown passphrase", async () => {
    await seedUnclaimedDevice();
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/devices/claim",
      payload: { passphrase: "unknown passphrase" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("blocks double claims and surfaces bootstrap status", async () => {
    const { deviceId } = await seedUnclaimedDevice();
    const app = await buildApp();
    const first = await app.inject({
      method: "POST",
      url: "/v1/devices/claim",
      payload: { passphrase },
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/v1/devices/claim",
      payload: { passphrase },
    });
    expect(second.statusCode).toBe(409);

    const bootstrapBefore = await app.inject({
      method: "POST",
      url: "/v1/devices/bootstrap",
      payload: { passphrase },
    });
    expect(bootstrapBefore.statusCode).toBe(200);
    const bootstrapBody = bootstrapBefore.json() as { status: string; ingestSecret?: string };
    expect(bootstrapBody.status).toBe("CLAIMED");
    expect(bootstrapBody.ingestSecret).toBeDefined();

    const bootstrapAfter = await app.inject({
      method: "POST",
      url: "/v1/devices/bootstrap",
      payload: { passphrase },
    });
    expect(bootstrapAfter.statusCode).toBe(200);
    expect(bootstrapAfter.json()).toMatchObject({ status: "DELIVERED", deviceId });

    await app.close();
  });

  it("returns UNCLAIMED status for bootstrap before claim", async () => {
    const { deviceId } = await seedUnclaimedDevice();
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/devices/bootstrap",
      payload: { passphrase },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "UNCLAIMED", deviceId });
    await app.close();
  });

  it("lists device claims for the authenticated user and allows revoking a claim", async () => {
    const { deviceId, passphraseHash } = await seedUnclaimedDevice("claimed-device-1");
    const app = await buildApp();
    const claimResponse = await app.inject({
      method: "POST",
      url: "/v1/devices/claim",
      payload: { passphrase },
    });
    expect(claimResponse.statusCode).toBe(200);

    const listResponse = await app.inject({
      method: "GET",
      url: "/v1/devices/claims",
    });
    expect(listResponse.statusCode).toBe(200);
    const claims = listResponse.json() as Array<{ id: string }>;
    expect(claims.some((entry) => entry.id === deviceId)).toBe(true);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/v1/devices/claims/${deviceId}`,
    });
    expect(deleteResponse.statusCode).toBe(204);

    const deviceAfter = getDocData("devices", deviceId);
    expect(deviceAfter?.status).toBe("UNCLAIMED");
    expect(deviceAfter?.ownerUserId).toBeNull();
    expect(deviceAfter?.claimPassphraseConsumedAt).toBeNull();

    const passphraseEntry = getDocData("devicePassphrases", passphraseHash);
    expect(passphraseEntry?.status).toBe("UNCLAIMED");
    expect(passphraseEntry?.claimedAt).toBeNull();

    const listAfter = await app.inject({
      method: "GET",
      url: "/v1/devices/claims",
    });
    expect(listAfter.statusCode).toBe(200);
    const claimsAfter = listAfter.json() as Array<{ id: string }>;
    expect(claimsAfter.some((entry) => entry.id === deviceId)).toBe(false);

    await app.close();
  });

  it("prevents deleting a claim not owned by the requester", async () => {
    const { deviceId } = await seedUnclaimedDevice("claimed-device-2");
    const app = await buildApp();
    requireUserMock.mockResolvedValueOnce({ uid: "user-1" });
    const claimResponse = await app.inject({
      method: "POST",
      url: "/v1/devices/claim",
      payload: { passphrase },
    });
    expect(claimResponse.statusCode).toBe(200);

    requireUserMock.mockResolvedValue({ uid: "user-2" });
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/v1/devices/claims/${deviceId}`,
    });
    expect(deleteResponse.statusCode).toBe(403);

    requireUserMock.mockResolvedValue({ uid: "user-1" });
    await app.close();
  });
});

describe("ingestPayload", () => {
  beforeEach(() => {
    resetTestEnv();
    publishedMessages.length = 0;
  });

  const basePoint = {
    device_id: "ingest-device",
    pollutant: "pm25",
    value: 9,
    timestamp: new Date().toISOString(),
  };

  function buildPayload(deviceId: string) {
    return {
      device_id: deviceId,
      points: [{ ...basePoint, device_id: deviceId }],
    };
  }

  it("accepts payload signed with device secret", async () => {
    const deviceId = "ingest-device";
    const secret = generateDeviceSecret();
    const encrypted = encryptDeviceSecret(secret);
    await mockFirestore.collection("devices").doc(deviceId).set({
      status: "ACTIVE",
      deviceSecret: encrypted,
      deviceSecretVersion: 1,
      deviceSecretUpdatedAt: encrypted.createdAt,
    });

    const payload = buildPayload(deviceId);
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const result = await ingestPayload(raw, payload, { signature });
    expect(result.accepted).toBe(true);
    expect(result.deviceId).toBe(deviceId);
    expect(mockBucket.files.size).toBe(1);
    expect(publishedMessages[0]?.topic).toBe("ingest.raw");
  });

  it("rejects stale signature after secret rotation", async () => {
    const deviceId = "rotating-device";
    const originalSecret = generateDeviceSecret();
    const originalRecord = encryptDeviceSecret(originalSecret);
    await mockFirestore.collection("devices").doc(deviceId).set({
      status: "ACTIVE",
      deviceSecret: originalRecord,
      deviceSecretVersion: 1,
      deviceSecretUpdatedAt: originalRecord.createdAt,
    });

    const payload = buildPayload(deviceId);
    const raw = JSON.stringify(payload);
    const staleSignature = crypto.createHmac("sha256", originalSecret).update(raw).digest("hex");

    const rotatedSecret = generateDeviceSecret();
    const rotatedRecord = encryptDeviceSecret(rotatedSecret);
    await mockFirestore.collection("devices").doc(deviceId).set({
      deviceSecret: rotatedRecord,
      deviceSecretVersion: 2,
      deviceSecretUpdatedAt: rotatedRecord.createdAt,
    }, { merge: true });

    await expect(ingestPayload(raw, payload, { signature: staleSignature })).rejects.toMatchObject({ statusCode: 401 });

    const freshSignature = crypto.createHmac("sha256", rotatedSecret).update(raw).digest("hex");
    const result = await ingestPayload(raw, payload, { signature: freshSignature });
    expect(result.accepted).toBe(true);
  });
});
