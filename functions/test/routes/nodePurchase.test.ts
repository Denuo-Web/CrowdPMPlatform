import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodePurchaseRoutes } from "../../src/routes/nodePurchase.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { withRateLimitsEnabled } from "../helpers/rateLimitEnv.js";

const mocks = vi.hoisted(() => ({
  productsCreate: vi.fn(),
  checkoutSessionsCreate: vi.fn(),
  constructEvent: vi.fn(),
  rateLimitOrThrow: vi.fn(),
}));

let dbStore = new Map<string, Record<string, unknown>>();

function makeDocRef(path: string) {
  return {
    get: vi.fn(async () => {
      const data = dbStore.get(path);
      return {
        exists: Boolean(data),
        data: () => (data ? { ...data } : undefined),
      };
    }),
    set: vi.fn(async (payload: Record<string, unknown>, options?: { merge?: boolean }) => {
      const prev = dbStore.get(path) ?? {};
      const next = options?.merge ? { ...prev, ...payload } : { ...payload };
      dbStore.set(path, next);
    }),
  };
}

const mockDb = {
  collection: vi.fn((name: string) => ({
    doc: (id: string) => makeDocRef(`${name}/${id}`),
  })),
};

vi.mock("../../src/lib/fire.js", () => ({
  db: () => mockDb,
}));

vi.mock("../../src/lib/rateLimiter.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/rateLimiter.js")>();
  return { ...actual, rateLimitOrThrow: mocks.rateLimitOrThrow };
});

vi.mock("stripe", () => ({
  default: class MockStripe {
    products = {
      create: mocks.productsCreate,
    };

    checkout = {
      sessions: {
        create: mocks.checkoutSessionsCreate,
      },
    };

    webhooks = {
      constructEvent: mocks.constructEvent,
    };
  },
}));

async function buildApp() {
  const app = Fastify({ logger: false });
  app.setErrorHandler((err, req, rep) => {
    const normalized = toHttpError(err);
    if (normalized.headers) rep.headers(normalized.headers);
    rep.code(normalized.statusCode).send(normalized.body);
  });
  await app.register(nodePurchaseRoutes);
  await app.ready();
  return app;
}

withRateLimitsEnabled();

beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_replace_with_secret";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_replace_with_secret";
  process.env.PUBLIC_APP_BASE_URL = "https://crowdpmplatform.web.app";
  dbStore = new Map<string, Record<string, unknown>>();

  mocks.productsCreate.mockReset();
  mocks.checkoutSessionsCreate.mockReset();
  mocks.constructEvent.mockReset();
  mocks.rateLimitOrThrow.mockReset();

  mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  mocks.productsCreate.mockResolvedValue({
    id: "prod_node_123",
    default_price: "price_node_123",
  });
  mocks.checkoutSessionsCreate.mockResolvedValue({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    mode: "payment",
    currency: "usd",
    amount_subtotal: 30000,
    amount_total: 30000,
  });
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.PUBLIC_APP_BASE_URL;
  vi.clearAllMocks();
});

describe("POST /v1/node-purchase/checkout-session", () => {
  it("creates the product once, then creates a Checkout session for the node purchase", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
      headers: {
        "x-forwarded-for": "203.0.113.5",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      sessionId: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });

    expect(mocks.productsCreate).toHaveBeenCalledWith({
      name: "CrowdPM Node Hardware",
      default_price_data: {
        currency: "usd",
        unit_amount: 30000,
      },
    });
    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledWith({
      line_items: [
        {
          price: "price_node_123",
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: "https://crowdpmplatform.web.app/node?checkout=success",
      cancel_url: "https://crowdpmplatform.web.app/node?checkout=cancelled",
    });
    expect(dbStore.get("paymentCatalog/nodeHardware")).toMatchObject({
      productId: "prod_node_123",
      defaultPriceId: "price_node_123",
      currency: "usd",
      unitAmount: 30000,
    });
    expect(dbStore.get("nodePurchaseSessions/cs_test_123")).toMatchObject({
      sessionId: "cs_test_123",
      status: "created",
      productId: "prod_node_123",
      priceId: "price_node_123",
      mode: "payment",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
      currency: "usd",
      unitAmount: 30000,
      amountSubtotal: 30000,
      amountTotal: 30000,
    });
    await app.close();
  });

  it("reuses the stored catalog without creating a second product", async () => {
    dbStore.set("paymentCatalog/nodeHardware", {
      productId: "prod_existing",
      defaultPriceId: "price_existing",
      currency: "usd",
      unitAmount: 30000,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.productsCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [
        {
          price: "price_existing",
          quantity: 1,
        },
      ],
    }));
    await app.close();
  });

  it("recreates the Stripe catalog when the stored price no longer matches the expected node price", async () => {
    dbStore.set("paymentCatalog/nodeHardware", {
      productId: "prod_old",
      defaultPriceId: "price_old",
      currency: "usd",
      unitAmount: 2000,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.productsCreate).toHaveBeenCalledTimes(1);
    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [
        {
          price: "price_node_123",
          quantity: 1,
        },
      ],
    }));
    expect(dbStore.get("paymentCatalog/nodeHardware")).toMatchObject({
      productId: "prod_node_123",
      defaultPriceId: "price_node_123",
      currency: "usd",
      unitAmount: 30000,
    });
    await app.close();
  });
});

describe("POST /v1/payments/stripe/webhook", () => {
  it("marks completed checkout sessions after Stripe webhook verification", async () => {
    dbStore.set("nodePurchaseSessions/cs_test_123", {
      sessionId: "cs_test_123",
      status: "created",
    });
    mocks.constructEvent.mockReturnValue({
      id: "evt_123",
      type: "checkout.session.completed",
      created: 1_710_000_000,
      data: {
        object: {
          id: "cs_test_123",
          mode: "payment",
          payment_status: "paid",
          customer: "cus_123",
          customer_details: {
            email: "buyer@example.com",
          },
          customer_email: "buyer@example.com",
          payment_intent: "pi_123",
          currency: "usd",
          amount_subtotal: 30000,
          amount_total: 30000,
          url: null,
        },
      },
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/stripe/webhook",
      payload: { ok: true },
      headers: {
        "content-type": "application/json",
        "stripe-signature": "t=1,v1=signature",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ received: true });
    expect(mocks.constructEvent).toHaveBeenCalledWith(
      JSON.stringify({ ok: true }),
      "t=1,v1=signature",
      "whsec_replace_with_secret"
    );
    expect(dbStore.get("nodePurchaseSessions/cs_test_123")).toMatchObject({
      sessionId: "cs_test_123",
      status: "completed",
      eventId: "evt_123",
      mode: "payment",
      paymentStatus: "paid",
      customerId: "cus_123",
      customerEmail: "buyer@example.com",
      paymentIntentId: "pi_123",
      currency: "usd",
      amountSubtotal: 30000,
      amountTotal: 30000,
    });
    await app.close();
  });

  it("rejects webhook requests without a Stripe signature", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/payments/stripe/webhook",
      payload: { ok: true },
      headers: {
        "content-type": "application/json",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "invalid_request",
      message: "Missing Stripe signature.",
    });
    expect(mocks.constructEvent).not.toHaveBeenCalled();
    await app.close();
  });
});
