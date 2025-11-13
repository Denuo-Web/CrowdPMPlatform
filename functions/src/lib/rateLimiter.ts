type Bucket = {
  count: number;
  resetAt: number;
};

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  hit(key: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const nextBucket: Bucket = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, nextBucket);
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }
    if (bucket.count >= limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }
    bucket.count += 1;
    return { allowed: true, remaining: Math.max(0, limit - bucket.count), retryAfterSeconds: 0 };
  }
}

export class RateLimitError extends Error {
  readonly statusCode = 429;
  constructor(readonly retryAfterSeconds: number) {
    super(`rate_limited:${retryAfterSeconds}`);
  }
}

export const globalRateLimiter = new MemoryRateLimiter();

export function rateLimitOrThrow(key: string, limit: number, windowMs: number) {
  const attempt = globalRateLimiter.hit(key, limit, windowMs);
  if (!attempt.allowed) {
    throw new RateLimitError(attempt.retryAfterSeconds);
  }
  return attempt;
}
