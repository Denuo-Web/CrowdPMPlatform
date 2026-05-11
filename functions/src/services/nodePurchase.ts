import Stripe from "stripe";
import { db } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";
import { getPublicAppBaseUrl, getStripeSecretKey, getStripeWebhookSecret } from "../lib/runtimeConfig.js";

const CATALOG_COLLECTION = "paymentCatalog";
const USER_SETTINGS_COLLECTION = "userSettings";
const STRIPE_API_VERSION = "2026-04-22.dahlia";
const DEFAULT_PRODUCT_TAX_CODE = "txcd_99999999";

const NODE_HARDWARE_ALLOWED_SHIPPING_COUNTRIES: Array<"US"> = ["US"];
const NODE_HARDWARE_CHECKOUT_SUBMIT_MESSAGE = "Price includes US shipping. Applicable sales tax is calculated at checkout.";
const NODE_HARDWARE_SHIPPING_ADDRESS_MESSAGE = "We currently ship CrowdPM nodes only to addresses in the United States.";
const THEME_SAVE_UNLOCK_CHECKOUT_SUBMIT_MESSAGE = "One-time digital expansion purchase that permanently unlocks theme preference saving for the purchasing account. Applicable sales tax is calculated at checkout.";
const DEFAULT_NODE_HARDWARE_VARIANT_ID = "standard";

type PaymentCatalog = {
  productId: string;
  defaultPriceId: string;
  currency: string;
  unitAmount: number;
  taxCode: string;
  taxBehavior: Stripe.Price.TaxBehavior;
};

type PurchaseType = "node_hardware" | "theme_save_unlock";
type CheckoutSessionCreateParams = NonNullable<Parameters<Stripe["checkout"]["sessions"]["create"]>[0]>;

type CheckoutProductConfig = {
  catalogDocId: string;
  sessionCollection: string;
  purchaseType: PurchaseType;
  productName: string;
  description: string;
  currency: string;
  unitAmount: number;
  taxCode: string;
  taxBehavior: Stripe.Price.TaxBehavior;
  billingAddressCollection: CheckoutSessionCreateParams["billing_address_collection"];
  successPath: string;
  successQueryParam: string;
  cancelQueryParam: string;
  customText: CheckoutSessionCreateParams["custom_text"];
  shippingAddressCollection?: CheckoutSessionCreateParams["shipping_address_collection"];
};

export type NodePurchaseCheckoutSession = {
  sessionId: string;
  url: string;
};

export type NodePurchaseVariantId = "standard" | "co2" | "no2" | "co2_no2";

type NodeHardwareVariantConfig = Pick<CheckoutProductConfig, "catalogDocId" | "productName" | "description" | "unitAmount"> & {
  label: string;
};

const NODE_HARDWARE_BASE_CONFIG: Omit<CheckoutProductConfig, "catalogDocId" | "productName" | "description" | "unitAmount"> = {
  sessionCollection: "nodePurchaseSessions",
  purchaseType: "node_hardware",
  currency: "usd",
  taxCode: DEFAULT_PRODUCT_TAX_CODE,
  taxBehavior: "exclusive",
  billingAddressCollection: "required",
  successPath: "/node",
  successQueryParam: "checkout=success",
  cancelQueryParam: "checkout=cancelled",
  customText: {
    shipping_address: {
      message: NODE_HARDWARE_SHIPPING_ADDRESS_MESSAGE,
    },
    submit: {
      message: NODE_HARDWARE_CHECKOUT_SUBMIT_MESSAGE,
    },
  },
  shippingAddressCollection: {
    allowed_countries: NODE_HARDWARE_ALLOWED_SHIPPING_COUNTRIES,
  },
};

