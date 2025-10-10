import { describe, expect, it } from "vitest";
import { hourBucket } from "../../src/lib/fire.js";

describe("hourBucket", () => {
  it("formats UTC components into yyyymmddhh", () => {
    const date = new Date(Date.UTC(2024, 0, 2, 3, 45, 12));
    expect(hourBucket(date)).toBe("2024010203");
  });

  it("pads all components", () => {
    const date = new Date(Date.UTC(2024, 10, 11, 9, 0, 0));
    expect(hourBucket(date)).toBe("2024111109");
  });
});
