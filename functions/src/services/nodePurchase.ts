import Stripe from "stripe";
import { db } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";
import { getPublicAppBaseUrl, getStripeSecretKey, getStripeWebhookSecret } from "../lib/runtimeConfig.js";
import {
  getStripeCustomerIdForUser,
  getStripeOfferConfig,
  linkStripeCustomerToUser,
  upsertStripeSubscriptionState,
} from "./accountEntitlements.js";

const CATALOG_COLLECTION = "paymentCatalog";
const USER_SETTINGS_COLLECTION = "userSettings";
const STRIPE_API_VERSION = "2026-04-22.dahlia";
const DEFAULT_PRODUCT_TAX_CODE = "txcd_99999999";

const NODE_HARDWARE_ALLOWED_SHIPPING_COUNTRIES: Array<"US"> = ["US"];
const NODE_HARDWARE_CHECKOUT_SUBMIT_MESSAGE = "You are purchasing physical CrowdPM node hardware and any expressly listed related services from Denuo Web LLC. Purchase does not transfer proprietary rights in CrowdPM Platform software or restrict rights under applicable open-source licenses. Price includes US shipping. Applicable sales tax is calculated at checkout.";
const NODE_HARDWARE_SHIPPING_ADDRESS_MESSAGE = "We currently ship CrowdPM nodes only to addresses in the United States.";
const THEME_SAVE_UNLOCK_CHECKOUT_SUBMIT_MESSAGE = "One-time digital expansion purchase that permanently unlocks theme preference saving for the purchasing account. Applicable sales tax is calculated at checkout.";
const SUBSCRIPTION_CHECKOUT_SUBMIT_MESSAGE = "Recurring CrowdPM account subscription. Applicable taxes are calculated in Stripe Checkout. Cancel any time from the billing portal.";
const DEFAULT_NODE_HARDWARE_VARIANT_ID = "standard";
const DEFAULT_NODE_HARDWARE_QUANTITY = 1;
const MAX_NODE_HARDWARE_QUANTITY = 10;
const SUBSCRIPTION_SESSION_COLLECTION = "subscriptionCheckoutSessions";

type PaymentCatalog = {
  productId: string;
  defaultPriceId: string;
  currency: string;
  unitAmount: number;
  taxCode: string;
  taxBehavior: Stripe.Price.TaxBehavior;
  recurringInterval?: Stripe.Price.Recurring.Interval | null;
};

type PurchaseType = "node_hardware" | "theme_save_unlock" | "subscription";
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
  mode?: CheckoutSessionCreateParams["mode"];
  recurringInterval?: Stripe.Price.Recurring.Interval;
  allowPromotionCodes?: boolean;
  successSessionIdQueryParam?: string;
  shippingAddressCollection?: CheckoutSessionCreateParams["shipping_address_collection"];
};

export type NodePurchaseCheckoutSession = {
  sessionId: string;
  url: string;
};

export type ConfirmSubscriptionCheckoutSessionResult = {
  confirmed: true;
  sessionId: string;
  subscriptionSynchronized: true;
};

export type NodePurchaseVariantId = "standard" | "co2" | "no2" | "co2_no2";

