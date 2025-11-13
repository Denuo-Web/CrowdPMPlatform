import * as https from "firebase-functions/v2/https";
import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "fastify-rate-limit";
import { Readable } from "node:stream";
import { app as adminApp } from "./lib/fire.js";
import { devicesRoutes } from "./routes/devices.js";
import { measurementsRoutes } from "./routes/measurements.js";
import { adminRoutes } from "./routes/admin.js";
import { batchesRoutes } from "./routes/batches.js";
import { deviceTokenPrivateKeySecret } from "./lib/runtimeConfig.js";
import { userSettingsRoutes } from "./routes/userSettings.js";
import { pairingRoutes } from "./routes/pairing.js";
import { activationRoutes } from "./routes/activation.js";
import { ensureDevAuthUser } from "./lib/devAuthUser.js";
adminApp();

const api = Fastify({ logger: true });

const parseJsonBody = (req: unknown, body: unknown, done: (err: Error | null, value?: unknown) => void) => {
  try {
    const text = typeof body === "string" ? body : body ? (body as Buffer).toString("utf8") : "";
    api.log.info(
      { parser: "json", contentType: (req as { headers?: Record<string, unknown> })?.headers?.["content-type"], length: typeof text === "string" ? text.length : undefined },
      "json parser invoked"
    );
    done(null, text ? JSON.parse(text) : {});
  }
  catch (err) {
    done(err as Error);
  }
};

api.removeContentTypeParser("application/json");
api.addContentTypeParser("application/json", { parseAs: "string" }, parseJsonBody);
api.addContentTypeParser(/^application\/(?:.+\+)?json(?:\s*;.*)?$/i, { parseAs: "string" }, parseJsonBody);

api.addHook("preParsing", (request, reply, payload, done) => {
  const rawBody = (request.raw as RequestWithRawBody).rawBody;
  if (rawBody === undefined) {
    done(null, payload);
    return;
  }
  const buffer = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  const stream = Readable.from(buffer);
  done(null, stream);
});

type RequestWithRawBody = https.Request & { rawBody?: Buffer | string };
const apiSetup = (async () => {
  await ensureDevAuthUser();
  await api.register(cors, { origin: true });
  await api.register(rateLimit, { max: 100, timeWindow: "1 minute" });

  api.get("/health", async () => ({ ok: true }));
  await api.register(devicesRoutes);
  await api.register(measurementsRoutes);
  await api.register(adminRoutes);
  await api.register(batchesRoutes);
  await api.register(userSettingsRoutes);
  await api.register(pairingRoutes);
  await api.register(activationRoutes);

  // Ensure all lifecycle hooks are ready before handling traffic.
  await api.ready();
})().catch((err) => {
  api.log.error(err, "failed to initialise API");
  throw err;
});

export const crowdpmApi = https.onRequest({ cors: true, secrets: [deviceTokenPrivateKeySecret] }, (req, res) => {
  const requestWithRawBody = req as RequestWithRawBody;
  requestWithRawBody.rawBody = requestWithRawBody.rawBody ?? undefined;
  apiSetup.then(() => api.server.emit("request", req, res));
});

export { ingestGateway } from "./services/ingestGateway.js";
export { ingestWorker } from "./services/ingestWorker.js";
