import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareSmokeTestPlan, type SmokeTestBody } from "../../src/services/smokeTest.js";

describe("prepareSmokeTestPlan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-01T00:00:00.000Z"));
    vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("scopes raw device IDs to the requesting user while keeping display data untouched", () => {
    const body: SmokeTestBody = {
      payload: {
        points: [
          { device_id: "north-01", pollutant: "pm25", value: 1, timestamp: "2024-01-01T00:00:00.000Z" },
          { device_id: "  South 02  ", pollutant: "pm25", value: 2, timestamp: "2024-01-01T00:00:01.000Z" },
        ],
      },
    };
    const plan = prepareSmokeTestPlan("User_One", body);
    expect(plan.displayPoints.map((point) => point.device_id)).toEqual(["north-01", "South 02"]);
    expect(plan.payload.points.map((point) => point.device_id)).toEqual(["user-one-north-01", "user-one-south-02"]);
    expect(plan.primaryDeviceId).toBe("user-one-north-01");
    expect(plan.seedTargets).toEqual(["user-one-north-01", "user-one-south-02"]);
  });

  it("generates default points and seed targets when none are supplied", () => {
    const plan = prepareSmokeTestPlan("AnotherUser", undefined);
    expect(plan.displayPoints).toHaveLength(60);
    expect(plan.payload.points).toHaveLength(60);
    const uniqueRawIds = new Set(plan.displayPoints.map((point) => point.device_id));
    expect(uniqueRawIds.size).toBe(1);
    expect(uniqueRawIds.has("device-123")).toBe(true);
    expect(plan.primaryDeviceId).toBe("anotheruser-device-123");
    expect(plan.seedTargets).toEqual(["anotheruser-device-123"]);
  });

  it("respects point overrides and exposes the scoped-to-raw mapping", () => {
    const body: SmokeTestBody = {
      payload: {
        points: [
          { pollutant: "pm25", value: 5, timestamp: "2024-01-01T00:00:00.000Z" },
        ],
      },
      pointOverrides: {
        device_id: "  RAW-ID  ",
      },
    };
    const plan = prepareSmokeTestPlan("Test/User", body);
    expect(plan.displayPoints[0]?.device_id).toBe("RAW-ID");
    const scopedId = plan.payload.points[0]?.device_id;
    expect(scopedId).toBe("test-user-raw-id");
    expect(plan.scopedToRawIds.get(scopedId ?? "")).toBe("RAW-ID");
  });
});
