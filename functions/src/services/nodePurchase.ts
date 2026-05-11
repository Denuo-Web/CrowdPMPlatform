import Stripe from "stripe";
import { db } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";
import { getPublicAppBaseUrl, getStripeSecretKey, getStripeWebhookSecret } from "../lib/runtimeConfig.js";

const CATALOG_COLLECTION = "paymentCatalog";
const CATALOG_DOC_ID = "nodeHardware";
const SESSION_COLLECTION = "nodePurchaseSessions";
const NODE_HARDWARE_PRODUCT_NAME = "CrowdPM Node Hardware";
const NODE_HARDWARE_CURRENCY = "usd";
const NODE_HARDWARE_UNIT_AMOUNT = 35000;
const NODE_HARDWARE_PRODUCT_TAX_CODE = "txcd_99999999";
const NODE_HARDWARE_PRICE_TAX_BEHAVIOR: Stripe.Price.TaxBehavior = "exclusive";
const NODE_HARDWARE_ALLOWED_SHIPPING_COUNTRIES: Array<"US"> = ["US"];
const NODE_HARDWARE_CHECKOUT_SUBMIT_MESSAGE = "Price includes US shipping. Applicable sales tax is calculated at checkout.";
const NODE_HARDWARE_SHIPPING_ADDRESS_MESSAGE = "We currently ship CrowdPM nodes only to addresses in the United States.";
const STRIPE_API_VERSION = "2026-04-22.dahlia";

type NodeHardwareCatalog = {
  productId: string;
  defaultPriceId: string;
  currency: string;
  unitAmount: number;
  taxCode: string;
  taxBehavior: Stripe.Price.TaxBehavior;
};

export type NodePurchaseCheckoutSession = {
  sessionId: string;
  url: string;
};

let stripeClient: Stripe | null = null;

function getStripeClient(): Stripe {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw httpError(500, "stripe_not_configured", "Stripe secret key is not configured.");
  }
  stripeClient ??= new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
  return stripeClient;
}

function extractExpandableId(value: string | { id: string } | null | undefined): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (value && typeof value === "object" && typeof value.id === "string" && value.id.trim().length > 0) {
    return value.id;
  }
  return null;
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  try {
    const parsed = new URL(rawBaseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
    const pathname = parsed.pathname.replace(/\/$/, "");
    return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
  }
  catch {
    throw httpError(500, "invalid_configuration", "PUBLIC_APP_BASE_URL must be a valid http(s) URL.");
  }
}

function readStoredCatalog(data: Record<string, unknown> | undefined): NodeHardwareCatalog | null {
  const productId = typeof data?.productId === "string" ? data.productId.trim() : "";
  const defaultPriceId = typeof data?.defaultPriceId === "string" ? data.defaultPriceId.trim() : "";
  const currency = typeof data?.currency === "string" ? data.currency.trim().toLowerCase() : "";
  const unitAmount = typeof data?.unitAmount === "number" ? data.unitAmount : Number.NaN;
  const taxCode = typeof data?.taxCode === "string" ? data.taxCode.trim() : "";
  const taxBehavior = typeof data?.taxBehavior === "string" ? data.taxBehavior.trim() as Stripe.Price.TaxBehavior : "";

  if (
    !productId
    || !defaultPriceId
    || !currency
    || !Number.isFinite(unitAmount)
    || unitAmount <= 0
    || !taxCode
    || (taxBehavior !== "exclusive" && taxBehavior !== "inclusive" && taxBehavior !== "unspecified")
  ) {
    return null;
  }

  return {
    productId,
    defaultPriceId,
    currency,
    unitAmount,
    taxCode,
    taxBehavior,
  };
}

function isCurrentCatalog(catalog: NodeHardwareCatalog): boolean {
  return catalog.currency === NODE_HARDWARE_CURRENCY
    && catalog.unitAmount === NODE_HARDWARE_UNIT_AMOUNT
    && catalog.taxCode === NODE_HARDWARE_PRODUCT_TAX_CODE
    && catalog.taxBehavior === NODE_HARDWARE_PRICE_TAX_BEHAVIOR;
}

function checkoutRedirectUrls(): { successUrl: string; cancelUrl: string } {
  const baseUrl = normalizeBaseUrl(getPublicAppBaseUrl());
  return {
    successUrl: `${baseUrl}/node?checkout=success`,
    cancelUrl: `${baseUrl}/node?checkout=cancelled`,
  };
}

function normalizeStripeAddress(address: Stripe.Address | null | undefined): Record<string, string | null> | null {
  if (!address) {
    return null;
  }
  return {
    city: address.city ?? null,
    country: address.country ?? null,
    line1: address.line1 ?? null,
    line2: address.line2 ?? null,
    postalCode: address.postal_code ?? null,
    state: address.state ?? null,
  };
}

