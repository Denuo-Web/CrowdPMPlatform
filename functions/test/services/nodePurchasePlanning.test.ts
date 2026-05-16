import { describe, expect, it } from "vitest";
import { buildCheckoutSessionPlan } from "../../src/services/nodePurchase.js";

describe("buildCheckoutSessionPlan", () => {
  it("builds Stripe Checkout params from config, catalog, URLs, and caller options", () => {
    const config = {
      catalogDocId: "subscriptionProMonthly",
      sessionCollection: "subscriptionCheckoutSessions",
      purchaseType: "subscription",
      productName: "CrowdPM Pro Monthly",
      description: "Monthly CrowdPM Pro access.",
      currency: "usd",
      unitAmount: 1200,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
      billingAddressCollection: "required",
      successPath: "/",
      successQueryParam: "subscriptionCheckout=success",
      successSessionIdQueryParam: "subscriptionCheckoutSessionId",
      cancelQueryParam: "subscriptionCheckout=cancelled",
      customText: {
        submit: {
          message: "Subscription checkout",
        },
      },
      mode: "subscription",
      recurringInterval: "month",
      allowPromotionCodes: true,
    } satisfies Parameters<typeof buildCheckoutSessionPlan>[0]["config"];
    const catalog = {
      productId: "prod_123",
      defaultPriceId: "price_123",
      currency: "usd",
      unitAmount: 1200,
      taxCode: "txcd_99999999",
      taxBehavior: "exclusive",
      recurringInterval: "month",
    } satisfies Parameters<typeof buildCheckoutSessionPlan>[0]["catalog"];

    const plan = buildCheckoutSessionPlan({
      config,
      catalog,
      urls: {
        successUrl: "https://app.example.test/?subscriptionCheckout=success",
        cancelUrl: "https://app.example.test/?subscriptionCheckout=cancelled",
      },
      options: {
        userId: "user-123",
        customerId: "cus_123",
        quantity: 2,
        metadata: {
          offerId: "pro_monthly",
        },
        subscriptionMetadata: {
          userId: "user-123",
          offerId: "pro_monthly",
        },
      },
    });

    expect(plan.quantity).toBe(2);
    expect(plan.params).toEqual({
      line_items: [
        {
          price: "price_123",
          quantity: 2,
        },
      ],
      mode: "subscription",
      automatic_tax: {
        enabled: true,
      },
      billing_address_collection: "required",
      custom_text: {
        submit: {
          message: "Subscription checkout",
        },
      },
      metadata: {
        purchaseType: "subscription",
        userId: "user-123",
        offerId: "pro_monthly",
      },
      success_url: "https://app.example.test/?subscriptionCheckout=success",
      cancel_url: "https://app.example.test/?subscriptionCheckout=cancelled",
      allow_promotion_codes: true,
      customer: "cus_123",
      client_reference_id: "user-123",
      subscription_data: {
        metadata: {
          userId: "user-123",
          offerId: "pro_monthly",
        },
      },
    });
  });
});
