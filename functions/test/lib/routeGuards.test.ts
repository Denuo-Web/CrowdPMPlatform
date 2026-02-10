import type { FastifyRequest } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitGuard } from "../../src/lib/routeGuards.js";
import { RateLimitError } from "../../src/lib/rateLimiter.js";

const mocks = vi.hoisted(() => ({
  rateLimitOrThrow: vi.fn(),
}));

vi.mock("../../src/lib/rateLimiter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/rateLimiter.js")>();
  return { ...actual, rateLimitOrThrow: mocks.rateLimitOrThrow };
});

function makeRequest(shape: Record<string, unknown>): FastifyRequest {
  return shape as unknown as FastifyRequest;
}

describe("rateLimitGuard", () => {
  beforeEach(() => {
    mocks.rateLimitOrThrow.mockReset();
    mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 10, retryAfterSeconds: 0 });
  });

  it("plugin path: allows with static key", async () => {
    const req = makeRequest({
      server: {},
    });

    const limiter = vi.fn(async () => ({ isAllowed: true, ttlInSeconds: 0 }));
    const createRateLimit = vi.fn((options: { keyGenerator: (req: FastifyRequest) => string }) => {
      expect(options.keyGenerator(req)).toBe("fixed:key");
      return limiter;
    });

    (req.server as unknown as { createRateLimit: typeof createRateLimit }).createRateLimit = createRateLimit;

    const guard = rateLimitGuard("fixed:key", 12, 60_000);
    await expect(guard(req)).resolves.toBeUndefined();
    expect(createRateLimit).toHaveBeenCalledTimes(1);
    expect(limiter).toHaveBeenCalledWith(req);
    expect(mocks.rateLimitOrThrow).not.toHaveBeenCalled();
  });

  it("plugin path: key generator resolves function key", async () => {
    const req = makeRequest({
      accountId: "acct-1",
      server: {},
    });

    const limiter = vi.fn(async () => ({ isAllowed: true, ttlInSeconds: 0 }));
    const createRateLimit = vi.fn((options: { keyGenerator: (req: FastifyRequest) => string }) => {
      expect(options.keyGenerator(req)).toBe("dynamic:acct-1");
      return limiter;
    });

    (req.server as unknown as { createRateLimit: typeof createRateLimit }).createRateLimit = createRateLimit;

    const guard = rateLimitGuard((incomingReq) => `dynamic:${(incomingReq as { accountId?: string }).accountId ?? "unknown"}`, 5, 5_000);
    await expect(guard(req)).resolves.toBeUndefined();
    expect(createRateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.rateLimitOrThrow).not.toHaveBeenCalled();
  });

  it("plugin path: throws RateLimitError when denied", async () => {
    const req = makeRequest({
      server: {},
    });

    const createRateLimit = vi.fn(() => vi.fn(async () => ({ isAllowed: false, ttlInSeconds: 9 })));
    (req.server as unknown as { createRateLimit: typeof createRateLimit }).createRateLimit = createRateLimit;

    const guard = rateLimitGuard("limited:key", 1, 60_000);

    let thrown: unknown;
    try {
      await guard(req);
    }
    catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).retryAfterSeconds).toBe(9);
    expect(mocks.rateLimitOrThrow).not.toHaveBeenCalled();
  });

  it("fallback path: uses rateLimitOrThrow when plugin decorator is unavailable", async () => {
    const req = makeRequest({
      userId: "user-7",
      server: {},
    });

    const guard = rateLimitGuard(
      (incomingReq) => `fallback:${(incomingReq as { userId?: string }).userId ?? "unknown"}`,
      30,
      60_000
    );

    await expect(guard(req)).resolves.toBeUndefined();
    expect(mocks.rateLimitOrThrow).toHaveBeenCalledWith("fallback:user-7", 30, 60_000);
  });
});
