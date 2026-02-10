import type { ModerationState } from "@crowdpm/types";

export type { ModerationState };

export const DEFAULT_MODERATION_STATE: ModerationState = "approved";

export function normalizeModerationState(value: unknown, fallback: ModerationState = DEFAULT_MODERATION_STATE): ModerationState {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "approved" || normalized === "quarantined") {
    return normalized;
  }
  return fallback;
}
