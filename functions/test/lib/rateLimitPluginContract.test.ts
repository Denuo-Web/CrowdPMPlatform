import Fastify from "fastify";
import rateLimit from "fastify-rate-limit";
import { describe, expect, it } from "vitest";
import { toHttpError } from "../../src/lib/httpError.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";

describe("rate-limit plugin contract", () => {
  it("normalizes plugin-originated 429 responses to the shared API shape", async () => {
    const app = Fastify({ logger: false });
    app.setErrorHandler((err, req, rep) => {
      const normalized = toHttpError(err);
      if (normalized.headers) rep.headers(normalized.headers);
      rep.code(normalized.statusCode).send(normalized.body);
    });

    await app.register(rateLimit, {
      max: 100,
      timeWindow: "1 minute",
      errorResponseBuilder: (_request, context) => new RateLimitError(Math.max(1, Math.ceil(context.ttl / 1000))),
    });

    app.get("/limited", {
      config: {
        rateLimit: {
          max: 1,
          timeWindow: 60_000,
        },
      },
    }, async () => ({ ok: true }));

    await app.ready();

    const first = await app.inject({
      method: "GET",
      url: "/limited",
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "GET",
      url: "/limited",
    });

    expect(second.statusCode).toBe(429);
    const body = second.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["error", "retry_after"]);
    expect(body.error).toBe("rate_limited");
    expect(typeof body.retry_after).toBe("number");
    expect((body.retry_after as number)).toBeGreaterThanOrEqual(1);
    expect(second.headers["retry-after"]).toBe(String(body.retry_after));

    await app.close();
  });
});
