import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/fire.js";
import type { BatchVisibility } from "../lib/batchVisibility.js";
import { normalizeVisibility } from "../lib/httpValidation.js";
import { rateLimitGuard, requireUserGuard, requestUserId } from "../lib/routeGuards.js";

const DEFAULT_INTERLEAVED_RENDERING = false;

function normalizeInterleavedRendering(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

type UserSettingsResponse = {
  defaultBatchVisibility: BatchVisibility;
  interleavedRendering: boolean;
};

type UserSettingsBody = {
  defaultBatchVisibility?: unknown;
  interleavedRendering?: unknown;
};

export const userSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/user/settings", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `user-settings:get:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard("user-settings:get:global", 2_000, 60_000),
    ],
  }, async (req) => {
    const snap = await db().collection("userSettings").doc(requestUserId(req)).get();
    const visibility = normalizeVisibility(snap.get("defaultBatchVisibility"));
    const interleavedRendering = snap.exists
      ? normalizeInterleavedRendering(snap.get("interleavedRendering")) ?? DEFAULT_INTERLEAVED_RENDERING
      : DEFAULT_INTERLEAVED_RENDERING;
    return { defaultBatchVisibility: visibility, interleavedRendering } satisfies UserSettingsResponse;
  });

  app.put<{ Body: UserSettingsBody }>("/v1/user/settings", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `user-settings:update:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard("user-settings:update:global", 1_000, 60_000),
    ],
  }, async (req, rep) => {
    const hasVisibility = "defaultBatchVisibility" in (req.body ?? {});
    const hasInterleaved = "interleavedRendering" in (req.body ?? {});

    if (!hasVisibility && !hasInterleaved) {
      return rep.code(400).send({
        error: "missing_fields",
        message: "Provide defaultBatchVisibility or interleavedRendering to update.",
      });
    }

    let visibility: BatchVisibility | null = null;
    if (hasVisibility) {
      visibility = normalizeVisibility(req.body?.defaultBatchVisibility, null);
      if (!visibility) {
        return rep.code(400).send({
          error: "invalid_visibility",
          message: "defaultBatchVisibility must be 'public' or 'private'.",
        });
      }
    }

    let interleavedRendering: boolean | null = null;
    if (hasInterleaved) {
      interleavedRendering = normalizeInterleavedRendering(req.body?.interleavedRendering);
      if (interleavedRendering === null) {
        return rep.code(400).send({
          error: "invalid_interleaved",
          message: "interleavedRendering must be boolean.",
        });
      }
    }

    const docRef = db().collection("userSettings").doc(requestUserId(req));
    const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (visibility) payload.defaultBatchVisibility = visibility;
    if (interleavedRendering !== null) payload.interleavedRendering = interleavedRendering;
    await docRef.set(payload, { merge: true });

    const snap = await docRef.get();
    const nextVisibility = normalizeVisibility(snap.get("defaultBatchVisibility"));
    const nextInterleaved = normalizeInterleavedRendering(snap.get("interleavedRendering")) ?? DEFAULT_INTERLEAVED_RENDERING;
    return {
      defaultBatchVisibility: nextVisibility,
      interleavedRendering: nextInterleaved,
    } satisfies UserSettingsResponse;
  });
};
