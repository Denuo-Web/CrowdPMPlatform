import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { extractClientIp } from "../lib/http.js";
import { httpError } from "../lib/httpError.js";
import {
  getOptionalRequestUser,
  getRequestUser,
  optionalUserGuard,
  rateLimitGuard,
  requestUserId,
  requireUserGuard,
} from "../lib/routeGuards.js";
import {
  confirmSubscriptionCheckoutSession,
  confirmThemeSaveCheckoutSession,
  createBillingPortalSession,
  createNodePurchaseCheckoutSession,
  createSubscriptionCheckoutSession,
  createThemeSaveCheckoutSession,
  handleStripeWebhook,
  listNodePurchaseReceipts,
} from "../services/nodePurchase.js";

type RequestWithRawBody = {
  rawBody?: Buffer | string;
};

const nodeCheckoutBodySchema = z.object({
  variantId: z.enum(["standard", "co2", "no2", "co2_no2"]).optional(),
  quantity: z.number().int().min(1).max(10).optional(),
}).strict();

const confirmThemeCheckoutBodySchema = z.object({
  sessionId: z.string().trim().min(1),
}).strict();

const subscriptionCheckoutBodySchema = z.object({
  offerId: z.enum(["pro_monthly", "pro_yearly"]),
}).strict();

const confirmSubscriptionCheckoutBodySchema = z.object({
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
      optionalUserGuard(),
      rateLimitGuard((req) => `node-purchase:checkout:ip:${requestIp(req)}`, 30, 60_000),
      rateLimitGuard("node-purchase:checkout:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const parsed = nodeCheckoutBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    const user = getOptionalRequestUser(req);
    return createNodePurchaseCheckoutSession({
      variantId: parsed.data.variantId,
      quantity: parsed.data.quantity,
      userId: user?.uid,
      customerEmail: user?.email ?? null,
    });
  });

  app.get("/v1/node-purchase/receipts", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `node-purchase:receipts:user:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard("node-purchase:receipts:global", 2_000, 60_000),
    ],
  }, async (req) => listNodePurchaseReceipts({
    userId: requestUserId(req),
  }));

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

  app.post("/v1/subscription/checkout-session", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `subscription:checkout:user:${requestUserId(req)}`, 10, 60_000),
      rateLimitGuard((req) => `subscription:checkout:ip:${requestIp(req)}`, 20, 60_000),
      rateLimitGuard("subscription:checkout:global", 500, 60_000),
    ],
  }, async (req) => {
    const parsed = subscriptionCheckoutBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    return createSubscriptionCheckoutSession({
      offerId: parsed.data.offerId,
      userId: requestUserId(req),
      customerEmail: getRequestUser(req).email ?? null,
    });
  });

  app.post("/v1/subscription/confirm", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `subscription:confirm:user:${requestUserId(req)}`, 20, 60_000),
      rateLimitGuard((req) => `subscription:confirm:ip:${requestIp(req)}`, 40, 60_000),
      rateLimitGuard("subscription:confirm:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const parsed = confirmSubscriptionCheckoutBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw httpError(400, "invalid_request", "invalid request", { details: parsed.error.flatten() });
    }
    return confirmSubscriptionCheckoutSession({
      sessionId: parsed.data.sessionId,
      userId: requestUserId(req),
    });
  });

  app.post("/v1/subscription/billing-portal", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `subscription:portal:user:${requestUserId(req)}`, 20, 60_000),
      rateLimitGuard((req) => `subscription:portal:ip:${requestIp(req)}`, 40, 60_000),
      rateLimitGuard("subscription:portal:global", 1_000, 60_000),
    ],
  }, async (req) => createBillingPortalSession({
    userId: requestUserId(req),
  }));

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
