import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nodePurchaseRoutes } from "../../src/routes/nodePurchase.js";
import { toHttpError } from "../../src/lib/httpError.js";
import { withRateLimitsEnabled } from "../helpers/rateLimitEnv.js";

const mocks = vi.hoisted(() => ({
  productsCreate: vi.fn(),
  checkoutSessionsCreate: vi.fn(),
  checkoutSessionsRetrieve: vi.fn(),
  constructEvent: vi.fn(),
  rateLimitOrThrow: vi.fn(),
  requireUser: vi.fn(),
}));

let dbStore = new Map<string, Record<string, unknown>>();

function makeDocRef(path: string) {
  return {
    get: vi.fn(async () => {
      const data = dbStore.get(path);
      return {
        exists: Boolean(data),
        get: (field: string) => data?.[field],
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

vi.mock("../../src/auth/firebaseVerify.js", () => ({
  requireUser: mocks.requireUser,
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
        retrieve: mocks.checkoutSessionsRetrieve,
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
  mocks.checkoutSessionsRetrieve.mockReset();
  mocks.constructEvent.mockReset();
  mocks.rateLimitOrThrow.mockReset();
  mocks.requireUser.mockReset();

  mocks.rateLimitOrThrow.mockReturnValue({ allowed: true, remaining: 59, retryAfterSeconds: 0 });
  mocks.requireUser.mockImplementation(async (req) => {
    const auth = req.headers?.authorization;
    if (!auth) throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    if (auth === "Bearer invalid") throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    return { uid: "user-123", email: "buyer@example.com" };
  });
  mocks.productsCreate.mockResolvedValue({
    id: "prod_node_123",
    default_price: "price_node_123",
  });
  mocks.checkoutSessionsCreate.mockResolvedValue({
    id: "cs_test_123",
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    mode: "payment",
    currency: "usd",
    amount_subtotal: 35000,
    amount_total: 35000,
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
      description: "Node hardware purchase with US shipping included.",
      tax_code: "txcd_99999999",
      default_price_data: {
        currency: "usd",
        unit_amount: 35000,
        tax_behavior: "exclusive",
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
      automatic_tax: {
        enabled: true,
      },
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      custom_text: {
        shipping_address: {
          message: "We currently ship CrowdPM nodes only to addresses in the United States.",
        },
        submit: {
          message: "Price includes US shipping. Applicable sales tax is calculated at checkout.",
        },
      },
      metadata: {
        purchaseType: "node_hardware",
        variantId: "standard",
        variantLabel: "PM2.5 standard node",
      },
      success_url: "https://crowdpmplatform.web.app/node?checkout=success",
      cancel_url: "https://crowdpmplatform.web.app/node?checkout=cancelled",
    });
    expect(dbStore.get("paymentCatalog/nodeHardware")).toMatchObject({
      productId: "prod_node_123",
      defaultPriceId: "price_node_123",
      currency: "usd",
      unitAmount: 35000,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
    });
    expect(dbStore.get("nodePurchaseSessions/cs_test_123")).toMatchObject({
      sessionId: "cs_test_123",
      status: "created",
      productId: "prod_node_123",
      priceId: "price_node_123",
      mode: "payment",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
      currency: "usd",
      unitAmount: 35000,
      automaticTaxEnabled: true,
      amountSubtotal: 35000,
      amountTotal: 35000,
      purchaseType: "node_hardware",
      variantId: "standard",
      variantLabel: "PM2.5 standard node",
    });
    await app.close();
  });

  it("creates the CO2-expanded node variant at the matching Stripe price", async () => {
    mocks.productsCreate.mockResolvedValueOnce({
      id: "prod_node_co2_123",
      default_price: "price_node_co2_123",
    });
    mocks.checkoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_node_co2_123",
      url: "https://checkout.stripe.com/c/pay/cs_node_co2_123",
      mode: "payment",
      currency: "usd",
      amount_subtotal: 37899,
      amount_total: 37899,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
      payload: {
        variantId: "co2",
      },
      headers: {
        "content-type": "application/json",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.productsCreate).toHaveBeenCalledWith({
      name: "CrowdPM Node Hardware - PM2.5 + CO2",
      description: "PM2.5 node with SCD41 CO2 sensor hardware, with US shipping included.",
      tax_code: "txcd_99999999",
      default_price_data: {
        currency: "usd",
        unit_amount: 37899,
        tax_behavior: "exclusive",
      },
    });
    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [
        {
          price: "price_node_co2_123",
          quantity: 1,
        },
      ],
      metadata: {
        purchaseType: "node_hardware",
        variantId: "co2",
        variantLabel: "PM2.5 + CO2 node",
      },
    }));
    expect(dbStore.get("paymentCatalog/nodeHardwareCo2")).toMatchObject({
      productId: "prod_node_co2_123",
      defaultPriceId: "price_node_co2_123",
      currency: "usd",
      unitAmount: 37899,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
    });
    expect(dbStore.get("nodePurchaseSessions/cs_node_co2_123")).toMatchObject({
      sessionId: "cs_node_co2_123",
      purchaseType: "node_hardware",
      unitAmount: 37899,
      amountSubtotal: 37899,
      amountTotal: 37899,
      variantId: "co2",
      variantLabel: "PM2.5 + CO2 node",
    });
    await app.close();
  });

  it("reuses the stored catalog without creating a second product", async () => {
    dbStore.set("paymentCatalog/nodeHardware", {
      productId: "prod_existing",
      defaultPriceId: "price_existing",
      currency: "usd",
      unitAmount: 35000,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
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
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
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
      unitAmount: 35000,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
    });
    await app.close();
  });

  it("recreates the Stripe catalog when the stored tax configuration is missing", async () => {
    dbStore.set("paymentCatalog/nodeHardware", {
      productId: "prod_old",
      defaultPriceId: "price_old",
      currency: "usd",
      unitAmount: 35000,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.productsCreate).toHaveBeenCalledTimes(1);
    expect(dbStore.get("paymentCatalog/nodeHardware")).toMatchObject({
      productId: "prod_node_123",
      defaultPriceId: "price_node_123",
      currency: "usd",
      unitAmount: 35000,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
    });
    await app.close();
  });

  it("rejects an unknown node purchase variant", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
      payload: {
        variantId: "bogus",
      },
      headers: {
        "content-type": "application/json",
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: "invalid_request",
      message: "invalid request",
    });
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    await app.close();
  });

});

describe("POST /v1/theme-purchase/checkout-session", () => {
  it("creates a one-time Stripe Checkout session for the theme save unlock", async () => {
    mocks.productsCreate.mockResolvedValueOnce({
      id: "prod_theme_123",
      default_price: "price_theme_123",
    });
    mocks.checkoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_theme_123",
      url: "https://checkout.stripe.com/c/pay/cs_theme_123",
      mode: "payment",
      currency: "usd",
      amount_subtotal: 300,
      amount_total: 300,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/theme-purchase/checkout-session",
      headers: {
        authorization: "Bearer ok",
        "x-forwarded-for": "203.0.113.6",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      sessionId: "cs_theme_123",
      url: "https://checkout.stripe.com/c/pay/cs_theme_123",
    });
    expect(mocks.productsCreate).toHaveBeenCalledWith({
      name: "CrowdPM Theme Save Unlock",
      description: "One-time digital expansion that permanently unlocks theme preference saving for a CrowdPM account.",
      tax_code: "txcd_99999999",
      default_price_data: {
        currency: "usd",
        unit_amount: 300,
        tax_behavior: "exclusive",
      },
    });
    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledWith({
      line_items: [
        {
          price: "price_theme_123",
          quantity: 1,
        },
      ],
      mode: "payment",
      automatic_tax: {
        enabled: true,
      },
      billing_address_collection: "required",
      custom_text: {
        submit: {
          message: "One-time digital expansion purchase that permanently unlocks theme preference saving for the purchasing account. Applicable sales tax is calculated at checkout.",
        },
      },
      customer_email: "buyer@example.com",
      client_reference_id: "user-123",
      metadata: {
        purchaseType: "theme_save_unlock",
        userId: "user-123",
      },
      success_url: "https://crowdpmplatform.web.app/?themeCheckout=success&themeCheckoutSessionId={CHECKOUT_SESSION_ID}",
      cancel_url: "https://crowdpmplatform.web.app/?themeCheckout=cancelled",
    });
    expect(dbStore.get("paymentCatalog/themeSaveUnlock")).toMatchObject({
      productId: "prod_theme_123",
      defaultPriceId: "price_theme_123",
      currency: "usd",
      unitAmount: 300,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
    });
    expect(dbStore.get("themeSavePurchaseSessions/cs_theme_123")).toMatchObject({
      sessionId: "cs_theme_123",
      status: "created",
      purchaseType: "theme_save_unlock",
      productId: "prod_theme_123",
      priceId: "price_theme_123",
      mode: "payment",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_theme_123",
      currency: "usd",
      unitAmount: 300,
      automaticTaxEnabled: true,
      amountSubtotal: 300,
      amountTotal: 300,
      userId: "user-123",
      customerEmail: "buyer@example.com",
    });
    await app.close();
  });

  it("requires authentication for the theme save unlock checkout", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/theme-purchase/checkout-session",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "unauthorized",
      message: "unauthorized",
    });
    await app.close();
  });

  it("rejects duplicate theme unlock purchases for an already unlocked account", async () => {
    dbStore.set("userSettings/user-123", {
      themeSaveUnlocked: true,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/theme-purchase/checkout-session",
      headers: {
        authorization: "Bearer ok",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: "theme_save_unlocked",
      message: "Theme saving is already unlocked for this account.",
    });
    expect(mocks.checkoutSessionsCreate).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("POST /v1/theme-purchase/confirm", () => {
  it("finalizes a paid theme checkout session for the signed-in account", async () => {
    dbStore.set("themeSavePurchaseSessions/cs_theme_123", {
      sessionId: "cs_theme_123",
      status: "created",
      userId: "user-123",
      purchaseType: "theme_save_unlock",
    });
    mocks.checkoutSessionsRetrieve.mockResolvedValue({
      id: "cs_theme_123",
      mode: "payment",
      payment_status: "paid",
      customer: "cus_theme_123",
      customer_details: {
        email: "buyer@example.com",
      },
      customer_email: "buyer@example.com",
      payment_intent: "pi_theme_123",
      automatic_tax: {
        enabled: true,
        status: "complete",
      },
      metadata: {
        purchaseType: "theme_save_unlock",
        userId: "user-123",
      },
      client_reference_id: "user-123",
      total_details: {
        amount_discount: 0,
        amount_shipping: 0,
        amount_tax: 27,
      },
      currency: "usd",
      amount_subtotal: 300,
      amount_total: 327,
      url: null,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/theme-purchase/confirm",
      payload: {
        sessionId: "cs_theme_123",
      },
      headers: {
        authorization: "Bearer ok",
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.6",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      confirmed: true,
      sessionId: "cs_theme_123",
      unlockGranted: true,
    });
    expect(mocks.checkoutSessionsRetrieve).toHaveBeenCalledWith("cs_theme_123");
    expect(dbStore.get("themeSavePurchaseSessions/cs_theme_123")).toMatchObject({
      sessionId: "cs_theme_123",
      status: "completed",
      purchaseType: "theme_save_unlock",
      paymentStatus: "paid",
      userId: "user-123",
      unlockGranted: true,
    });
    expect(dbStore.get("userSettings/user-123")).toMatchObject({
      themeSaveUnlocked: true,
      themeSaveUnlockedBySessionId: "cs_theme_123",
    });
    await app.close();
  });

  it("rejects confirming another account's theme checkout session", async () => {
    dbStore.set("themeSavePurchaseSessions/cs_theme_456", {
      sessionId: "cs_theme_456",
      status: "created",
      userId: "other-user",
      purchaseType: "theme_save_unlock",
    });
    mocks.checkoutSessionsRetrieve.mockResolvedValue({
      id: "cs_theme_456",
      mode: "payment",
      payment_status: "paid",
      metadata: {
        purchaseType: "theme_save_unlock",
        userId: "other-user",
      },
      client_reference_id: "other-user",
      total_details: {
        amount_discount: 0,
        amount_shipping: 0,
        amount_tax: 27,
      },
      currency: "usd",
      amount_subtotal: 300,
      amount_total: 327,
      url: null,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/theme-purchase/confirm",
      payload: {
        sessionId: "cs_theme_456",
      },
      headers: {
        authorization: "Bearer ok",
        "content-type": "application/json",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "theme_save_forbidden",
      message: "This theme save checkout does not belong to the signed-in account.",
    });
    expect(dbStore.get("userSettings/user-123")).toBeUndefined();
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
          metadata: {
            purchaseType: "node_hardware",
            variantId: "standard",
            variantLabel: "PM2.5 standard node",
          },
          mode: "payment",
          payment_status: "paid",
          customer: "cus_123",
          customer_details: {
            email: "buyer@example.com",
          },
          customer_email: "buyer@example.com",
          payment_intent: "pi_123",
          automatic_tax: {
            enabled: true,
            status: "complete",
          },
          collected_information: {
            shipping_details: {
              name: "Buyer Example",
              address: {
                city: "Seattle",
                country: "US",
                line1: "123 Pike St",
                line2: "Unit 4",
                postal_code: "98101",
                state: "WA",
              },
            },
          },
          total_details: {
            amount_discount: 0,
            amount_shipping: 0,
            amount_tax: 3150,
          },
          currency: "usd",
          amount_subtotal: 35000,
          amount_total: 38150,
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
      amountSubtotal: 35000,
      amountTotal: 38150,
      purchaseType: "node_hardware",
      variantId: "standard",
      variantLabel: "PM2.5 standard node",
      amountDiscount: 0,
      amountShipping: 0,
      amountTax: 3150,
      automaticTaxEnabled: true,
      automaticTaxStatus: "complete",
      shippingDetails: {
        name: "Buyer Example",
        address: {
          city: "Seattle",
          country: "US",
          line1: "123 Pike St",
          line2: "Unit 4",
          postalCode: "98101",
          state: "WA",
        },
      },
    });
    await app.close();
  });

  it("unlocks theme saving for the purchasing account after Stripe webhook verification", async () => {
    dbStore.set("themeSavePurchaseSessions/cs_theme_123", {
      sessionId: "cs_theme_123",
      status: "created",
      userId: "user-123",
      purchaseType: "theme_save_unlock",
    });
    mocks.constructEvent.mockReturnValue({
      id: "evt_theme_123",
      type: "checkout.session.completed",
      created: 1_710_000_100,
      data: {
        object: {
          id: "cs_theme_123",
          mode: "payment",
          payment_status: "paid",
          customer: "cus_theme_123",
          customer_details: {
            email: "buyer@example.com",
          },
          customer_email: "buyer@example.com",
          payment_intent: "pi_theme_123",
          automatic_tax: {
            enabled: true,
            status: "complete",
          },
          metadata: {
            purchaseType: "theme_save_unlock",
            userId: "user-123",
          },
          client_reference_id: "user-123",
          total_details: {
            amount_discount: 0,
            amount_shipping: 0,
            amount_tax: 27,
          },
          currency: "usd",
          amount_subtotal: 300,
          amount_total: 327,
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
    expect(dbStore.get("themeSavePurchaseSessions/cs_theme_123")).toMatchObject({
      sessionId: "cs_theme_123",
      status: "completed",
      purchaseType: "theme_save_unlock",
      eventId: "evt_theme_123",
      paymentStatus: "paid",
      customerId: "cus_theme_123",
      customerEmail: "buyer@example.com",
      paymentIntentId: "pi_theme_123",
      currency: "usd",
      amountSubtotal: 300,
      amountTotal: 327,
      amountDiscount: 0,
      amountShipping: 0,
      amountTax: 27,
      automaticTaxEnabled: true,
      automaticTaxStatus: "complete",
      userId: "user-123",
      unlockGranted: true,
    });
    expect(dbStore.get("userSettings/user-123")).toMatchObject({
      themeSaveUnlocked: true,
      themeSaveUnlockedBySessionId: "cs_theme_123",
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
