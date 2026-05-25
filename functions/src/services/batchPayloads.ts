import { gunzipSync, gzipSync } from "node:zlib";
import type { BatchVisibility } from "@crowdpm/types";
import { IngestPayload, type IngestPayload as IngestPayloadType } from "../lib/validation.js";

export const BATCH_SCHEMA_VERSION = 2;

export type BatchBounds = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
} | null;

export type BatchTimeRange = {
  startedAt: Date | null;
  endedAt: Date | null;
};

export type BatchPayloadMetadata = BatchTimeRange & {
  pointCount: number;
  bounds: BatchBounds;
};

export type BatchMetadataDocument = {
  schemaVersion: typeof BATCH_SCHEMA_VERSION;
  batchId: string;
  deviceId: string;
  ownerUserIds: string[];
  deviceNameSnapshot: string | null;
  storagePath: string;
  compressedBytes: number;
  count: number;
  startedAt: Date | null;
  endedAt: Date | null;
  bounds: BatchBounds;
  processedAt: Date;
  visibility: BatchVisibility;
  moderationState: "approved" | "quarantined";
  moderationReason: string | null;
  moderatedBy: string | null;
  moderatedAt: Date | null;
};

function pathSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

export function buildBatchStoragePath(args: { primaryOwnerUserId: string; deviceId: string; batchId: string }): string {
  return [
    "ingest",
    "v2",
    pathSegment(args.primaryOwnerUserId),
    pathSegment(args.deviceId),
    `${pathSegment(args.batchId)}.json.gz`,
  ].join("/");
}

export function encodeBatchPayload(payload: IngestPayloadType): { buffer: Buffer; canonicalJson: string } {
  const canonicalJson = JSON.stringify(payload);
  return {
    canonicalJson,
    buffer: gzipSync(Buffer.from(canonicalJson, "utf8")),
  };
}

export function decodeBatchPayload(buffer: Buffer, storagePath: string): IngestPayloadType {
  if (!storagePath.endsWith(".json.gz")) {
    throw new Error("stored batch payload must use the v2 gzip format");
  }
  const json = gunzipSync(buffer).toString("utf8");
  const parsed = IngestPayload.safeParse(JSON.parse(json));
  if (!parsed.success) {
    throw new Error("stored batch payload is invalid");
  }
  return parsed.data;
}

export function summarizeBatchPayload(payload: IngestPayloadType): BatchPayloadMetadata {
  const points = payload.points;
  let startedAt: Date | null = null;
  let endedAt: Date | null = null;
  let minLat = Infinity;
  let minLon = Infinity;
  let maxLat = -Infinity;
  let maxLon = -Infinity;

  for (const point of points) {
    const ts = new Date(point.timestamp);
    if (!Number.isNaN(ts.getTime())) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (!endedAt || ts > endedAt) endedAt = ts;
    }
    minLat = Math.min(minLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLat = Math.max(maxLat, point.lat);
    maxLon = Math.max(maxLon, point.lon);
  }

  const bounds = Number.isFinite(minLat) && Number.isFinite(minLon) && Number.isFinite(maxLat) && Number.isFinite(maxLon)
    ? { minLat, minLon, maxLat, maxLon }
    : null;

  return {
    pointCount: points.length,
    startedAt,
    endedAt,
    bounds,
  };
}
