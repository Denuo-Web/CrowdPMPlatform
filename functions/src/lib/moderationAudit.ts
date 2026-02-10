import type { AdminRole } from "@crowdpm/types";
import { db } from "./fire.js";

export type ModerationAuditEntry = {
  actorUid: string;
  actorRoles: AdminRole[];
  targetType: "submission" | "user";
  targetId: string;
  action: string;
  reason?: string | null;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
};

export async function writeModerationAudit(entry: ModerationAuditEntry): Promise<void> {
  await db().collection("moderation_audit").add({
    ...entry,
    reason: entry.reason ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    createdAt: new Date(),
  });
}
