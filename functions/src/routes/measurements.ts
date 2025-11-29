import type { FastifyPluginAsync } from "fastify";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/fire.js";
import { rateLimitOrThrow } from "../lib/rateLimiter.js";
import { userOwnsDevice } from "../lib/deviceOwnership.js";
import { timestampToIsoString, timestampToMillis } from "../lib/time.js";
import { httpError } from "../lib/httpError.js";
import { getRequestUser, rateLimitGuard, requireUserGuard, requestUserId } from "../lib/routeGuards.js";

type MeasurementsQuery = {
  device_id?: string;
  pollutant?: "pm25";
  t0?: string;
  t1?: string;
  limit?: string | number;
};

type MeasurementDoc = {
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

type MeasurementRecord = MeasurementDoc & { id: string };

export const measurementsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: MeasurementsQuery }>("/v1/measurements", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `measurements:user:${requestUserId(req)}`, 30, 60_000),
    ],
  }, async (req) => {
    const user = getRequestUser(req);
    const {
      device_id: deviceIdParam,
      pollutant = "pm25",
      t0: t0Param,
      t1: t1Param,
      limit: limitParam,
    } = req.query ?? {};

    const deviceId = deviceIdParam ?? "";
    const t0 = new Date(t0Param ?? "");
    const t1 = new Date(t1Param ?? "");
    const limit = Math.min(Number(limitParam ?? 2000), 5000);
    if (!deviceId || Number.isNaN(t0.getTime()) || Number.isNaN(t1.getTime())) return [];
    rateLimitOrThrow(`measurements:device:${deviceId}`, 60, 60_000);
    rateLimitOrThrow("measurements:global", 2_000, 60_000);

    const doc = await db().collection("devices").doc(deviceId).get();
    if (!doc.exists) return [];
    if (!userOwnsDevice(doc.data(), user.uid)) {
      throw httpError(403, "forbidden", "You do not have access to this device.");
    }

    const hours: string[] = [];
    const cur = new Date(Date.UTC(
      t0.getUTCFullYear(),
      t0.getUTCMonth(),
      t0.getUTCDate(),
      t0.getUTCHours()
    ));
    while (cur <= t1 && hours.length <= 240) {
      const y = cur.getUTCFullYear();
      const m = String(cur.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cur.getUTCDate()).padStart(2, "0");
      const h = String(cur.getUTCHours()).padStart(2, "0");
      hours.push(`${y}${m}${d}${h}`);
      cur.setUTCHours(cur.getUTCHours() + 1);
    }

    const base = db().collection("devices").doc(deviceId).collection("measures");
    const out: MeasurementRecord[] = [];
    for (const bucketId of hours) {
      const snap = await base.doc(bucketId).collection("rows")
        .where("timestamp", ">=", t0)
        .where("timestamp", "<=", t1)
        .orderBy("timestamp", "asc")
        .limit(Math.max(1, Math.ceil(limit / hours.length)))
        .get();
      snap.forEach((doc) => {
        const data = doc.data() as MeasurementDoc;
        if (pollutant && data.pollutant !== pollutant) return;
        const timestamp = timestampToIsoString(data.timestamp) ?? new Date().toISOString();
        out.push({ id: doc.id, ...data, timestamp });
      });
    }

    out.sort((a, b) => (timestampToMillis(a.timestamp) ?? 0) - (timestampToMillis(b.timestamp) ?? 0));
    return out.slice(0, limit);
  });
};
