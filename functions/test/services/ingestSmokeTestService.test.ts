import type { firestore } from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";
import type { BatchVisibility } from "../../src/lib/batchVisibility.js";
import { IngestSmokeTestService, SmokeTestServiceError } from "../../src/services/ingestSmokeTestService.js";
import type { IngestService } from "../../src/services/ingestService.js";
import type { SmokeTestPlan } from "../../src/services/smokeTest.js";

function buildPlan(): SmokeTestPlan {
  return {
    payload: {
      points: [
        { device_id: "scoped-device-1", pollutant: "pm25", value: 1, timestamp: "2024-01-01T00:00:00.000Z" },
      ],
    },
    displayPoints: [
      { device_id: "raw-device-1", pollutant: "pm25", value: 1, timestamp: "2024-01-01T00:00:00.000Z" },
    ],
    ownerSegment: "user-segment",
    primaryDeviceId: "scoped-device-1",
    scopedDeviceIds: ["scoped-device-1"],
    seedTargets: ["scoped-device-1"],
    scopedToRawIds: new Map([["scoped-device-1", "raw-device-1"]]),
  };
}

function createFakeDb(writes: { path: string; data: Record<string, unknown>; options?: unknown }[]) {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        set: async (data: Record<string, unknown>, options?: unknown) => {
          writes.push({ path: `${name}/${id}`, data, options });
        },
      }),
    }),
  } as unknown as Firestore;
}

describe("IngestSmokeTestService", () => {
  it("prepares the plan, seeds devices, and runs the shared ingest service", async () => {
    const writes: { path: string; data: Record<string, unknown>; options?: unknown }[] = [];
    const db = createFakeDb(writes);
    const arrayUnion = vi.fn((...values: unknown[]) => ({ union: values } as unknown as firestore.FieldValue));

    const plan = buildPlan();
    const preparePlan = vi.fn(() => plan);

    const ingestResult = {
      accepted: true,
      batchId: "batch-1",
      deviceId: plan.primaryDeviceId,
      storagePath: "ingest/scoped-device-1/batch-1.json",
      visibility: "public" as BatchVisibility,
    };
    const ingestMock = vi.fn(async () => ingestResult);
    const ingest = { ingest: ingestMock as unknown as IngestService["ingest"] };

    const service = new IngestSmokeTestService({
      db,
      arrayUnion,
      preparePlan: preparePlan as unknown as typeof import("../../src/services/smokeTest.js").prepareSmokeTestPlan,
      ingest,
      authorize: vi.fn(),
      getUserDefaultBatchVisibility: vi.fn().mockResolvedValue("private" as BatchVisibility),
    });

    const result = await service.runSmokeTest({
      user: { uid: "user-1" } as unknown as Parameters<IngestSmokeTestService["runSmokeTest"]>[0]["user"],
      body: { visibility: "public" as BatchVisibility },
    });

    expect(preparePlan).toHaveBeenCalledWith("user-1", { visibility: "public" });

    expect(ingestMock).toHaveBeenCalledWith(expect.objectContaining({
      deviceId: plan.primaryDeviceId,
      visibility: "public",
    }));
    const ingestArgs = ingestMock.mock.calls[0]?.[0];
    expect(JSON.parse(ingestArgs.rawBody)).toEqual(plan.payload);

    expect(writes[0]).toMatchObject({
      path: "devices/scoped-device-1",
      data: expect.objectContaining({
        ownerUserId: "user-1",
        ownerScope: plan.ownerSegment,
      }),
    });
    expect(arrayUnion).toHaveBeenCalledWith("user-1");

    expect(result.seededDeviceId).toBe(plan.primaryDeviceId);
    expect(result.seededDeviceIds).toEqual(plan.seedTargets);
    expect(result.points).toEqual(plan.displayPoints);
  });

  it("wraps invalid plans in a 400 service error", async () => {
    const service = new IngestSmokeTestService({
      preparePlan: (() => { throw new Error("bad payload"); }) as unknown as typeof import("../../src/services/smokeTest.js").prepareSmokeTestPlan,
      authorize: vi.fn(),
      arrayUnion: vi.fn(),
      db: createFakeDb([]),
      ingest: { ingest: vi.fn() as unknown as IngestService["ingest"] },
      getUserDefaultBatchVisibility: vi.fn(),
    });

    await expect(service.runSmokeTest({
      user: { uid: "user-1" } as unknown as Parameters<IngestSmokeTestService["runSmokeTest"]>[0]["user"],
    })).rejects.toMatchObject({ statusCode: 400, reason: "invalid_payload" });
  });

  it("enforces RBAC checks via the authorize hook", async () => {
    const service = new IngestSmokeTestService({
      authorize: () => { throw new SmokeTestServiceError("forbidden", "denied", 403); },
      preparePlan: buildPlan as unknown as typeof import("../../src/services/smokeTest.js").prepareSmokeTestPlan,
      arrayUnion: vi.fn(),
      db: createFakeDb([]),
      ingest: { ingest: vi.fn() as unknown as IngestService["ingest"] },
      getUserDefaultBatchVisibility: vi.fn(),
    });

    await expect(service.runSmokeTest({
      user: { uid: "user-1" } as unknown as Parameters<IngestSmokeTestService["runSmokeTest"]>[0]["user"],
    })).rejects.toBeInstanceOf(SmokeTestServiceError);
  });
});
