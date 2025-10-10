import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyHmac } from "../../src/lib/crypto.js";

describe("verifyHmac", () => {
  const secret = "test-secret";
  const payload = JSON.stringify({ ok: true });

  it("accepts a valid signature", () => {
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    expect(() => verifyHmac(payload, signature, secret)).not.toThrow();
  });

  it("rejects an invalid signature", () => {
    expect(() => verifyHmac(payload, "deadbeef", secret)).toThrowError(/bad signature/);
  });
});
