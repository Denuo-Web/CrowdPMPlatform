import { afterEach, beforeEach } from "vitest";

export function withRateLimitsEnabled() {
  beforeEach(() => {
    process.env.ENABLE_RATE_LIMITS = "true";
  });

  afterEach(() => {
    delete process.env.ENABLE_RATE_LIMITS;
  });
}
