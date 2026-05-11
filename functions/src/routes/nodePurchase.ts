import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { extractClientIp } from "../lib/http.js";
import { httpError } from "../lib/httpError.js";
import { rateLimitGuard } from "../lib/routeGuards.js";
import { createNodePurchaseCheckoutSession, handleStripeWebhook } from "../services/nodePurchase.js";

type RequestWithRawBody = {
  rawBody?: Buffer | string;
};

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
  }, async () => createNodePurchaseCheckoutSession());

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
