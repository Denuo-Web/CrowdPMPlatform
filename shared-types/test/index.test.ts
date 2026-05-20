import { describe, expect, it } from "vitest";
import {
  isAdminRole,
  normalizeAdminRoles,
  readAdminRolesFromClaims,
  timestampToDate,
  timestampToIsoString,
  timestampToMillis,
} from "../src/index.ts";

describe("admin role helpers", () => {
  it("recognizes only supported admin roles", () => {
    expect(isAdminRole("super_admin")).toBe(true);
    expect(isAdminRole("moderator")).toBe(true);
    expect(isAdminRole("admin")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
  });

  it("normalizes claims to unique supported roles", () => {
    expect(normalizeAdminRoles(["moderator", "super_admin", "moderator", "admin"])).toEqual([
      "moderator",
      "super_admin",
    ]);
    expect(readAdminRolesFromClaims({ roles: ["super_admin"] })).toEqual(["super_admin"]);
    expect(readAdminRolesFromClaims(undefined)).toEqual([]);
  });
});

describe("timestamp helpers", () => {
  it("converts valid timestamp inputs to millis and ISO strings", () => {
    const iso = "2026-05-19T06:00:00.000Z";
    const millis = Date.parse(iso);

    expect(timestampToMillis(iso)).toBe(millis);
    expect(timestampToIsoString(millis)).toBe(iso);
    expect(timestampToDate(new Date(iso))?.toISOString()).toBe(iso);
  });

  it("supports Firestore-like timestamp objects", () => {
    const iso = "2026-05-19T06:00:00.000Z";
    const date = new Date(iso);

    expect(timestampToIsoString({ toDate: () => date })).toBe(iso);
    expect(timestampToIsoString({ toMillis: () => date.getTime() })).toBe(iso);
  });

  it("returns null for invalid timestamp inputs", () => {
    expect(timestampToDate("not-a-date")).toBeNull();
    expect(timestampToMillis(Number.NaN)).toBeNull();
    expect(timestampToIsoString({ toDate: () => new Date(Number.NaN) })).toBeNull();
    expect(timestampToIsoString({ toMillis: () => Number.NaN })).toBeNull();
  });
});
