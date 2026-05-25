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

function makeQueryRef(
  collectionName: string,
  filters: Array<{ field: string; value: unknown }> = [],
  queryLimit = Number.POSITIVE_INFINITY,
) {
  return {
    where: vi.fn((field: string, op: string, value: unknown) => {
      if (op !== "==") throw new Error(`unsupported op ${op}`);
      return makeQueryRef(collectionName, [...filters, { field, value }], queryLimit);
    }),
    limit: vi.fn((limit: number) => makeQueryRef(collectionName, filters, limit)),
    get: vi.fn(async () => {
      const prefix = `${collectionName}/`;
      const docs = Array.from(dbStore.entries())
        .filter(([path, data]) => path.startsWith(prefix)
          && filters.every((filter) => data[filter.field] === filter.value))
        .slice(0, queryLimit)
        .map(([path, data]) => ({
          id: path.slice(prefix.length),
          data: () => ({ ...data }),
        }));
      return { docs };
    }),
  };
}

const mockDb = {
  collection: vi.fn((name: string) => ({
    doc: (id: string) => makeDocRef(`${name}/${id}`),
    where: (field: string, op: string, value: unknown) => makeQueryRef(name).where(field, op, value),
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
    amount_subtotal: 37500,
    amount_total: 37500,
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
      name: "CrowdPM Founding Node Reservation",
      description: "Conditional CrowdPM node preorder; ships only after FCC equipment authorization.",
      tax_code: "txcd_99999999",
      default_price_data: {
        currency: "usd",
        unit_amount: 37500,
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
          message: "Shipping is available only to US addresses and will occur only after FCC equipment authorization is complete.",
        },
        submit: {
          message: "Conditional preorder: no CrowdPM node will be shipped or delivered until FCC equipment authorization is complete. If authorization is not complete by the stated refund checkpoint, you may request a refund or continue waiting. Price includes US shipping after authorization; applicable sales tax is calculated at checkout.",
        },
      },
      metadata: {
        purchaseType: "node_hardware",
        tierId: "founding_node_reservation",
        tierLabel: "Founding node reservation",
        variantId: "standard",
        variantLabel: "Founding node reservation",
        quantity: "1",
        fccAuthorizationRequired: "true",
        noDeliveryBeforeAuthorization: "true",
        refundCheckpointDate: "2026-12-31",
      },
      success_url: "https://crowdpmplatform.web.app/node?checkout=success",
      cancel_url: "https://crowdpmplatform.web.app/node?checkout=cancelled",
    });
    expect(dbStore.get("paymentCatalog/nodeReservation")).toMatchObject({
      productId: "prod_node_123",
      defaultPriceId: "price_node_123",
      currency: "usd",
      unitAmount: 37500,
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
      unitAmount: 37500,
      quantity: 1,
      automaticTaxEnabled: true,
      amountSubtotal: 37500,
      amountTotal: 37500,
      purchaseType: "node_hardware",
      tierId: "founding_node_reservation",
      tierLabel: "Founding node reservation",
      variantId: "standard",
      variantLabel: "Founding node reservation",
      fccAuthorizationRequired: true,
      noDeliveryBeforeAuthorization: true,
      refundCheckpointDate: "2026-12-31",
    });
    await app.close();
  });

  it("attaches signed-in buyer metadata and checkout quantity to node purchases", async () => {
    mocks.checkoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_node_qty_123",
      url: "https://checkout.stripe.com/c/pay/cs_node_qty_123",
      mode: "payment",
      currency: "usd",
      amount_subtotal: 75_000,
      amount_total: 75_000,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
      payload: {
        variantId: "standard",
        quantity: 2,
      },
      headers: {
        authorization: "Bearer ok",
        "content-type": "application/json",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [
        {
          price: "price_node_123",
          quantity: 2,
        },
      ],
      customer_email: "buyer@example.com",
      client_reference_id: "user-123",
      metadata: {
        purchaseType: "node_hardware",
        userId: "user-123",
        tierId: "founding_node_reservation",
        tierLabel: "Founding node reservation",
        variantId: "standard",
        variantLabel: "Founding node reservation",
        quantity: "2",
        fccAuthorizationRequired: "true",
        noDeliveryBeforeAuthorization: "true",
        refundCheckpointDate: "2026-12-31",
      },
    }));
    expect(dbStore.get("nodePurchaseSessions/cs_node_qty_123")).toMatchObject({
      userId: "user-123",
      customerEmail: "buyer@example.com",
      tierId: "founding_node_reservation",
      tierLabel: "Founding node reservation",
      variantId: "standard",
      variantLabel: "Founding node reservation",
      unitAmount: 37_500,
      quantity: 2,
      amountSubtotal: 75_000,
      amountTotal: 75_000,
    });
    await app.close();
  });

  it("creates a support-only certification contribution without shipping collection", async () => {
    mocks.productsCreate.mockResolvedValueOnce({
      id: "prod_support_123",
      default_price: "price_support_123",
    });
    mocks.checkoutSessionsCreate.mockResolvedValueOnce({
      id: "cs_support_123",
      url: "https://checkout.stripe.com/c/pay/cs_support_123",
      mode: "payment",
      currency: "usd",
      amount_subtotal: 7_500,
      amount_total: 7_500,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
      payload: {
        tierId: "certification_support",
        quantity: 3,
      },
      headers: {
        authorization: "Bearer ok",
        "content-type": "application/json",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.productsCreate).toHaveBeenCalledWith({
      name: "CrowdPM Certification Support",
      description: "Support-only contribution toward FCC testing and launch costs. No hardware reward.",
      tax_code: "txcd_99999999",
      default_price_data: {
        currency: "usd",
        unit_amount: 2500,
        tax_behavior: "exclusive",
      },
    });
    expect(mocks.checkoutSessionsCreate).toHaveBeenCalledWith({
      line_items: [
        {
          price: "price_support_123",
          quantity: 3,
        },
      ],
      mode: "payment",
      automatic_tax: {
        enabled: true,
      },
      billing_address_collection: "required",
      custom_text: {
        submit: {
          message: "Support-only contribution toward FCC testing and launch costs. No hardware, service entitlement, equity, or charitable tax deduction is provided. Applicable tax, if any, is calculated at checkout.",
        },
      },
      customer_email: "buyer@example.com",
      client_reference_id: "user-123",
      metadata: {
        purchaseType: "certification_support",
        userId: "user-123",
        tierId: "certification_support",
        tierLabel: "Certification support",
        quantity: "3",
        hardwareReward: "false",
        charitableDonation: "false",
      },
      success_url: "https://crowdpmplatform.web.app/node?checkout=success",
      cancel_url: "https://crowdpmplatform.web.app/node?checkout=cancelled",
    });
    expect(dbStore.get("paymentCatalog/certificationSupport")).toMatchObject({
      productId: "prod_support_123",
      defaultPriceId: "price_support_123",
      currency: "usd",
      unitAmount: 2500,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
    });
    expect(dbStore.get("nodePurchaseSessions/cs_support_123")).toMatchObject({
      sessionId: "cs_support_123",
      status: "created",
      purchaseType: "certification_support",
      userId: "user-123",
      customerEmail: "buyer@example.com",
      tierId: "certification_support",
      tierLabel: "Certification support",
      unitAmount: 2_500,
      quantity: 3,
      hardwareReward: false,
      charitableDonation: false,
    });
    await app.close();
  });

  it("reuses the stored catalog without creating a second product", async () => {
    dbStore.set("paymentCatalog/nodeReservation", {
      productId: "prod_existing",
      defaultPriceId: "price_existing",
      currency: "usd",
      unitAmount: 37500,
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
    dbStore.set("paymentCatalog/nodeReservation", {
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
    expect(dbStore.get("paymentCatalog/nodeReservation")).toMatchObject({
      productId: "prod_node_123",
      defaultPriceId: "price_node_123",
      currency: "usd",
      unitAmount: 37500,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
    });
    await app.close();
  });

  it("recreates the Stripe catalog when the stored tax configuration is missing", async () => {
    dbStore.set("paymentCatalog/nodeReservation", {
      productId: "prod_old",
      defaultPriceId: "price_old",
      currency: "usd",
      unitAmount: 37500,
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.productsCreate).toHaveBeenCalledTimes(1);
    expect(dbStore.get("paymentCatalog/nodeReservation")).toMatchObject({
      productId: "prod_node_123",
      defaultPriceId: "price_node_123",
      currency: "usd",
      unitAmount: 37500,
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

  it("rejects a node checkout quantity above ten", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/v1/node-purchase/checkout-session",
      payload: {
        variantId: "standard",
        quantity: 11,
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

  it("lists completed hardware receipts for the signed-in buyer", async () => {
    dbStore.set("nodePurchaseSessions/cs_old", {
      sessionId: "cs_old",
      status: "completed",
      purchaseType: "node_hardware",
      userId: "user-123",
      paymentStatus: "paid",
      tierId: "founding_node_reservation",
      tierLabel: "Founding node reservation",
      variantId: "standard",
      variantLabel: "Founding node reservation",
      quantity: 1,
      currency: "usd",
      unitAmount: 37_500,
      amountSubtotal: 37_500,
      amountTax: 3_375,
      amountShipping: 0,
      amountDiscount: 0,
      amountTotal: 40_875,
      completedAt: "2026-01-01T00:00:00.000Z",
      customerEmail: "buyer@example.com",
      shippingDetails: {
        name: "Buyer Example",
        address: {
          city: "Seattle",
          country: "US",
          line1: "123 Pike St",
          line2: null,
          postalCode: "98101",
          state: "WA",
        },
      },
    });
    dbStore.set("nodePurchaseSessions/cs_new", {
      sessionId: "cs_new",
      status: "completed",
      purchaseType: "node_hardware",
      userId: "user-123",
      paymentStatus: "paid",
      tierId: "founding_node_reservation",
      tierLabel: "Founding node reservation",
      variantId: "standard",
      variantLabel: "Founding node reservation",
      quantity: 3,
      currency: "usd",
      unitAmount: 37_500,
      amountSubtotal: 112_500,
      amountTax: 10_125,
      amountShipping: 0,
      amountDiscount: 0,
      amountTotal: 122_625,
      completedAt: "2026-02-01T00:00:00.000Z",
      customerEmail: "buyer@example.com",
    });
    dbStore.set("nodePurchaseSessions/cs_support", {
      sessionId: "cs_support",
      status: "completed",
      purchaseType: "certification_support",
      userId: "user-123",
      paymentStatus: "paid",
      tierId: "certification_support",
      tierLabel: "Certification support",
      quantity: 2,
      currency: "usd",
      unitAmount: 2_500,
      amountSubtotal: 5_000,
      amountTax: 0,
      amountShipping: 0,
      amountDiscount: 0,
      amountTotal: 5_000,
      completedAt: "2026-03-01T00:00:00.000Z",
      customerEmail: "buyer@example.com",
    });
    dbStore.set("nodePurchaseSessions/cs_pending", {
      sessionId: "cs_pending",
      status: "created",
      purchaseType: "node_hardware",
      userId: "user-123",
    });
    dbStore.set("nodePurchaseSessions/cs_other", {
      sessionId: "cs_other",
      status: "completed",
      purchaseType: "node_hardware",
      userId: "user-456",
    });
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/v1/node-purchase/receipts",
      headers: {
        authorization: "Bearer ok",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      expect.objectContaining({
        sessionId: "cs_support",
        purchaseType: "certification_support",
        tierId: "certification_support",
        quantity: 2,
        amountTotal: 5_000,
      }),
      expect.objectContaining({
        sessionId: "cs_new",
        status: "completed",
        tierId: "founding_node_reservation",
        variantId: "standard",
        quantity: 3,
        amountTotal: 122_625,
      }),
      expect.objectContaining({
        sessionId: "cs_old",
        status: "completed",
        variantId: "standard",
        quantity: 1,
        amountTotal: 40_875,
        shippingAddress: expect.objectContaining({
          city: "Seattle",
          state: "WA",
        }),
      }),
    ]);
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
            tierId: "founding_node_reservation",
            tierLabel: "Founding node reservation",
            variantId: "standard",
            variantLabel: "Founding node reservation",
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
            amount_tax: 3375,
          },
          currency: "usd",
          amount_subtotal: 37500,
          amount_total: 40875,
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
      amountSubtotal: 37500,
      amountTotal: 40875,
      purchaseType: "node_hardware",
      tierId: "founding_node_reservation",
      tierLabel: "Founding node reservation",
      variantId: "standard",
      variantLabel: "Founding node reservation",
      quantity: 1,
      fccAuthorizationRequired: true,
      noDeliveryBeforeAuthorization: true,
      refundCheckpointDate: "2026-12-31",
      amountDiscount: 0,
      amountShipping: 0,
      amountTax: 3375,
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
