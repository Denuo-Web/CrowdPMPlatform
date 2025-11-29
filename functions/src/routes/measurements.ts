import type { FastifyPluginAsync } from "fastify";
import { rateLimitGuard, requireUserGuard, requestUserId } from "../lib/routeGuards.js";
import { getMeasurementsService } from "../services/measurementsService.js";

type MeasurementsRouteQuery = {
  device_id?: string;
  pollutant?: "pm25";
  t0?: string;
  t1?: string;
  limit?: string | number;
};

export const measurementsRoutes: FastifyPluginAsync = async (app) => {
  const measurementsService = getMeasurementsService();

  app.get<{ Querystring: MeasurementsRouteQuery }>("/v1/measurements", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `measurements:user:${requestUserId(req)}`, 30, 60_000),
    ],
  }, async (req) => {
    const userId = requestUserId(req);
    const {
      device_id: deviceIdParam,
      pollutant = "pm25",
      t0: t0Param,
      t1: t1Param,
      limit: limitParam,
    } = req.query ?? {};
    return measurementsService.fetchRange({
      userId,
      deviceId: deviceIdParam,
      pollutant,
      start: t0Param,
      end: t1Param,
      limit: limitParam,
    });
  });
};
