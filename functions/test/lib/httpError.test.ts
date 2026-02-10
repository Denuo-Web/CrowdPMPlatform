import { describe, expect, it } from "vitest";
import { RateLimitError } from "../../src/lib/rateLimiter.js";
import { httpError, toHttpError } from "../../src/lib/httpError.js";

describe("toHttpError", () => {
  it("normalizes explicit error codes to lower snake case", () => {
    const normalized = toHttpError(httpError(400, "INVALID-PAYLOAD", "Payload failed"));
    expect(normalized.statusCode).toBe(400);
    expect(normalized.body).toMatchObject({
      error: "invalid_payload",
      message: "Payload failed",
      error_description: "Payload failed",
    });
  });

  it("merges metadata fields into the response body", () => {
    const normalized = toHttpError(httpError(400, "invalid_request", "Validation failed", {
      details: { fieldErrors: { user_code: ["Required"] } },
      poll_interval: 10,
      ignored: undefined,
    }));

    expect(normalized.body).toMatchObject({
      error: "invalid_request",
      message: "Validation failed",
      error_description: "Validation failed",
      details: { fieldErrors: { user_code: ["Required"] } },
      poll_interval: 10,
    });
    expect(normalized.body).not.toHaveProperty("ignored");
  });

  it("emits aliases when message is present and omits them when absent", () => {
    const withoutMessage = toHttpError(httpError(400, "invalid_request"));
    expect(withoutMessage.body).toEqual({ error: "invalid_request" });

    const withMessage = toHttpError(httpError(400, "invalid_request", "invalid request"));
    expect(withMessage.body).toEqual({
      error: "invalid_request",
      message: "invalid request",
      error_description: "invalid request",
    });
  });

  it("resolves codes by precedence: code, then reason, then status default", () => {
    const codeFirst = toHttpError({ statusCode: 403, code: "Custom-Code", reason: "FORBIDDEN" });
    expect(codeFirst.body.error).toBe("custom_code");

    const reasonFallback = toHttpError({ statusCode: 403, reason: "DEVICE_FORBIDDEN" });
    expect(reasonFallback.body.error).toBe("device_forbidden");

    const statusFallback = toHttpError({ statusCode: 404 });
    expect(statusFallback.body.error).toBe("not_found");
  });

  it("does not use raw exception messages as error codes", () => {
    const normalized = toHttpError(new Error("boom"), 400);
    expect(normalized.body).toMatchObject({
      error: "bad_request",
      message: "boom",
      error_description: "boom",
    });
  });

  it("preserves rate-limit headers and payload fields", () => {
    const normalized = toHttpError(new RateLimitError(7));
    expect(normalized.statusCode).toBe(429);
    expect(normalized.headers).toEqual({ "retry-after": "7" });
    expect(normalized.body).toEqual({ error: "rate_limited", retry_after: 7 });
  });
});
