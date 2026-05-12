import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { extractClientIp } from "../lib/http.js";
import { httpError } from "../lib/httpError.js";
import { getRequestUser, rateLimitGuard, requestUserId, requireUserGuard } from "../lib/routeGuards.js";
import {
  confirmThemeSaveCheckoutSession,
  createNodePurchaseCheckoutSession,
  createThemeSaveCheckoutSession,
  handleStripeWebhook,
} from "../services/nodePurchase.js";

type RequestWithRawBody = {
  rawBody?: Buffer | string;
};

const nodeCheckoutBodySchema = z.object({
  variantId: z.enum(["standard", "co2", "no2", "co2_no2"]).optional(),
}).strict();

const confirmThemeCheckoutBodySchema = z.object({
  sessionId: z.string().trim().min(1),
}).strict();

function requestIp(req: FastifyRequest): string {
  return extractClientIp(req.headers) ?? req.ip ?? "unknown";
}

function rawBodyAsString(req: FastifyRequest): string {
  const rawBody = (req.raw as RequestWithRawBody).rawBody;
  return typeof rawBody === "string"
    ? rawBody
    : rawBody?.toString("utf8") ?? JSON.stringify(req.body ?? {});
}

export const nodePurchaseRoutes: FastifyPluginAsync = async (app) => {
  app.post("/v1/node-purchase/checkout-session", {
    preHandler: [
      rateLimitGuard((req) => `node-purchase:checkout:ip:${requestIp(req)}`, 30, 60_000),
      rateLimitGuard("node-purchase:checkout:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const parsed = nodeCheckoutBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    return createNodePurchaseCheckoutSession({
      variantId: parsed.data.variantId,
    });
  });

  app.post("/v1/theme-purchase/checkout-session", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `theme-purchase:checkout:user:${requestUserId(req)}`, 10, 60_000),
      rateLimitGuard((req) => `theme-purchase:checkout:ip:${requestIp(req)}`, 20, 60_000),
      rateLimitGuard("theme-purchase:checkout:global", 500, 60_000),
    ],
  }, async (req) => createThemeSaveCheckoutSession({
    userId: requestUserId(req),
    customerEmail: getRequestUser(req).email ?? null,
  }));

  app.post("/v1/theme-purchase/confirm", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `theme-purchase:confirm:user:${requestUserId(req)}`, 20, 60_000),
      rateLimitGuard((req) => `theme-purchase:confirm:ip:${requestIp(req)}`, 40, 60_000),
      rateLimitGuard("theme-purchase:confirm:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const parsed = confirmThemeCheckoutBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    return confirmThemeSaveCheckoutSession({
      sessionId: parsed.data.sessionId,
      userId: requestUserId(req),
    });
  });

  app.post("/v1/payments/stripe/webhook", {
    preHandler: [
      rateLimitGuard((req) => `stripe:webhook:ip:${requestIp(req)}`, 120, 60_000),
      rateLimitGuard("stripe:webhook:global", 5_000, 60_000),
    ],
  }, async (req) => {
    const signature = req.headers["stripe-signature"];
    if (typeof signature !== "string" || signature.trim().length === 0) {
      throw httpError(400, "invalid_request", "Missing Stripe signature.");
    }
    return handleStripeWebhook({
      signature,
      rawBody: rawBodyAsString(req),
    });
  });
};
