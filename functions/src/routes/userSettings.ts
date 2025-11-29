import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";
import {
  DEFAULT_BATCH_VISIBILITY,
  normalizeBatchVisibility,
  type BatchVisibility,
} from "../lib/batchVisibility.js";

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
  app.get("/v1/user/settings", async (req) => {
    const user = await requireUser(req);
    rateLimitOrThrow(`user-settings:get:${user.uid}`, 60, 60_000);
    rateLimitOrThrow("user-settings:get:global", 2_000, 60_000);
    const snap = await db().collection("userSettings").doc(user.uid).get();
    const visibility = snap.exists
      ? normalizeBatchVisibility(snap.get("defaultBatchVisibility")) ?? DEFAULT_BATCH_VISIBILITY
      : DEFAULT_BATCH_VISIBILITY;
    const interleavedRendering = snap.exists
      ? normalizeInterleavedRendering(snap.get("interleavedRendering")) ?? DEFAULT_INTERLEAVED_RENDERING
      : DEFAULT_INTERLEAVED_RENDERING;
    return { defaultBatchVisibility: visibility, interleavedRendering } satisfies UserSettingsResponse;
  });

  app.put<{ Body: UserSettingsBody }>("/v1/user/settings", async (req, rep) => {
    const user = await requireUser(req);
    rateLimitOrThrow(`user-settings:update:${user.uid}`, 30, 60_000);
    rateLimitOrThrow("user-settings:update:global", 1_000, 60_000);
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
      visibility = normalizeBatchVisibility(req.body?.defaultBatchVisibility);
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

    const docRef = db().collection("userSettings").doc(user.uid);
    const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (visibility) payload.defaultBatchVisibility = visibility;
    if (interleavedRendering !== null) payload.interleavedRendering = interleavedRendering;
    await docRef.set(payload, { merge: true });

    const snap = await docRef.get();
    const nextVisibility = normalizeBatchVisibility(snap.get("defaultBatchVisibility")) ?? DEFAULT_BATCH_VISIBILITY;
    const nextInterleaved = normalizeInterleavedRendering(snap.get("interleavedRendering")) ?? DEFAULT_INTERLEAVED_RENDERING;
    return {
      defaultBatchVisibility: nextVisibility,
      interleavedRendering: nextInterleaved,
    } satisfies UserSettingsResponse;
  });
};