const NODE_HARDWARE_VARIANTS: Record<NodePurchaseVariantId, NodeHardwareVariantConfig> = {
  standard: {
    catalogDocId: "nodeHardwareStandard",
    label: "PM2.5 standard node",
    productName: "CrowdPM Node Hardware - PM2.5 Standard",
    description: "PM2.5 node hardware purchase with US shipping included.",
    unitAmount: 35_000,
  },
  no2: {
    catalogDocId: "nodeHardwareNo2",
    label: "PM2.5 + NO2 node",
    productName: "CrowdPM Node Hardware - PM2.5 + NO2",
    description: "PM2.5 node with MiCS-6814 NO2 sensor and ADS1115 interface hardware, with US shipping included.",
    unitAmount: 38_884,
  },
  co2: {
    catalogDocId: "nodeHardwareCo2",
    label: "PM2.5 + CO2 node",
    productName: "CrowdPM Node Hardware - PM2.5 + CO2",
    description: "PM2.5 node with SCD41 CO2 sensor hardware, with US shipping included.",
    unitAmount: 37_799,
  },
  co2_no2: {
    catalogDocId: "nodeHardwareCo2No2",
    label: "PM2.5 + CO2 + NO2 node",
    productName: "CrowdPM Node Hardware - PM2.5 + CO2 + NO2",
    description: "PM2.5 node with SCD41 CO2 sensor, MiCS-6814 NO2 sensor, and ADS1115 interface hardware, with US shipping included.",
    unitAmount: 41_683,
  },
};

function nodeHardwareConfigForVariant(variantId: NodePurchaseVariantId): CheckoutProductConfig {
  return {
    ...NODE_HARDWARE_BASE_CONFIG,
    ...NODE_HARDWARE_VARIANTS[variantId],
  };
}

