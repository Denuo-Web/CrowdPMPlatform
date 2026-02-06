import { describe, expect, it } from "vitest";
import { timestampToIsoString, timestampToMillis, toDate } from "../../src/lib/time.js";

describe("time helpers", () => {
  it("normalizes ISO strings and numbers", () => {
    expect(toDate("2024-01-01T00:00:00.000Z")?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(toDate(1704067200000)?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("supports Firestore-like timestamp objects", () => {
    const withToDate = { toDate: () => new Date("2024-01-01T00:00:00.000Z") };
    const withToMillis = { toMillis: () => 1704067200000 };
    expect(toDate(withToDate)?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(toDate(withToMillis)?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("returns null for invalid values", () => {
    expect(toDate("not-a-date")).toBeNull();
    expect(timestampToMillis({ nope: true })).toBeNull();
    expect(timestampToIsoString("")).toBeNull();
  });
});