async function ensureNodeHardwareCatalog(): Promise<NodeHardwareCatalog> {
  const ref = db().collection(CATALOG_COLLECTION).doc(CATALOG_DOC_ID);
  const snap = await ref.get();
  const stored = readStoredCatalog(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
  if (stored && isCurrentCatalog(stored)) {
    return stored;
  }

  let product: Stripe.Product;
  try {
    product = await getStripeClient().products.create({
      name: NODE_HARDWARE_PRODUCT_NAME,
      description: "Node hardware purchase with US shipping included.",
      tax_code: NODE_HARDWARE_PRODUCT_TAX_CODE,
      default_price_data: {
        currency: NODE_HARDWARE_CURRENCY,
        unit_amount: NODE_HARDWARE_UNIT_AMOUNT,
        tax_behavior: NODE_HARDWARE_PRICE_TAX_BEHAVIOR,
      },
    });
  }
  catch (err) {
    const message = err instanceof Error && err.message.trim().length > 0
      ? err.message
      : "Unable to create the Stripe node product.";
    throw httpError(502, "stripe_error", message);
  }

  const defaultPriceId = extractExpandableId(product.default_price as string | { id: string } | null | undefined);
  if (!defaultPriceId) {
    throw httpError(502, "stripe_error", "Stripe did not return a default price for the node product.");
  }

  const catalog: NodeHardwareCatalog = {
    productId: product.id,
    defaultPriceId,
    currency: NODE_HARDWARE_CURRENCY,
    unitAmount: NODE_HARDWARE_UNIT_AMOUNT,
    taxCode: NODE_HARDWARE_PRODUCT_TAX_CODE,
    taxBehavior: NODE_HARDWARE_PRICE_TAX_BEHAVIOR,
  };

  await ref.set({
    ...catalog,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  return catalog;
}

export async function createNodePurchaseCheckoutSession(): Promise<NodePurchaseCheckoutSession> {
  const catalog = await ensureNodeHardwareCatalog();
  const { successUrl, cancelUrl } = checkoutRedirectUrls();

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripeClient().checkout.sessions.create({
      line_items: [
        {
          price: catalog.defaultPriceId,
          quantity: 1,
        },
      ],
      mode: "payment",
      automatic_tax: {
        enabled: true,
      },
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: NODE_HARDWARE_ALLOWED_SHIPPING_COUNTRIES,
      },
      custom_text: {
        shipping_address: {
          message: NODE_HARDWARE_SHIPPING_ADDRESS_MESSAGE,
        },
        submit: {
          message: NODE_HARDWARE_CHECKOUT_SUBMIT_MESSAGE,
        },
      },
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  }
  catch (err) {
    const message = err instanceof Error && err.message.trim().length > 0
      ? err.message
      : "Unable to create a Stripe Checkout session.";
    throw httpError(502, "stripe_error", message);
  }

  if (!session.url) {
    throw httpError(502, "stripe_error", "Stripe did not return a checkout URL.");
  }

  await db().collection(SESSION_COLLECTION).doc(session.id).set({
    sessionId: session.id,
    status: "created",
    productId: catalog.productId,
    priceId: catalog.defaultPriceId,
    mode: session.mode,
    checkoutUrl: session.url,
    currency: session.currency ?? catalog.currency,
    unitAmount: catalog.unitAmount,
    automaticTaxEnabled: true,
    amountSubtotal: session.amount_subtotal ?? null,
    amountTotal: session.amount_total ?? null,
    createdAt: new Date().toISOString(),
  }, { merge: true });

  return {
    sessionId: session.id,
    url: session.url,
  };
}

type StripeWebhookArgs = {
  signature: string;
  rawBody: string;
};

export async function handleStripeWebhook({ signature, rawBody }: StripeWebhookArgs): Promise<{ received: true }> {
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    throw httpError(500, "stripe_not_configured", "Stripe webhook secret is not configured.");
  }

  let event: Stripe.Event;
  try {
    event = getStripeClient().webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
  catch {
    throw httpError(400, "invalid_signature", "Stripe webhook signature verification failed.");
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const shippingDetails = session.collected_information?.shipping_details ?? null;
    await db().collection(SESSION_COLLECTION).doc(session.id).set({
      sessionId: session.id,
      status: "completed",
      eventId: event.id,
      eventCreatedAt: new Date(event.created * 1000).toISOString(),
      completedAt: new Date().toISOString(),
      mode: session.mode,
      paymentStatus: session.payment_status ?? null,
      checkoutUrl: typeof session.url === "string" ? session.url : null,
      currency: session.currency ?? null,
      amountSubtotal: session.amount_subtotal ?? null,
      amountTotal: session.amount_total ?? null,
      amountDiscount: session.total_details?.amount_discount ?? null,
      amountShipping: session.total_details?.amount_shipping ?? null,
      amountTax: session.total_details?.amount_tax ?? null,
      automaticTaxEnabled: session.automatic_tax?.enabled ?? null,
      automaticTaxStatus: session.automatic_tax?.status ?? null,
      customerId: extractExpandableId(session.customer as string | { id: string } | null | undefined),
      customerEmail: session.customer_details?.email ?? session.customer_email ?? null,
      paymentIntentId: extractExpandableId(session.payment_intent as string | { id: string } | null | undefined),
      shippingDetails: shippingDetails
        ? {
          name: shippingDetails.name ?? null,
          address: normalizeStripeAddress(shippingDetails.address),
        }
        : null,
    }, { merge: true });
  }

  return { received: true };
}
