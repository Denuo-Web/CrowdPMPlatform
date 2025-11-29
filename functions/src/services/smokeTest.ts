import type { IngestBody } from "./ingestService.js";
import type { BatchVisibility } from "../lib/batchVisibility.js";

export type SmokeTestBody = {
  deviceId?: string;
  payload?: IngestBody;
  pointOverrides?: Partial<SmokeTestPoint>;
  visibility?: BatchVisibility;
};

type SmokeTestPoint = NonNullable<IngestBody["points"]>[number];

export type SmokeTestPlan = {
  payload: IngestBody & { points: SmokeTestPoint[] };
  displayPoints: SmokeTestPoint[];
  ownerSegment: string;
  primaryDeviceId: string;
  scopedDeviceIds: string[];
  seedTargets: string[];
  scopedToRawIds: Map<string, string>;
};

const DEFAULT_DEVICE_ID = "device-123";
const BASE_LAT = 40.7128;
const BASE_LON = -74.0060;

export function prepareSmokeTestPlan(userId: string, body?: SmokeTestBody): SmokeTestPlan {
  const ownerSegment = slugify(userId, "user");
  const overrides = sanitizeOverrides(body?.pointOverrides);
  const requestedDeviceId = ensureDeviceId(
    body?.deviceId ||
    overrides.device_id ||
    body?.payload?.points?.[0]?.device_id ||
    body?.payload?.device_id,
    DEFAULT_DEVICE_ID
  );

  const displayPoints = buildPoints(body?.payload?.points, overrides, requestedDeviceId);
  if (!displayPoints.length) {
    throw new Error("payload must include at least one point");
  }

  const { scopedPoints, scopedDeviceIds, scopedToRawIds } = scopePoints(displayPoints, ownerSegment, requestedDeviceId);
  const primaryDeviceId = scopedDeviceIds[0] ?? scopeDeviceId(ownerSegment, requestedDeviceId);
  const seedTargets = scopedDeviceIds.length ? scopedDeviceIds : [primaryDeviceId];

  const payload: IngestBody & { points: SmokeTestPoint[] } = {
    ...(body?.payload ?? {}),
    points: scopedPoints,
  };

  return {
    payload,
    displayPoints,
    ownerSegment,
    primaryDeviceId,
    scopedDeviceIds,
    seedTargets,
    scopedToRawIds,
  };
}

function sanitizeOverrides(overrides?: Partial<SmokeTestPoint>): Partial<SmokeTestPoint> {
  if (!overrides) return {};
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => value !== undefined)
  ) as Partial<SmokeTestPoint>;
}

function buildPoints(
  points: SmokeTestPoint[] | undefined,
  overrides: Partial<SmokeTestPoint>,
  requestedDeviceId: string
): SmokeTestPoint[] {
  if (points?.length) {
    return points.map((point, idx, arr) => {
      const fallbackTimestamp = new Date(Date.now() - (arr.length - idx - 1) * 1000).toISOString();
      const merged = { ...point, ...overrides };
      return {
        ...merged,
        pollutant: merged.pollutant ?? "pm25",
        device_id: ensureDeviceId(merged.device_id, requestedDeviceId),
        timestamp: merged.timestamp ?? fallbackTimestamp,
      };
    });
  }
  return buildDefaultPoints(requestedDeviceId, overrides);
}

function buildDefaultPoints(deviceId: string, overrides: Partial<SmokeTestPoint>): SmokeTestPoint[] {
  const now = Date.now();
  return Array.from({ length: 60 }, (_, idx) => {
    const secondsAgo = 59 - idx;
    const ts = new Date(now - secondsAgo * 1000);
    const progress = idx / 59;
    const latOffset = Math.sin(progress * Math.PI * 2) * 0.0002;
    const lonOffset = Math.cos(progress * Math.PI * 2) * 0.0002;
    const altitude = 25 + Math.sin(progress * Math.PI * 6) * 5 + Math.random() * 2;
    const baseValue = 15 + Math.sin(progress * Math.PI * 4) * 10 + Math.random();
    const precision = 5 + Math.round(Math.abs(Math.cos(progress * Math.PI * 2)) * 20);
    const basePoint: SmokeTestPoint = {
      device_id: deviceId,
      pollutant: "pm25",
      value: Math.round(baseValue * 10) / 10,
      unit: "\u00b5g/m\u00b3",
      lat: Number((BASE_LAT + latOffset).toFixed(6)),
      lon: Number((BASE_LON + lonOffset).toFixed(6)),
      timestamp: ts.toISOString(),
      precision,
      altitude: Number(altitude.toFixed(1)),
    };
    const merged = { ...basePoint, ...overrides };
    return {
      ...merged,
      device_id: ensureDeviceId(merged.device_id, basePoint.device_id),
      pollutant: merged.pollutant ?? "pm25",
      timestamp: merged.timestamp ?? basePoint.timestamp,
    };
  });
}

function scopePoints(points: SmokeTestPoint[], ownerSegment: string, requestedDeviceId: string) {
  const rawDeviceIds = Array.from(new Set(
    points
      .map((point) => point.device_id)
      .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
  ));
  if (!rawDeviceIds.length) {
    rawDeviceIds.push(requestedDeviceId);
  }

  const rawToScoped = new Map<string, string>();
  const scopedToRaw = new Map<string, string>();

  const scopedPoints = points.map((point, idx) => {
    const rawId = point.device_id || rawDeviceIds[idx % rawDeviceIds.length] || requestedDeviceId;
    let scopedId = rawToScoped.get(rawId);
    if (!scopedId) {
      scopedId = scopeDeviceId(ownerSegment, rawId);
      rawToScoped.set(rawId, scopedId);
      scopedToRaw.set(scopedId, rawId);
    }
    return { ...point, device_id: scopedId };
  });

  const scopedDeviceIds = Array.from(new Set(
    scopedPoints
      .map((point) => point.device_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  ));

  return { scopedPoints, scopedDeviceIds, scopedToRawIds: scopedToRaw };
}

function slugify(value: string | undefined | null, fallback: string) {
  if (!value) return fallback;

  const source = value.toString().toLowerCase();
  const result: string[] = [];
  let lastWasDash = true; // treat start as dash to avoid leading separators

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const isAlphanumeric =
      (char >= "a" && char <= "z") || (char >= "0" && char <= "9");

    if (isAlphanumeric) {
      result.push(char);
      lastWasDash = false;
      continue;
    }

    if (!lastWasDash) {
      result.push("-");
      lastWasDash = true;
    }
  }

  if (result[result.length - 1] === "-") {
    result.pop();
  }

  return result.join("") || fallback;
}

function scopeDeviceId(ownerSegment: string, rawDeviceId: string) {
  const deviceSegment = slugify(rawDeviceId, "device");
  return `${ownerSegment}-${deviceSegment}`;
}

function ensureDeviceId(candidate: unknown, fallback: string): string {
  const trimmed = typeof candidate === "string" ? candidate.trim() : "";
  return trimmed || fallback;
}
