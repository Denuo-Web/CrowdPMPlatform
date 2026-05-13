import { gunzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { createIngestService } from "../../src/services/ingestService.js";

function buildPayload(deviceId: string) {
  return {
    device_id: deviceId,
    points: [{
      device_id: deviceId,
      pollutant: "pm25",
      value: 12.4,
      unit: "\u00b5g/m\u00b3",
      lat: 45.5231,
      lon: -122.6765,
      timestamp: "2024-01-01T00:00:00.000Z",
      precision: 6,
      altitude: 12,
    }],
  };
}

describe("IngestService", () => {
  it("stores gzipped v2 payloads and sends root batch metadata to the processor", async () => {
    const saves: Array<{ path: string; payload: Buffer; options: unknown }> = [];
    const processIngestBatch = vi.fn(async (request) => ({
      count: request.payload.points.length,
      visibility: request.visibility,
    }));
    const db = {
      collection: (name: string) => {
        if (name !== "devices") throw new Error(`unexpected collection ${name}`);
        return {
          doc: (id: string) => ({
            get: async () => ({
              id,
              exists: true,
              data: () => ({
                accId: "user-1",
                ownerUserIds: ["user-1"],
                status: "ACTIVE",
                registryStatus: "active",
                name: "Bike Node",
                defaultBatchVisibility: "public",
              }),
              get: (field: string) => ({
                accId: "user-1",
                ownerUserIds: ["user-1"],
                status: "ACTIVE",
                registryStatus: "active",
                name: "Bike Node",
                defaultBatchVisibility: "public",
              } as Record<string, unknown>)[field],
            }),
          }),
        };
      },
    };
    const bucket = {
      file: (path: string) => ({
        save: async (payload: Buffer, options: unknown) => {
          saves.push({ path, payload, options });
        },
      }),
    };
    const service = createIngestService({
      db: db as never,
      bucket: bucket as never,
      processIngestBatch: processIngestBatch as never,
      updateDeviceLastSeen: vi.fn().mockResolvedValue(undefined),
      getSubscriptionSummary: vi.fn().mockResolvedValue({
        planId: "pro",
        label: "Pro",
        source: "stripe",
        status: "active",
        billingInterval: "month",
        canManageBilling: true,
        cancelAtPeriodEnd: false,
        currentPeriodEnd: null,
        videoDownloadAccess: "full",
        limits: {
          maxActiveDevices: 10,
          maxStoredBatchesTotal: 2_000,
          maxStoredPrivateBatches: 1_000,
          monthlyPoints: 1_000_000,
          maxPointsPerBatch: 10_000,
        },
        usage: {
          activeDevices: 1,
          storedBatchesTotal: 10,
          storedPrivateBatches: 1,
          monthlyPointsUsed: 0,
          monthlyPointsRemaining: 1_000_000,
          monthKey: "2024-01",
          resetAt: "2024-02-01T00:00:00.000Z",
        },
      }),
      reserveUploadQuota: vi.fn().mockResolvedValue({
        monthKey: "2024-01",
        pointCount: 1,
        visibility: "public",
        subscription: {
          planId: "pro",
          label: "Pro",
          source: "stripe",
          status: "active",
          billingInterval: "month",
          canManageBilling: true,
          cancelAtPeriodEnd: false,
          currentPeriodEnd: null,
          videoDownloadAccess: "full",
          limits: {
            maxActiveDevices: 10,
            maxStoredBatchesTotal: 2_000,
            maxStoredPrivateBatches: 1_000,
            monthlyPoints: 1_000_000,
            maxPointsPerBatch: 10_000,
          },
          usage: {
            activeDevices: 1,
            storedBatchesTotal: 11,
            storedPrivateBatches: 1,
            monthlyPointsUsed: 1,
            monthlyPointsRemaining: 999_999,
            monthKey: "2024-01",
            resetAt: "2024-02-01T00:00:00.000Z",
          },
        },
      }),
      rollbackUploadQuotaReservation: vi.fn().mockResolvedValue(undefined),
    });
    const payload = buildPayload("device-1");

    const result = await service.ingest({
      rawBody: JSON.stringify(payload),
      body: payload,
      deviceId: "device-1",
      visibility: "public",
    });

    expect(result).toMatchObject({
      accepted: true,
      deviceId: "device-1",
      visibility: "public",
    });
    expect(result.storagePath).toMatch(/^ingest\/v2\/user-1\/device-1\/.+\.json\.gz$/);
    expect(saves).toHaveLength(1);
    expect(saves[0].path).toBe(result.storagePath);
    expect(JSON.parse(gunzipSync(saves[0].payload).toString("utf8"))).toEqual(payload);
    expect(processIngestBatch).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: "device-1",
      storagePath: result.storagePath,
      ownerUserId: "user-1",
      ownerUserIds: ["user-1"],
      deviceName: "Bike Node",
      compressedBytes: saves[0].payload.byteLength,
      visibility: "public",
    }));
  });
});