const THEME_SAVE_UNLOCK_CONFIG: CheckoutProductConfig = {
  catalogDocId: "themeSaveUnlock",
  sessionCollection: "themeSavePurchaseSessions",
  purchaseType: "theme_save_unlock",
  productName: "CrowdPM Theme Save Unlock",
  description: "One-time digital expansion that permanently unlocks theme preference saving for a CrowdPM account.",
  currency: "usd",
  unitAmount: 300,
  taxCode: DEFAULT_PRODUCT_TAX_CODE,
  taxBehavior: "exclusive",
  billingAddressCollection: "required",
  successPath: "/",
  successQueryParam: "themeCheckout=success",
  cancelQueryParam: "themeCheckout=cancelled",
  customText: {
    submit: {
      message: THEME_SAVE_UNLOCK_CHECKOUT_SUBMIT_MESSAGE,
    },
  },
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

function readStoredCatalog(data: Record<string, unknown> | undefined): PaymentCatalog | null {
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

function isCurrentCatalog(catalog: PaymentCatalog, config: CheckoutProductConfig): boolean {
  return catalog.currency === config.currency
    && catalog.unitAmount === config.unitAmount
    && catalog.taxCode === config.taxCode
    && catalog.taxBehavior === config.taxBehavior;
}

function checkoutRedirectUrls(config: CheckoutProductConfig): { successUrl: string; cancelUrl: string } {
  const baseUrl = normalizeBaseUrl(getPublicAppBaseUrl());
  return {
    successUrl: `${baseUrl}${config.successPath}?${config.successQueryParam}`,
    cancelUrl: `${baseUrl}${config.successPath}?${config.cancelQueryParam}`,
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

async function ensureCatalog(config: CheckoutProductConfig): Promise<PaymentCatalog> {
  const ref = db().collection(CATALOG_COLLECTION).doc(config.catalogDocId);
  const snap = await ref.get();
  const stored = readStoredCatalog(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
  if (stored && isCurrentCatalog(stored, config)) {
    return stored;
  }

  let product: Stripe.Product;
  try {
    product = await getStripeClient().products.create({
      name: config.productName,
      description: config.description,
      tax_code: config.taxCode,
      default_price_data: {
        currency: config.currency,
        unit_amount: config.unitAmount,
        tax_behavior: config.taxBehavior,
      },
    });
  }
  catch (err) {
    const message = err instanceof Error && err.message.trim().length > 0
      ? err.message
      : `Unable to create the Stripe product for ${config.productName}.`;
    throw httpError(502, "stripe_error", message);
  }

  const defaultPriceId = extractExpandableId(product.default_price as string | { id: string } | null | undefined);
  if (!defaultPriceId) {
    throw httpError(502, "stripe_error", `Stripe did not return a default price for ${config.productName}.`);
  }

  const catalog: PaymentCatalog = {
    productId: product.id,
    defaultPriceId,
    currency: config.currency,
    unitAmount: config.unitAmount,
    taxCode: config.taxCode,
    taxBehavior: config.taxBehavior,
  };

  await ref.set({
    ...catalog,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  return catalog;
}

type CreateCheckoutSessionOptions = {
  customerEmail?: string | null;
  userId?: string;
  metadata?: Record<string, string>;
  sessionData?: Record<string, unknown>;
};

async function createCheckoutSession(
  config: CheckoutProductConfig,
  options: CreateCheckoutSessionOptions = {},
): Promise<NodePurchaseCheckoutSession> {
  const catalog = await ensureCatalog(config);
  const { successUrl, cancelUrl } = checkoutRedirectUrls(config);
  const metadata: Record<string, string> = {
    purchaseType: config.purchaseType,
  };
  if (options.userId) {
    metadata.userId = options.userId;
  }
  if (options.metadata) {
    Object.assign(metadata, options.metadata);
  }

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
      billing_address_collection: config.billingAddressCollection,
      shipping_address_collection: config.shippingAddressCollection,
      custom_text: config.customText,
      customer_email: options.customerEmail ?? undefined,
      client_reference_id: options.userId,
      metadata,
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

  await db().collection(config.sessionCollection).doc(session.id).set({
    sessionId: session.id,
    status: "created",
    purchaseType: config.purchaseType,
    productId: catalog.productId,
    priceId: catalog.defaultPriceId,
    mode: session.mode,
    checkoutUrl: session.url,
    currency: session.currency ?? catalog.currency,
    unitAmount: catalog.unitAmount,
    automaticTaxEnabled: true,
    amountSubtotal: session.amount_subtotal ?? null,
    amountTotal: session.amount_total ?? null,
    userId: options.userId ?? null,
    customerEmail: options.customerEmail ?? null,
    ...(options.sessionData ?? {}),
    createdAt: new Date().toISOString(),
  }, { merge: true });

  return {
    sessionId: session.id,
    url: session.url,
  };
}

async function ensureThemeSaveLocked(userId: string): Promise<void> {
  const snap = await db().collection(USER_SETTINGS_COLLECTION).doc(userId).get();
  if (snap.exists && snap.get("themeSaveUnlocked") === true) {
    throw httpError(409, "theme_save_unlocked", "Theme saving is already unlocked for this account.");
  }
}

export async function createNodePurchaseCheckoutSession(args: {
  variantId?: NodePurchaseVariantId;
} = {}): Promise<NodePurchaseCheckoutSession> {
  const variantId = args.variantId ?? DEFAULT_NODE_HARDWARE_VARIANT_ID;
  const variant = NODE_HARDWARE_VARIANTS[variantId];
  return createCheckoutSession(nodeHardwareConfigForVariant(variantId), {
    metadata: {
      variantId,
      variantLabel: variant.label,
    },
    sessionData: {
      variantId,
      variantLabel: variant.label,
    },
  });
}

export async function createThemeSaveCheckoutSession(args: {
  userId: string;
  customerEmail?: string | null;
}): Promise<NodePurchaseCheckoutSession> {
  await ensureThemeSaveLocked(args.userId);
  return createCheckoutSession(THEME_SAVE_UNLOCK_CONFIG, args);
}

type StripeWebhookArgs = {
  signature: string;
  rawBody: string;
};

type ResolvedPurchase = {
  config: CheckoutProductConfig;
  storedSession: Record<string, unknown> | null;
};

async function resolvePurchase(session: Stripe.Checkout.Session): Promise<ResolvedPurchase> {
  const metadataPurchaseType = typeof session.metadata?.purchaseType === "string"
    ? session.metadata.purchaseType.trim()
    : "";

  if (metadataPurchaseType === THEME_SAVE_UNLOCK_CONFIG.purchaseType) {
    const snap = await db().collection(THEME_SAVE_UNLOCK_CONFIG.sessionCollection).doc(session.id).get();
    return {
      config: THEME_SAVE_UNLOCK_CONFIG,
      storedSession: snap.exists ? (snap.data() as Record<string, unknown>) : null,
    };
  }

  if (metadataPurchaseType === NODE_HARDWARE_BASE_CONFIG.purchaseType) {
    const snap = await db().collection(NODE_HARDWARE_BASE_CONFIG.sessionCollection).doc(session.id).get();
    return {
      config: nodeHardwareConfigForVariant(DEFAULT_NODE_HARDWARE_VARIANT_ID),
      storedSession: snap.exists ? (snap.data() as Record<string, unknown>) : null,
    };
  }

  const themeSnap = await db().collection(THEME_SAVE_UNLOCK_CONFIG.sessionCollection).doc(session.id).get();
  if (themeSnap.exists) {
    return {
      config: THEME_SAVE_UNLOCK_CONFIG,
      storedSession: themeSnap.data() as Record<string, unknown>,
    };
  }

  const nodeSnap = await db().collection(NODE_HARDWARE_BASE_CONFIG.sessionCollection).doc(session.id).get();
  return {
    config: nodeHardwareConfigForVariant(DEFAULT_NODE_HARDWARE_VARIANT_ID),
    storedSession: nodeSnap.exists ? (nodeSnap.data() as Record<string, unknown>) : null,
  };
}

function resolveThemeUnlockUserId(
  session: Stripe.Checkout.Session,
  storedSession: Record<string, unknown> | null,
): string | null {
  const metadataUserId = typeof session.metadata?.userId === "string" && session.metadata.userId.trim().length > 0
    ? session.metadata.userId.trim()
    : null;
  if (metadataUserId) return metadataUserId;

  const clientReferenceId = typeof session.client_reference_id === "string" && session.client_reference_id.trim().length > 0
    ? session.client_reference_id.trim()
    : null;
  if (clientReferenceId) return clientReferenceId;

  const storedUserId = typeof storedSession?.userId === "string" && storedSession.userId.trim().length > 0
    ? storedSession.userId.trim()
    : null;
  return storedUserId;
}

async function recordCompletedSession(
  config: CheckoutProductConfig,
  storedSession: Record<string, unknown> | null,
  session: Stripe.Checkout.Session,
  event: Stripe.Event,
): Promise<void> {
  const shippingDetails = session.collected_information?.shipping_details ?? null;
  const completedAt = new Date().toISOString();
  const payload: Record<string, unknown> = {
    sessionId: session.id,
    status: "completed",
    purchaseType: config.purchaseType,
    eventId: event.id,
    eventCreatedAt: new Date(event.created * 1000).toISOString(),
    completedAt,
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
  };

  if (config.purchaseType === THEME_SAVE_UNLOCK_CONFIG.purchaseType) {
    const userId = resolveThemeUnlockUserId(session, storedSession);
    payload.userId = userId;
    payload.unlockGranted = Boolean(userId);
    await db().collection(config.sessionCollection).doc(session.id).set(payload, { merge: true });
    if (userId) {
      await db().collection(USER_SETTINGS_COLLECTION).doc(userId).set({
        themeSaveUnlocked: true,
        themeSaveUnlockedAt: completedAt,
        themeSaveUnlockedBySessionId: session.id,
      }, { merge: true });
    }
    return;
  }

  await db().collection(config.sessionCollection).doc(session.id).set(payload, { merge: true });
}

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
    const { config, storedSession } = await resolvePurchase(session);
    await recordCompletedSession(config, storedSession, session, event);
  }

  return { received: true };
}
