import * as https from "firebase-functions/v2/https";
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "fastify-rate-limit";
import { Readable } from "node:stream";
import { app as adminApp } from "./lib/fire.js";
import { devicesRoutes } from "./routes/devices.js";
import { adminRoutes } from "./routes/admin.js";
import { adminSubmissionsRoutes } from "./routes/adminSubmissions.js";
import { adminUsersRoutes } from "./routes/adminUsers.js";
import { batchesRoutes } from "./routes/batches.js";
import { publicBatchesRoutes } from "./routes/publicBatches.js";
import { userSettingsRoutes } from "./routes/userSettings.js";
import { pairingRoutes } from "./routes/pairing.js";
import { activationRoutes } from "./routes/activation.js";
import { nodePurchaseRoutes } from "./routes/nodePurchase.js";
import { ensureLocalSuperAdmin } from "./lib/localSuperAdmin.js";
import { toHttpError } from "./lib/httpError.js";
import { RateLimitError } from "./lib/rateLimiter.js";
import { fastifyCorsOptionsForRequest } from "./lib/corsPolicy.js";
import { crowdpmApiRuntimeOptions } from "./lib/functionOptions.js";
import { stripApiEntryPrefix } from "./lib/http.js";

type RequestWithRawBody = https.Request & { rawBody?: Buffer | string };
type ResponseLike = {
  headersSent?: boolean;
  writeHead: (statusCode: number, headers: Record<string, string>) => void;
  end: (chunk?: string) => void;
};

type ApiDependencies = {
  initializeAdminApp?: () => unknown;
  ensureLocalSuperAdmin?: () => Promise<void>;
  rateLimitsEnabled?: boolean;
  routes?: FastifyPluginAsync[];
  logger?: boolean;
};

const DEFAULT_API_ROUTES: FastifyPluginAsync[] = [
  devicesRoutes,
  adminRoutes,
  adminSubmissionsRoutes,
  adminUsersRoutes,
  batchesRoutes,
  publicBatchesRoutes,
  userSettingsRoutes,
  pairingRoutes,
  activationRoutes,
  nodePurchaseRoutes,
];

function defaultRateLimitsEnabled(): boolean {
  const isEmulatorRuntime = process.env.FUNCTIONS_EMULATOR === "true"
    || Boolean(process.env.FIREBASE_EMULATOR_HUB);
  return process.env.ENABLE_RATE_LIMITS === "true"
    || (!isEmulatorRuntime && process.env.NODE_ENV !== "test");
}

function createJsonBodyParser(api: FastifyInstance) {
  return (req: unknown, body: unknown, done: (err: Error | null, value?: unknown) => void) => {
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
}

export async function buildApi(deps: ApiDependencies = {}): Promise<FastifyInstance> {
  (deps.initializeAdminApp ?? adminApp)();
  const api = Fastify({ logger: deps.logger ?? true });
  const parseJsonBody = createJsonBodyParser(api);

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

  api.setErrorHandler((err, req, rep) => {
    const normalized = toHttpError(err);
    const log = normalized.statusCode >= 500 ? req.log.error.bind(req.log) : req.log.warn.bind(req.log);
    log({ err }, "request failed");
    if (normalized.headers) rep.headers(normalized.headers);
    rep.code(normalized.statusCode).send(normalized.body);
  });

  await (deps.ensureLocalSuperAdmin ?? ensureLocalSuperAdmin)();
  await api.register(cors, {
    delegator: (req, callback) => {
      callback(null, fastifyCorsOptionsForRequest(req));
    },
  });

  if (deps.rateLimitsEnabled ?? defaultRateLimitsEnabled()) {
    // fastify-rate-limit and routeGuards both run per process. Keep edge/shared
    // controls in front of abuse-critical paths when deployed across instances.
    await api.register(rateLimit, {
      max: 100,
      timeWindow: "1 minute",
      errorResponseBuilder: (_request, context) => new RateLimitError(Math.max(1, Math.ceil(context.ttl / 1000))),
    });
  }

  api.get("/health", async () => ({ ok: true }));
  for (const route of deps.routes ?? DEFAULT_API_ROUTES) {
    await api.register(route);
  }

  await api.ready();
  return api;
}

let apiServerPromise: Promise<FastifyInstance> | null = null;

function getApiServer(): Promise<FastifyInstance> {
  if (!apiServerPromise) {
    apiServerPromise = buildApi().catch((err) => {
      apiServerPromise = null;
      throw err;
    });
  }
  return apiServerPromise;
}

function sendStartupError(res: ResponseLike, err: unknown): void {
  const normalized = toHttpError(err, 503);
  const headers = {
    "content-type": "application/json; charset=utf-8",
    ...(normalized.headers ?? {}),
  };
  if ((res as { headersSent?: boolean }).headersSent) {
    res.end();
    return;
  }
  res.writeHead(normalized.statusCode, headers);
  res.end(JSON.stringify(normalized.body));
}

export const crowdpmApi = https.onRequest({
  ...crowdpmApiRuntimeOptions,
  secrets: ["DEVICE_TOKEN_PRIVATE_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
}, async (req, res) => {
  try {
    const requestWithRawBody = req as RequestWithRawBody;
    requestWithRawBody.rawBody = requestWithRawBody.rawBody ?? undefined;
    requestWithRawBody.url = stripApiEntryPrefix(requestWithRawBody.url);
    const api = await getApiServer();
    api.server.emit("request", req, res);
  }
  catch (err) {
    console.error("failed to initialise API", err);
    sendStartupError(res, err);
  }
});

export { ingestGateway } from "./services/ingestGateway.js";
export { refreshPublicBatchMap } from "./services/publicBatchMapRefresh.js";
