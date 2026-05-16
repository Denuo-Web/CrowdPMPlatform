import { describe, expect, it, vi } from "vitest";
import { buildApi } from "../src/index.js";

describe("buildApi", () => {
  it("builds an injectable API with injected startup dependencies", async () => {
    const initializeAdminApp = vi.fn();
    const ensureLocalSuperAdmin = vi.fn(async () => {});

    const app = await buildApi({
      initializeAdminApp,
      ensureLocalSuperAdmin,
      logger: false,
      rateLimitsEnabled: false,
      routes: [],
    });

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(initializeAdminApp).toHaveBeenCalledOnce();
    expect(ensureLocalSuperAdmin).toHaveBeenCalledOnce();
    await app.close();
  });
});
