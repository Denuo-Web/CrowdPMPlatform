import { describe, expect, it } from "vitest";
import { stripApiEntryPrefix } from "../../src/lib/http.js";

describe("stripApiEntryPrefix", () => {
  it("strips the hosting /api prefix for nested routes", () => {
    expect(stripApiEntryPrefix("/api/v1/public/batches")).toBe("/v1/public/batches");
    expect(stripApiEntryPrefix("/api/health")).toBe("/health");
  });

  it("preserves query strings when stripping the /api prefix", () => {
    expect(stripApiEntryPrefix("/api/v1/public/batches?limit=20")).toBe("/v1/public/batches?limit=20");
    expect(stripApiEntryPrefix("/api?check=1")).toBe("/?check=1");
  });

  it("leaves non-matching paths unchanged", () => {
    expect(stripApiEntryPrefix("/v1/public/batches")).toBe("/v1/public/batches");
    expect(stripApiEntryPrefix("/apiv1/public/batches")).toBe("/apiv1/public/batches");
    expect(stripApiEntryPrefix(undefined)).toBe("/");
  });
});
