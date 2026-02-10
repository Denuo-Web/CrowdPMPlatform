import type { FastifyPluginAsync } from "fastify";
import {
  requestParam,
  rateLimitGuard,
  requireUserGuard,
  requestUserId,
} from "../lib/routeGuards.js";
import { getDevicesService } from "../services/devicesService.js";

export const devicesRoutes: FastifyPluginAsync = async (app) => {
  const devicesService = getDevicesService();

  app.get("/v1/devices", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `devices:list:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard("devices:list:global", 2_000, 60_000),
    ],
  }, async (req) => {
    return devicesService.list(requestUserId(req));
  });

  app.post<{ Body: { name?: string } }>("/v1/devices", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `devices:create:${requestUserId(req)}`, 10, 60_000),
      rateLimitGuard("devices:create:global", 500, 60_000),
    ],
  }, async (req, rep) => {
    const { name } = req.body ?? {};
    const result = await devicesService.create(requestUserId(req), { name });
    rep.code(201);
    return result;
  });

  app.post<{ Params: { deviceId: string } }>("/v1/devices/:deviceId/revoke", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `devices:revoke:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard((req) => `devices:revoke:device:${requestParam(req, "deviceId")}`, 10, 60_000),
      rateLimitGuard("devices:revoke:global", 500, 60_000),
    ],
  }, async (req) => {
    const { deviceId } = req.params;
    await devicesService.revoke(deviceId, requestUserId(req));
    return { status: "revoked" };
  });
};
