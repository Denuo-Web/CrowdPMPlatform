import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/fire.js";
import { requireUser } from "../auth/firebaseVerify.js";
import {
  DEFAULT_BATCH_VISIBILITY,
  normalizeBatchVisibility,
  type BatchVisibility,
} from "../lib/batchVisibility.js";

type UserSettingsResponse = {
  defaultBatchVisibility: BatchVisibility;
};

type UserSettingsBody = {
  defaultBatchVisibility?: unknown;
};

export const userSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/user/settings", async (req) => {
    const user = await requireUser(req);
    const snap = await db().collection("userSettings").doc(user.uid).get();
    const visibility = snap.exists
      ? normalizeBatchVisibility(snap.get("defaultBatchVisibility")) ?? DEFAULT_BATCH_VISIBILITY
      : DEFAULT_BATCH_VISIBILITY;
    return { defaultBatchVisibility: visibility } satisfies UserSettingsResponse;
  });

  app.put<{ Body: UserSettingsBody }>("/v1/user/settings", async (req, rep) => {
    const user = await requireUser(req);
    const visibility = normalizeBatchVisibility(req.body?.defaultBatchVisibility);
    if (!visibility) {
      return rep.code(400).send({
        error: "invalid_visibility",
        message: "defaultBatchVisibility must be 'public' or 'private'.",
      });
    }
    await db().collection("userSettings").doc(user.uid).set({
      defaultBatchVisibility: visibility,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { defaultBatchVisibility: visibility } satisfies UserSettingsResponse;
  });
};