export type NodePurchaseReceipt = {
  sessionId: string;
  purchaseType: "node_hardware";
  status: "completed";
  paymentStatus: string | null;
  variantId: NodePurchaseVariantId | null;
  variantLabel: string | null;
  quantity: number;
  currency: string;
  unitAmount: number | null;
  amountSubtotal: number | null;
  amountTax: number | null;
  amountShipping: number | null;
  amountDiscount: number | null;
  amountTotal: number | null;
  completedAt: string | null;
  customerEmail: string | null;
  shippingName: string | null;
  shippingAddress: Record<string, string | null> | null;
};

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
    catalogDocId: "nodeHardware",
    label: "PM2.5 standard node",
    productName: "CrowdPM Node Hardware",
    description: "Physical node hardware purchase with US shipping included.",
    unitAmount: 37_500,
  },
  no2: {
    catalogDocId: "nodeHardwareNo2",
    label: "PM2.5 + NO2 node",
    productName: "CrowdPM Node Hardware - PM2.5 + NO2",
    description: "PM2.5 node with MiCS-6814 gas-response module and ADS1115 interface hardware, with US shipping included.",
    unitAmount: 42_000,
  },
  co2: {
    catalogDocId: "nodeHardwareCo2",
    label: "PM2.5 + CO2 node",
    productName: "CrowdPM Node Hardware - PM2.5 + CO2",
    description: "PM2.5 node with SCD41 CO2 sensor hardware, with US shipping included.",
    unitAmount: 42_000,
  },
  co2_no2: {
    catalogDocId: "nodeHardwareCo2No2",
    label: "PM2.5 + CO2 + NO2 node",
    productName: "CrowdPM Node Hardware - PM2.5 + CO2 + NO2",
    description: "PM2.5 node with SCD41 CO2 sensor, MiCS-6814 gas-response module, and ADS1115 interface hardware, with US shipping included.",
    unitAmount: 48_000,
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
  successSessionIdQueryParam: "themeCheckoutSessionId",
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

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNodeVariantId(value: unknown): NodePurchaseVariantId | null {
  if (value === "standard" || value === "co2" || value === "no2" || value === "co2_no2") {
    return value;
  }
  return null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNodeQuantity(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_NODE_HARDWARE_QUANTITY) {
    return null;
  }
  return parsed;
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

function allowStripeCatalogAutoCreate(): boolean {
  return process.env.STRIPE_CATALOG_AUTO_CREATE === "true"
    || process.env.FUNCTIONS_EMULATOR === "true"
    || process.env.NODE_ENV === "test";
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
  const recurringInterval = data?.recurringInterval === "month" || data?.recurringInterval === "year"
    ? data.recurringInterval as Stripe.Price.Recurring.Interval
    : null;

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
    recurringInterval,
  };
}

function isCurrentCatalog(catalog: PaymentCatalog, config: CheckoutProductConfig): boolean {
  return catalog.currency === config.currency
    && catalog.unitAmount === config.unitAmount
    && catalog.taxCode === config.taxCode
    && catalog.taxBehavior === config.taxBehavior
    && (catalog.recurringInterval ?? null) === (config.recurringInterval ?? null);
}

function checkoutRedirectUrls(config: CheckoutProductConfig): { successUrl: string; cancelUrl: string } {
  const baseUrl = normalizeBaseUrl(getPublicAppBaseUrl());
  const successUrl = `${baseUrl}${config.successPath}?${config.successQueryParam}${config.successSessionIdQueryParam
    ? `&${config.successSessionIdQueryParam}={CHECKOUT_SESSION_ID}`
    : ""}`;
  const cancelUrl = `${baseUrl}${config.successPath}?${config.cancelQueryParam}`;
  return {
    successUrl,
    cancelUrl,
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
  if (!allowStripeCatalogAutoCreate()) {
    throw httpError(
      500,
      "stripe_catalog_not_seeded",
      `Stripe catalog for ${config.productName} is missing or stale. Seed paymentCatalog before enabling checkout.`
    );
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
        ...(config.recurringInterval
          ? { recurring: { interval: config.recurringInterval } }
          : {}),
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
    recurringInterval: config.recurringInterval ?? null,
  };

  await ref.set({
    ...catalog,
    updatedAt: new Date().toISOString(),
  }, { merge: true });

  return catalog;
}

type CreateCheckoutSessionOptions = {
  customerEmail?: string | null;
  customerId?: string | null;
  userId?: string;
  quantity?: number;
  metadata?: Record<string, string>;
  subscriptionMetadata?: Record<string, string>;
  sessionData?: Record<string, unknown>;
};

type CheckoutSessionPlan = {
  params: CheckoutSessionCreateParams;
  quantity: number;
};

export function buildCheckoutSessionPlan(args: {
  config: CheckoutProductConfig;
  catalog: PaymentCatalog;
  urls: { successUrl: string; cancelUrl: string };
  options?: CreateCheckoutSessionOptions;
}): CheckoutSessionPlan {
  const { config, catalog, urls } = args;
  const options = args.options ?? {};
  const quantity = options.quantity ?? DEFAULT_NODE_HARDWARE_QUANTITY;
  const metadata: Record<string, string> = {
    purchaseType: config.purchaseType,
    ...(options.userId ? { userId: options.userId } : {}),
    ...(options.metadata ?? {}),
  };

  const params: CheckoutSessionCreateParams = {
    line_items: [
      {
        price: catalog.defaultPriceId,
        quantity,
      },
    ],
    mode: config.mode ?? "payment",
    automatic_tax: {
      enabled: true,
    },
    billing_address_collection: config.billingAddressCollection,
    custom_text: config.customText,
    metadata,
    success_url: urls.successUrl,
    cancel_url: urls.cancelUrl,
    ...(config.allowPromotionCodes ? { allow_promotion_codes: true } : {}),
    ...(config.shippingAddressCollection ? { shipping_address_collection: config.shippingAddressCollection } : {}),
    ...(options.customerId
      ? { customer: options.customerId }
      : options.customerEmail
        ? { customer_email: options.customerEmail }
        : {}),
    ...(options.userId ? { client_reference_id: options.userId } : {}),
    ...((config.mode ?? "payment") === "subscription" && options.subscriptionMetadata
      ? { subscription_data: { metadata: options.subscriptionMetadata } }
      : {}),
  };

  return { params, quantity };
}

async function createCheckoutSession(
  config: CheckoutProductConfig,
  options: CreateCheckoutSessionOptions = {},
): Promise<NodePurchaseCheckoutSession> {
  const catalog = await ensureCatalog(config);
  const { params, quantity } = buildCheckoutSessionPlan({
    config,
    catalog,
    urls: checkoutRedirectUrls(config),
    options,
  });

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripeClient().checkout.sessions.create(params);
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
    quantity,
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

function subscriptionConfigForOffer(offerId: "pro_monthly" | "pro_yearly"): CheckoutProductConfig {
  const offer = getStripeOfferConfig(offerId);
  if (!offer) {
    throw httpError(400, "invalid_request", "Unknown subscription offer.");
  }
  return {
    catalogDocId: offer.catalogDocId,
    sessionCollection: SUBSCRIPTION_SESSION_COLLECTION,
    purchaseType: "subscription",
    productName: offer.productName,
    description: offer.productDescription,
    currency: offer.currency,
    unitAmount: offer.unitAmount,
    taxCode: DEFAULT_PRODUCT_TAX_CODE,
    taxBehavior: "exclusive",
    billingAddressCollection: "required",
    successPath: "/",
    successQueryParam: "subscriptionCheckout=success",
    successSessionIdQueryParam: "subscriptionCheckoutSessionId",
    cancelQueryParam: "subscriptionCheckout=cancelled",
    customText: {
      submit: {
        message: SUBSCRIPTION_CHECKOUT_SUBMIT_MESSAGE,
      },
    },
    mode: "subscription",
    recurringInterval: offer.billingInterval,
    allowPromotionCodes: true,
  };
}

export async function createNodePurchaseCheckoutSession(args: {
  variantId?: NodePurchaseVariantId;
  quantity?: number;
  userId?: string;
  customerEmail?: string | null;
} = {}): Promise<NodePurchaseCheckoutSession> {
  const variantId = args.variantId ?? DEFAULT_NODE_HARDWARE_VARIANT_ID;
  const quantity = args.quantity ?? DEFAULT_NODE_HARDWARE_QUANTITY;
  const variant = NODE_HARDWARE_VARIANTS[variantId];
  return createCheckoutSession(nodeHardwareConfigForVariant(variantId), {
    userId: args.userId,
    customerEmail: args.customerEmail,
    quantity,
    metadata: {
      variantId,
      variantLabel: variant.label,
      quantity: String(quantity),
    },
    sessionData: {
      variantId,
      variantLabel: variant.label,
      quantity,
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

export async function createSubscriptionCheckoutSession(args: {
  offerId: "pro_monthly" | "pro_yearly";
  userId: string;
  customerEmail?: string | null;
}): Promise<NodePurchaseCheckoutSession> {
  const offer = getStripeOfferConfig(args.offerId);
  if (!offer) {
    throw httpError(400, "invalid_request", "Unknown subscription offer.");
  }

  const existingCustomerId = await getStripeCustomerIdForUser(args.userId);
  return createCheckoutSession(subscriptionConfigForOffer(args.offerId), {
    userId: args.userId,
    customerId: existingCustomerId,
    customerEmail: args.customerEmail,
    metadata: {
      offerId: offer.offerId,
      planId: offer.planId,
      billingInterval: offer.billingInterval,
    },
    subscriptionMetadata: {
      purchaseType: "subscription",
      offerId: offer.offerId,
      planId: offer.planId,
      billingInterval: offer.billingInterval,
      userId: args.userId,
    },
    sessionData: {
      offerId: offer.offerId,
      planId: offer.planId,
      billingInterval: offer.billingInterval,
    },
  });
}

async function retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  try {
    return await getStripeClient().subscriptions.retrieve(subscriptionId);
  }
  catch (err) {
    const message = err instanceof Error && err.message.trim().length > 0
      ? err.message
      : "Unable to retrieve the Stripe subscription.";
    throw httpError(502, "stripe_error", message);
  }
}

async function recordCompletedSubscriptionCheckoutSession(
  session: Stripe.Checkout.Session,
  event?: Stripe.Event,
): Promise<void> {
  const storedSessionSnap = await db().collection(SUBSCRIPTION_SESSION_COLLECTION).doc(session.id).get();
  const storedSession = storedSessionSnap.exists ? (storedSessionSnap.data() as Record<string, unknown>) : null;
  const offerId = readSubscriptionOfferId(session.metadata?.offerId)
    ?? readSubscriptionOfferId(storedSession?.offerId);
  const offer = offerId ? getStripeOfferConfig(offerId) : null;
  const userId = resolveSubscriptionUserId(session.metadata, storedSession, session.client_reference_id);
  const customerId = extractExpandableId(session.customer as string | { id: string } | null | undefined);
  const subscriptionId = extractExpandableId(session.subscription as string | { id: string } | null | undefined);

  await db().collection(SUBSCRIPTION_SESSION_COLLECTION).doc(session.id).set({
    sessionId: session.id,
    status: "completed",
    purchaseType: "subscription",
    mode: session.mode,
    userId,
    offerId: offer?.offerId ?? null,
    planId: offer?.planId ?? null,
    billingInterval: offer?.billingInterval ?? null,
    customerId,
    customerEmail: session.customer_details?.email ?? session.customer_email ?? null,
    paymentStatus: session.payment_status ?? null,
    subscriptionId,
    amountSubtotal: session.amount_subtotal ?? null,
    amountTotal: session.amount_total ?? null,
    currency: session.currency ?? null,
    completedAt: new Date().toISOString(),
    ...(event
      ? {
          eventId: event.id,
          eventCreatedAt: new Date(event.created * 1000).toISOString(),
        }
      : {}),
  }, { merge: true });

  if (userId && customerId) {
    await linkStripeCustomerToUser(userId, customerId);
  }
}

async function syncStripeSubscription(
  subscription: Stripe.Subscription,
  options: { checkoutSessionId?: string | null; fallbackUserId?: string | null } = {},
): Promise<void> {
  const currentPeriodEnd = subscription.items.data[0]?.current_period_end ?? null;
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const offer = await findSubscriptionOfferByPriceId(priceId)
    ?? getStripeOfferConfig(readSubscriptionOfferId(subscription.metadata?.offerId));
  const userId = readNonEmptyString(subscription.metadata?.userId)
    ?? options.fallbackUserId
    ?? null;

  if (!offer || !userId) {
    return;
  }

  await upsertStripeSubscriptionState({
    userId,
    planId: offer.planId,
    billingInterval: offer.billingInterval,
    status: normalizeStripeSubscriptionStatus(subscription.status),
    stripeCustomerId: extractExpandableId(subscription.customer as string | { id: string } | null | undefined),
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    stripeCheckoutSessionId: options.checkoutSessionId ?? undefined,
    currentPeriodEnd: currentPeriodEnd
      ? new Date(currentPeriodEnd * 1000).toISOString()
      : null,
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  });
}

export async function confirmSubscriptionCheckoutSession(args: {
  sessionId: string;
  userId: string;
}): Promise<ConfirmSubscriptionCheckoutSessionResult> {
  const sessionId = readNonEmptyString(args.sessionId);
  if (!sessionId) {
    throw httpError(400, "invalid_request", "sessionId is required.");
  }

  const session = await retrieveCheckoutSession(sessionId);
  if (session.mode !== "subscription") {
    throw httpError(400, "invalid_request", "Checkout session is not a subscription purchase.");
  }
  const storedSessionSnap = await db().collection(SUBSCRIPTION_SESSION_COLLECTION).doc(session.id).get();
  const storedSession = storedSessionSnap.exists ? (storedSessionSnap.data() as Record<string, unknown>) : null;
  const sessionUserId = resolveSubscriptionUserId(session.metadata, storedSession, session.client_reference_id);
  if (!sessionUserId || sessionUserId !== args.userId) {
    throw httpError(403, "subscription_forbidden", "This subscription checkout does not belong to the signed-in account.");
  }
  const subscriptionId = extractExpandableId(session.subscription as string | { id: string } | null | undefined);
  if (!subscriptionId || (session.status !== "complete" && session.payment_status !== "paid" && session.payment_status !== "no_payment_required")) {
    throw httpError(409, "subscription_pending", "Subscription checkout is still processing. Please try again in a moment.");
  }

  await recordCompletedSubscriptionCheckoutSession(session);
  const subscription = await retrieveSubscription(subscriptionId);
  await syncStripeSubscription(subscription, {
    checkoutSessionId: session.id,
    fallbackUserId: args.userId,
  });

  return {
    confirmed: true,
    sessionId,
    subscriptionSynchronized: true,
  };
}

export async function createBillingPortalSession(args: {
  userId: string;
}): Promise<NodePurchaseCheckoutSession> {
  const customerId = await getStripeCustomerIdForUser(args.userId);
  if (!customerId) {
    throw httpError(409, "billing_portal_unavailable", "No Stripe billing account is linked to this user yet.");
  }

  const baseUrl = normalizeBaseUrl(getPublicAppBaseUrl());
  let session: Stripe.BillingPortal.Session;
  try {
    session = await getStripeClient().billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/`,
    });
  }
  catch (err) {
    const message = err instanceof Error && err.message.trim().length > 0
      ? err.message
      : "Unable to open the Stripe billing portal.";
    throw httpError(502, "stripe_error", message);
  }

  if (!session.url) {
    throw httpError(502, "stripe_error", "Stripe did not return a billing portal URL.");
  }

  return {
    sessionId: session.id,
    url: session.url,
  };
}

function readSubscriptionOfferId(value: unknown): "pro_monthly" | "pro_yearly" | null {
  return value === "pro_monthly" || value === "pro_yearly" ? value : null;
}

function resolveSubscriptionUserId(
  metadata: Record<string, string | null | undefined> | null | undefined,
  storedSession: Record<string, unknown> | null,
  clientReferenceId?: string | null,
): string | null {
  return readNonEmptyString(metadata?.userId)
    ?? readNonEmptyString(clientReferenceId)
    ?? readNonEmptyString(storedSession?.userId);
}

function normalizeStripeSubscriptionStatus(
  status: Stripe.Subscription.Status | null | undefined,
): "active" | "inactive" | "trialing" | "past_due" | "canceled" {
  if (status === "active" || status === "trialing" || status === "past_due") {
    return status;
  }
  if (status === "canceled") {
    return "canceled";
  }
  return "inactive";
}

async function findSubscriptionOfferByPriceId(priceId: string | null | undefined) {
  if (!priceId) {
    return null;
  }
  for (const offerId of ["pro_monthly", "pro_yearly"] as const) {
    const offer = getStripeOfferConfig(offerId);
    if (!offer) continue;
    const snap = await db().collection(CATALOG_COLLECTION).doc(offer.catalogDocId).get();
    const stored = readStoredCatalog(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
    if (stored?.defaultPriceId === priceId) {
      return offer;
    }
  }
  return null;
}

export type ConfirmThemeSaveCheckoutSessionResult = {
  confirmed: true;
  sessionId: string;
  unlockGranted: true;
};

type StripeWebhookArgs = {
  signature: string;
  rawBody: string;
};

type ResolvedPurchase = {
  config: CheckoutProductConfig;
  storedSession: Record<string, unknown> | null;
};

async function resolvePurchase(session: Stripe.Checkout.Session): Promise<ResolvedPurchase> {
  const metadataPurchaseType = readNonEmptyString(session.metadata?.purchaseType);
  const themeSnap = await db().collection(THEME_SAVE_UNLOCK_CONFIG.sessionCollection).doc(session.id).get();
  const themeStoredSession = themeSnap.exists ? (themeSnap.data() as Record<string, unknown>) : null;

  if (metadataPurchaseType === THEME_SAVE_UNLOCK_CONFIG.purchaseType || themeSnap.exists) {
    return {
      config: THEME_SAVE_UNLOCK_CONFIG,
      storedSession: themeStoredSession,
    };
  }

  const nodeSnap = await db().collection(NODE_HARDWARE_BASE_CONFIG.sessionCollection).doc(session.id).get();
  const storedSession = nodeSnap.exists ? (nodeSnap.data() as Record<string, unknown>) : null;
  const variantId = readNodeVariantId(session.metadata?.variantId)
    ?? readNodeVariantId(storedSession?.variantId)
    ?? DEFAULT_NODE_HARDWARE_VARIANT_ID;

  if (metadataPurchaseType === NODE_HARDWARE_BASE_CONFIG.purchaseType || nodeSnap.exists) {
    return {
      config: nodeHardwareConfigForVariant(variantId),
      storedSession,
    };
  }

  throw httpError(404, "purchase_session_not_found", "Checkout session is not recognized.");
}

function resolveThemeUnlockUserId(
  session: Stripe.Checkout.Session,
  storedSession: Record<string, unknown> | null,
): string | null {
  const metadataUserId = readNonEmptyString(session.metadata?.userId);
  if (metadataUserId) return metadataUserId;

  const clientReferenceId = readNonEmptyString(session.client_reference_id);
  if (clientReferenceId) return clientReferenceId;

  return readNonEmptyString(storedSession?.userId);
}

function resolveNodePurchaseUserId(
  session: Stripe.Checkout.Session,
  storedSession: Record<string, unknown> | null,
): string | null {
  const metadataUserId = readNonEmptyString(session.metadata?.userId);
  if (metadataUserId) return metadataUserId;

  const clientReferenceId = readNonEmptyString(session.client_reference_id);
  if (clientReferenceId) return clientReferenceId;

  return readNonEmptyString(storedSession?.userId);
}

function isThemeCheckoutSessionCompleted(session: Stripe.Checkout.Session): boolean {
  return session.mode === "payment" && session.payment_status === "paid";
}

async function recordCompletedSession(
  config: CheckoutProductConfig,
  storedSession: Record<string, unknown> | null,
  session: Stripe.Checkout.Session,
  event?: Stripe.Event,
): Promise<void> {
  const shippingDetails = session.collected_information?.shipping_details ?? null;
  const completedAt = new Date().toISOString();
  const payload: Record<string, unknown> = {
    sessionId: session.id,
    status: "completed",
    purchaseType: config.purchaseType,
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
  if (event) {
    payload.eventId = event.id;
    payload.eventCreatedAt = new Date(event.created * 1000).toISOString();
  }

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

  const variantId = readNodeVariantId(session.metadata?.variantId) ?? readNodeVariantId(storedSession?.variantId);
  const variantLabel = readNonEmptyString(session.metadata?.variantLabel) ?? readNonEmptyString(storedSession?.variantLabel);
  const quantity = readNodeQuantity(session.metadata?.quantity)
    ?? readNodeQuantity(storedSession?.quantity)
    ?? DEFAULT_NODE_HARDWARE_QUANTITY;
  const userId = resolveNodePurchaseUserId(session, storedSession);
  if (variantId) {
    payload.variantId = variantId;
  }
  if (variantLabel) {
    payload.variantLabel = variantLabel;
  }
  payload.quantity = quantity;
  if (userId) {
    payload.userId = userId;
  }

  await db().collection(config.sessionCollection).doc(session.id).set(payload, { merge: true });
}

function receiptFromSession(data: Record<string, unknown>): NodePurchaseReceipt | null {
  if (data.purchaseType !== NODE_HARDWARE_BASE_CONFIG.purchaseType || data.status !== "completed") {
    return null;
  }
  const sessionId = readNonEmptyString(data.sessionId);
  if (!sessionId) {
    return null;
  }
  const shippingDetails = typeof data.shippingDetails === "object" && data.shippingDetails !== null
    ? data.shippingDetails as Record<string, unknown>
    : null;
  const address = typeof shippingDetails?.address === "object" && shippingDetails.address !== null
    ? shippingDetails.address as Record<string, string | null>
    : null;

  return {
    sessionId,
    purchaseType: "node_hardware",
    status: "completed",
    paymentStatus: readNonEmptyString(data.paymentStatus),
    variantId: readNodeVariantId(data.variantId),
    variantLabel: readNonEmptyString(data.variantLabel),
    quantity: readNodeQuantity(data.quantity) ?? DEFAULT_NODE_HARDWARE_QUANTITY,
    currency: readNonEmptyString(data.currency) ?? "usd",
    unitAmount: readFiniteNumber(data.unitAmount),
    amountSubtotal: readFiniteNumber(data.amountSubtotal),
    amountTax: readFiniteNumber(data.amountTax),
    amountShipping: readFiniteNumber(data.amountShipping),
    amountDiscount: readFiniteNumber(data.amountDiscount),
    amountTotal: readFiniteNumber(data.amountTotal),
    completedAt: readNonEmptyString(data.completedAt),
    customerEmail: readNonEmptyString(data.customerEmail),
    shippingName: readNonEmptyString(shippingDetails?.name),
    shippingAddress: address,
  };
}

export async function listNodePurchaseReceipts(args: {
  userId: string;
  limit?: number;
}): Promise<NodePurchaseReceipt[]> {
  const limit = Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 50);
  const snap = await db()
    .collection(NODE_HARDWARE_BASE_CONFIG.sessionCollection)
    .where("userId", "==", args.userId)
    .limit(50)
    .get();
  return snap.docs
    .map((doc) => receiptFromSession(doc.data() as Record<string, unknown>))
    .filter((receipt): receipt is NodePurchaseReceipt => Boolean(receipt))
    .sort((a, b) => {
      const timeA = a.completedAt ? Date.parse(a.completedAt) : 0;
      const timeB = b.completedAt ? Date.parse(b.completedAt) : 0;
      return timeB - timeA;
    })
    .slice(0, limit);
}

async function retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
  try {
    return await getStripeClient().checkout.sessions.retrieve(sessionId);
  }
  catch (err) {
    const message = err instanceof Error && err.message.trim().length > 0
      ? err.message
      : "Unable to retrieve the Stripe Checkout session.";
    throw httpError(502, "stripe_error", message);
  }
}

export async function confirmThemeSaveCheckoutSession(args: {
  sessionId: string;
  userId: string;
}): Promise<ConfirmThemeSaveCheckoutSessionResult> {
  const sessionId = readNonEmptyString(args.sessionId);
  if (!sessionId) {
    throw httpError(400, "invalid_request", "sessionId is required.");
  }

  const session = await retrieveCheckoutSession(sessionId);
  const { config, storedSession } = await resolvePurchase(session);
  if (config.purchaseType !== THEME_SAVE_UNLOCK_CONFIG.purchaseType) {
    throw httpError(400, "invalid_request", "Checkout session is not a theme save unlock purchase.");
  }

  const sessionUserId = resolveThemeUnlockUserId(session, storedSession);
  if (!sessionUserId || sessionUserId !== args.userId) {
    throw httpError(403, "theme_save_forbidden", "This theme save checkout does not belong to the signed-in account.");
  }

  if (!isThemeCheckoutSessionCompleted(session)) {
    throw httpError(409, "theme_save_pending", "Theme purchase is still processing. Please try again in a moment.");
  }

  await recordCompletedSession(config, storedSession, session);
  return {
    confirmed: true,
    sessionId,
    unlockGranted: true,
  };
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
    if (session.mode === "subscription") {
      await recordCompletedSubscriptionCheckoutSession(session, event);
      const subscriptionId = extractExpandableId(session.subscription as string | { id: string } | null | undefined);
      if (subscriptionId) {
        const subscription = await retrieveSubscription(subscriptionId);
        await syncStripeSubscription(subscription, {
          checkoutSessionId: session.id,
          fallbackUserId: resolveSubscriptionUserId(session.metadata, null, session.client_reference_id),
        });
      }
    }
    else {
      const { config, storedSession } = await resolvePurchase(session);
      await recordCompletedSession(config, storedSession, session, event);
    }
  }

  if (
    event.type === "customer.subscription.created"
    || event.type === "customer.subscription.updated"
    || event.type === "customer.subscription.deleted"
  ) {
    await syncStripeSubscription(event.data.object as Stripe.Subscription);
  }

  return { received: true };
}
