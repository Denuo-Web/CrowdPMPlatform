import { describe, expect, it } from "vitest";
import { normalizeConfiguredPrivateKey } from "../../src/services/deviceTokens.js";

describe("normalizeConfiguredPrivateKey", () => {
  it("preserves PEM input with real newlines", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----";
    expect(normalizeConfiguredPrivateKey(pem)).toBe(pem);
  });

  it("unwraps quoted PEM input with escaped newlines", () => {
    const raw = "\"-----BEGIN PRIVATE KEY-----\\nABC123\\n-----END PRIVATE KEY-----\"";
    expect(normalizeConfiguredPrivateKey(raw)).toBe("-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----");
  });

  it("wraps bare base64 payload in a PEM envelope", () => {
    expect(normalizeConfiguredPrivateKey("ABC123")).toBe("-----BEGIN PRIVATE KEY-----\nABC123\n-----END PRIVATE KEY-----");
  });
});
