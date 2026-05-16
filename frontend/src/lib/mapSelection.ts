import { decodeBatchKey } from "./batchKeys";

export const MAP_SELECTION_STORAGE_KEYS = {
  lastSelection: "crowdpm:lastBatchSelection",
  lastMapZoom: "crowdpm:lastMapZoom",
  lastTimelineIndex: "crowdpm:lastTimelineIndex",
} as const;

export const SHOW_ALL_PUBLIC_24H_KEY = "__all_public_last_24h__";
export const MIN_PERSISTED_MAP_ZOOM = 0;
export const MAX_PERSISTED_MAP_ZOOM = 22;

export type StoredTimelineIndexes = Record<string, number>;

export function clampTimelineIndex(index: number, maxIndex: number): number {
  return Math.min(Math.max(Math.round(index), 0), Math.max(maxIndex, 0));
}

export function parseStoredMapZoom(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, MIN_PERSISTED_MAP_ZOOM), MAX_PERSISTED_MAP_ZOOM);
}

export function parseStoredTimelineIndexes(raw: string | null): StoredTimelineIndexes {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    );
  }
  catch {
    return {};
  }
}

export function readStoredTimelineIndex(raw: string | null, batchKey: string, maxIndex: number): number | null {
  const index = parseStoredTimelineIndexes(raw)[batchKey];
  if (typeof index !== "number" || !Number.isFinite(index)) return null;
  return clampTimelineIndex(index, maxIndex);
}

export function writeStoredTimelineIndex(raw: string | null, batchKey: string, index: number): string {
  return JSON.stringify({
    ...parseStoredTimelineIndexes(raw),
    [batchKey]: index,
  });
}

export function normalizeStoredBatchSelection(raw: string | null): {
  value: string;
  shouldClearInvalid: boolean;
} {
  if (!raw) {
    return { value: "", shouldClearInvalid: false };
  }
  if (raw === SHOW_ALL_PUBLIC_24H_KEY || decodeBatchKey(raw)) {
    return { value: raw, shouldClearInvalid: false };
  }
  return { value: "", shouldClearInvalid: true };
}
