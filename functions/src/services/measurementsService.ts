import type { Timestamp, Firestore } from "firebase-admin/firestore";
import type { MeasurementRecord } from "@crowdpm/types";
import { db as getDb } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";
import { userOwnsDevice } from "../lib/deviceOwnership.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";
import { timestampToMillis, toDate } from "../lib/time.js";
import { normalizeTimestamp } from "../lib/httpValidation.js";

export type MeasurementsQuery = {
  userId: string;
  deviceId?: string | null;
  pollutant?: "pm25";
  start?: string | number | Date;
  end?: string | number | Date;
  limit?: string | number;
};

export type MeasurementDoc = {
  deviceId: string;
  pollutant: "pm25";
  value: number;
  unit?: string | null;
  lat: number;
  lon: number;
  altitude?: number | null;
  precision?: number | null;
  timestamp: Timestamp | Date | string | number;
  flags?: number;
};

type ResolvedDependencies = {
  db: Firestore;
  userOwnsDevice: typeof userOwnsDevice;
  rateLimitOrThrow: typeof rateLimitOrThrow;
};

type ParsedMeasurementsQuery = {
  userId: string;
  deviceId: string;
  pollutant: "pm25";
  start: Date;
  end: Date;
  limit: number;
};

export type MeasurementsServiceDependencies = Partial<ResolvedDependencies>;

export class MeasurementsService {
  private readonly deps: ResolvedDependencies;

  constructor(deps: MeasurementsServiceDependencies = {}) {
    this.deps = {
      db: deps.db ?? getDb(),
      userOwnsDevice: deps.userOwnsDevice ?? userOwnsDevice,
      rateLimitOrThrow: deps.rateLimitOrThrow ?? rateLimitOrThrow,
    };
  }

  async fetchRange(query: MeasurementsQuery): Promise<MeasurementRecord[]> {
    const parsed = this.normalizeQuery(query);
    if (!parsed) return [];

    this.deps.rateLimitOrThrow(`measurements:device:${parsed.deviceId}`, 60, 60_000);
    this.deps.rateLimitOrThrow("measurements:global", 2_000, 60_000);

    const devRef = this.deps.db.collection("devices").doc(parsed.deviceId);
    const devSnap = await devRef.get();
    if (!devSnap.exists) return [];
    if (!this.deps.userOwnsDevice(devSnap.data(), parsed.userId)) {
      throw httpError(403, "forbidden", "You do not have access to this device.");
    }

    const hours = this.buildHourBuckets(parsed.start, parsed.end);
    if (!hours.length) return [];

    const perBucketLimit = Math.max(1, Math.ceil(parsed.limit / hours.length));
    const out: MeasurementRecord[] = [];

    for (const bucketId of hours) {
      const snap = await devRef.collection("measures").doc(bucketId).collection("rows")
        .where("timestamp", ">=", parsed.start)
        .where("timestamp", "<=", parsed.end)
        .orderBy("timestamp", "asc")
        .limit(perBucketLimit)
        .get();
      snap.forEach((doc) => {
        const data = doc.data() as MeasurementDoc;
        if (parsed.pollutant && data.pollutant !== parsed.pollutant) return;
        out.push(this.serializeMeasurement(doc.id, data));
      });
    }

    out.sort((a, b) => (timestampToMillis(a.timestamp) ?? 0) - (timestampToMillis(b.timestamp) ?? 0));
    return out.slice(0, parsed.limit);
  }

  private normalizeQuery(query: MeasurementsQuery): ParsedMeasurementsQuery | null {
    if (!query.userId) {
      throw httpError(401, "unauthorized", "Authentication required");
    }
    const deviceId = (query.deviceId ?? "").trim();
    const start = toDate(query.start ?? null);
    const end = toDate(query.end ?? null);
    if (!deviceId || !start || !end) return null;

    const pollutant = (query.pollutant ?? "pm25") as "pm25";
    const limit = this.normalizeLimit(query.limit);

    return { userId: query.userId, deviceId, pollutant, start, end, limit };
  }

  private normalizeLimit(rawLimit: string | number | undefined): number {
    const fallback = 2000;
    if (rawLimit === undefined || rawLimit === null) return fallback;
    const parsed = Number(rawLimit);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(Math.max(1, Math.floor(parsed)), 5_000);
  }

  private buildHourBuckets(start: Date, end: Date): string[] {
    const hours: string[] = [];
    const cursor = new Date(Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate(),
      start.getUTCHours()
    ));
    while (cursor <= end && hours.length <= 240) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cursor.getUTCDate()).padStart(2, "0");
      const h = String(cursor.getUTCHours()).padStart(2, "0");
      hours.push(`${y}${m}${d}${h}`);
      cursor.setUTCHours(cursor.getUTCHours() + 1);
    }
    return hours;
  }

  private serializeMeasurement(id: string, data: MeasurementDoc): MeasurementRecord {
    const timestamp = normalizeTimestamp(data.timestamp) ?? new Date().toISOString();
    return { id, ...data, timestamp };
  }
}

let cachedMeasurementsService: MeasurementsService | null = null;

export function createMeasurementsService(overrides?: MeasurementsServiceDependencies): MeasurementsService {
  return new MeasurementsService(overrides);
}

export function getMeasurementsService(): MeasurementsService {
  if (!cachedMeasurementsService) {
    cachedMeasurementsService = createMeasurementsService();
  }
  return cachedMeasurementsService;
}
