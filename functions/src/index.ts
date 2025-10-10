import * as https from "firebase-functions/v2/https";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { app as adminApp } from "./lib/fire.js";
import { devicesRoutes } from "./routes/devices.js";
import { measurementsRoutes } from "./routes/measurements.js";
import { adminRoutes } from "./routes/admin.js";
adminApp();

const api = Fastify({ logger: true });
type RequestWithRawBody = https.Request & { rawBody?: Buffer | string };
const apiSetup = (async () => {
  await api.register(cors, { origin: true });
  await api.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  api.get("/health", async () => ({ ok: true }));
  await api.register(devicesRoutes);
  await api.register(measurementsRoutes);
  await api.register(adminRoutes);

  // Ensure all lifecycle hooks are ready before handling traffic.
  await api.ready();
})().catch((err) => {
  api.log.error(err, "failed to initialise API");
  throw err;
});

export const crowdpmApi = https.onRequest({ cors: true }, (req, res) => {
  const requestWithRawBody = req as RequestWithRawBody;
  requestWithRawBody.rawBody = requestWithRawBody.rawBody ?? undefined;
  apiSetup.then(() => api.server.emit("request", req, res));
});

export { ingestGateway } from "./services/ingestGateway.js";
export { ingestWorker } from "./services/ingestWorker.js";
