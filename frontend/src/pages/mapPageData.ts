import { timestampToMillis, type IngestPoint } from "@crowdpm/types";
import { encodeBatchKey } from "../lib/batchKeys";
import type { BatchSummary, MeasurementRecord } from "../lib/api";

export const BATCH_LIST_STALE_MS = 30_000;
export const DROPDOWN_BATCH_LIMIT = 20;
export const SHOW_ALL_PUBLIC_LOOKBACK_MS = 24 * 60 * 60 * 1000;
export const SHOW_ALL_PUBLIC_BATCH_LIMIT = 200;
export const EXPANDED_BATCH_FETCH_LIMIT = 500;

const TERMINAL_BATCH_ERROR_MESSAGES = ["unauthorized", "authentication required", "not_found", "batch not found"] as const;

export type VisibleBatchAccess = "owned" | "public" | "both";
export type VisibleBatchSummary = BatchSummary & {
  access: VisibleBatchAccess;
};

export type BatchBrowserTimeRange = "all" | "8h" | "24h" | "7d" | "30d";

export type MapMeasurementRecord = MeasurementRecord & {
  batchKey?: string;
  batchPointIndex?: number;
};

export function formatBatchLabel(batch: BatchSummary) {
  const timeMs = timestampToMillis(batch.processedAt);
  const timeLabel = timeMs === null ? "Pending timestamp" : new Date(timeMs).toLocaleString();
  const name = batch.deviceName?.trim().length ? batch.deviceName : batch.deviceId;
  const countLabel = batch.count ? ` (${batch.count})` : "";
  return `${timeLabel} \u2014 ${name}${countLabel}`;
}

export function sortBatchesByProcessedAtDesc<T extends BatchSummary>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const timeA = timestampToMillis(a.processedAt) ?? 0;
    const timeB = timestampToMillis(b.processedAt) ?? 0;
    return timeB - timeA;
  });
}

export function getBatchBrowserTimeRangeCutoff(range: BatchBrowserTimeRange): number | null {
  switch (range) {
    case "8h":
      return Date.now() - 8 * 60 * 60 * 1000;
    case "24h":
      return Date.now() - 24 * 60 * 60 * 1000;
    case "7d":
      return Date.now() - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return Date.now() - 30 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}

export function toPublicVisibleBatches(publicBatches: BatchSummary[]): VisibleBatchSummary[] {
  return publicBatches.map((batch) => ({ ...batch, access: "public" }));
}

export function mergeBatchLists(primaryBatches: BatchSummary[], publicBatches: BatchSummary[]): VisibleBatchSummary[] {
  const byKey = new Map<string, VisibleBatchSummary>();
  toPublicVisibleBatches(publicBatches).forEach((batch) => {
    byKey.set(encodeBatchKey(batch.deviceId, batch.batchId), batch);
  });
  primaryBatches.forEach((batch) => {
    const key = encodeBatchKey(batch.deviceId, batch.batchId);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...batch,
      access: existing ? "both" : "owned",
    });
  });
  return sortBatchesByProcessedAtDesc(Array.from(byKey.values()));
}

export function isTerminalBatchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return TERMINAL_BATCH_ERROR_MESSAGES.some((fragment) => message.includes(fragment));
}

export function pointsToMeasurementRecords(
  points: IngestPoint[],
  fallbackDeviceId: string,
  batchId: string,
  options?: { batchKey?: string }
): MapMeasurementRecord[] {
  return [...points]
    .sort((a, b) => {
      const aTs = timestampToMillis(a.timestamp as unknown as MeasurementRecord["timestamp"]) ?? 0;
      const bTs = timestampToMillis(b.timestamp as unknown as MeasurementRecord["timestamp"]) ?? 0;
      return aTs - bTs;
    })
    .map((point, idx) => {
      const deviceId = typeof point.device_id === "string" && point.device_id.length
        ? point.device_id
        : fallbackDeviceId;
      return {
        id: `${batchId}-${deviceId}-${idx}`,
        deviceId,
        pollutant: "pm25",
        value: point.value,
        unit: point.unit ?? "\u00b5g/m\u00b3",
        lat: point.lat ?? 0,
        lon: point.lon ?? 0,
        altitude: point.altitude ?? null,
        precision: point.precision ?? null,
        timestamp: point.timestamp,
        flags: point.flags ?? 0,
        batchKey: options?.batchKey,
        batchPointIndex: idx,
      } satisfies MapMeasurementRecord;
    });
}
