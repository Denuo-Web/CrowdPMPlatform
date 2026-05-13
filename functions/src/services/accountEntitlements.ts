import type { DocumentReference, Firestore } from "firebase-admin/firestore";
import type {
  BatchVisibility,
  SubscriptionBillingInterval,
  SubscriptionLimits,
  SubscriptionOffer,
  SubscriptionOfferId,
  SubscriptionPlanId,
  SubscriptionSource,
  SubscriptionStatus,
  SubscriptionSummary,
  VideoDownloadAccess,
} from "@crowdpm/types";
import { db as getDb } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";

const ACCOUNT_ENTITLEMENTS_COLLECTION = "accountEntitlements";
const COMPANY_CONTACT_EMAIL = "info@denuoweb.com";
const ENTITLEMENT_SCHEMA_VERSION = 1;

type PlanDefinition = {
  label: string;
  source: SubscriptionSource;
  videoDownloadAccess: VideoDownloadAccess;
  limits: SubscriptionLimits;
};

type StripeOfferConfig = SubscriptionOffer & {
  action: "checkout";
  billingInterval: SubscriptionBillingInterval;
  currency: string;
  unitAmount: number;
  productName: string;
  productDescription: string;
  catalogDocId: string;
};

type StoredEntitlementData = {
  planId: SubscriptionPlanId | null;
  source: SubscriptionSource | null;
  status: SubscriptionStatus | null;
  billingInterval: SubscriptionBillingInterval | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeCheckoutSessionId: string | null;
  stripeCurrentPeriodEnd: string | null;
  stripeCancelAtPeriodEnd: boolean;
  activeDeviceCount: number;
  storedBatchCount: number;
  storedPrivateBatchCount: number;
  currentUsageMonth: string | null;
  currentMonthPointsUploaded: number;
  limitOverrides: Partial<SubscriptionLimits>;
  createdAt: string | null;
};

type StripeSubscriptionState = {
  userId: string;
  planId: SubscriptionPlanId;
  billingInterval: SubscriptionBillingInterval | null;
  status: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  stripeCheckoutSessionId?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
};

type StoredCounterOverride = Partial<Pick<
  StoredEntitlementData,
  | "activeDeviceCount"
  | "storedBatchCount"
  | "storedPrivateBatchCount"
  | "currentUsageMonth"
  | "currentMonthPointsUploaded"
>> & {
  updatedAt: string;
};

export type UploadQuotaReservation = {
  monthKey: string;
  pointCount: number;
  visibility: BatchVisibility;
  subscription: SubscriptionSummary;
};

type QuotaDimension =
  | "active_devices"
  | "stored_batches_total"
  | "stored_private_batches"
  | "monthly_points"
  | "points_per_batch";

const PLAN_DEFINITIONS: Record<SubscriptionPlanId, PlanDefinition> = {
  free_community: {
    label: "Free / Community",
    source: "free",
    videoDownloadAccess: "preview_watermarked",
    limits: {
      maxActiveDevices: 2,
      maxStoredBatchesTotal: 100,
      maxStoredPrivateBatches: 0,
      monthlyPoints: 100_000,
      maxPointsPerBatch: 5_000,
    },
  },
  pro: {
    label: "Pro",
    source: "stripe",
    videoDownloadAccess: "full",
    limits: {
      maxActiveDevices: 10,
      maxStoredBatchesTotal: 2_000,
      maxStoredPrivateBatches: 1_000,
      monthlyPoints: 1_000_000,
      maxPointsPerBatch: 10_000,
    },
  },
  research_lab: {
    label: "Research / Lab",
    source: "manual",
    videoDownloadAccess: "full",
    limits: {
      maxActiveDevices: 25,
      maxStoredBatchesTotal: 10_000,
      maxStoredPrivateBatches: 5_000,
      monthlyPoints: 5_000_000,
      maxPointsPerBatch: 25_000,
    },
  },
};

const STRIPE_OFFERS: Record<Exclude<SubscriptionOfferId, "research_contact">, StripeOfferConfig> = {
  pro_monthly: {
    offerId: "pro_monthly",
    planId: "pro",
    label: "Pro monthly",
    description: "10 devices, 2,000 stored batches, up to 1,000 private batches, and full video downloads.",
    currency: "usd",
    unitAmount: 900,
    billingInterval: "month",
    action: "checkout",
    contactEmail: null,
    productName: "CrowdPM Pro Monthly",
    productDescription: "Recurring CrowdPM Pro subscription billed monthly for expanded device, batch, upload, and export limits.",
    catalogDocId: "subscriptionProMonthly",
  },
  pro_yearly: {
    offerId: "pro_yearly",
    planId: "pro",
    label: "Pro yearly",
    description: "Annual CrowdPM Pro billing with the same limits and a lower effective monthly rate.",
    currency: "usd",
    unitAmount: 9_900,
    billingInterval: "year",
    action: "checkout",
    contactEmail: null,
    productName: "CrowdPM Pro Yearly",
    productDescription: "Recurring CrowdPM Pro subscription billed yearly for expanded device, batch, upload, and export limits.",
    catalogDocId: "subscriptionProYearly",
  },
};

const RESEARCH_CONTACT_OFFER: SubscriptionOffer = {
  offerId: "research_contact",
  planId: "research_lab",
  label: "Research / Lab",
  description: "Manual provisioning for research groups, labs, and higher-volume deployments.",
  currency: null,
  unitAmount: null,
  billingInterval: null,
  action: "contact",
  contactEmail: COMPANY_CONTACT_EMAIL,
};

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.floor(value));
}

function normalizePlanId(value: unknown): SubscriptionPlanId | null {
  return value === "free_community" || value === "pro" || value === "research_lab"
    ? value
    : null;
}

function normalizeSource(value: unknown): SubscriptionSource | null {
  return value === "free" || value === "stripe" || value === "manual"
    ? value
    : null;
}

function normalizeStatus(value: unknown): SubscriptionStatus | null {
  return value === "active"
    || value === "inactive"
    || value === "trialing"
    || value === "past_due"
    || value === "canceled"
    ? value
    : null;
}

function normalizeBillingInterval(value: unknown): SubscriptionBillingInterval | null {
  return value === "month" || value === "year" ? value : null;
}

function normalizeLimitOverrides(value: unknown): Partial<SubscriptionLimits> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const input = value as Record<string, unknown>;
  const out: Partial<SubscriptionLimits> = {};
  if ("maxActiveDevices" in input) out.maxActiveDevices = readNonNegativeInt(input.maxActiveDevices);
  if ("maxStoredBatchesTotal" in input) out.maxStoredBatchesTotal = readNonNegativeInt(input.maxStoredBatchesTotal);
  if ("maxStoredPrivateBatches" in input) out.maxStoredPrivateBatches = readNonNegativeInt(input.maxStoredPrivateBatches);
  if ("monthlyPoints" in input) out.monthlyPoints = readNonNegativeInt(input.monthlyPoints);
  if ("maxPointsPerBatch" in input) out.maxPointsPerBatch = readNonNegativeInt(input.maxPointsPerBatch);
  return out;
}

function monthKeyFor(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function monthResetAt(monthKey: string): string {
  const [yearPart, monthPart] = monthKey.split("-");
  const year = Number.parseInt(yearPart, 10);
  const month = Number.parseInt(monthPart, 10);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return new Date(Date.UTC(1970, 1, 1, 0, 0, 0, 0)).toISOString();
  }
  return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString();
}

function mergeLimits(base: SubscriptionLimits, overrides: Partial<SubscriptionLimits>): SubscriptionLimits {
  return {
    maxActiveDevices: overrides.maxActiveDevices ?? base.maxActiveDevices,
    maxStoredBatchesTotal: overrides.maxStoredBatchesTotal ?? base.maxStoredBatchesTotal,
    maxStoredPrivateBatches: overrides.maxStoredPrivateBatches ?? base.maxStoredPrivateBatches,
    monthlyPoints: overrides.monthlyPoints ?? base.monthlyPoints,
    maxPointsPerBatch: overrides.maxPointsPerBatch ?? base.maxPointsPerBatch,
  };
}

function readStoredEntitlementData(raw: Record<string, unknown> | undefined): StoredEntitlementData {
  return {
    planId: normalizePlanId(raw?.planId),
    source: normalizeSource(raw?.source),
    status: normalizeStatus(raw?.status),
    billingInterval: normalizeBillingInterval(raw?.billingInterval),
    stripeCustomerId: readNonEmptyString(raw?.stripeCustomerId),
    stripeSubscriptionId: readNonEmptyString(raw?.stripeSubscriptionId),
    stripePriceId: readNonEmptyString(raw?.stripePriceId),
    stripeCheckoutSessionId: readNonEmptyString(raw?.stripeCheckoutSessionId),
    stripeCurrentPeriodEnd: readNonEmptyString(raw?.stripeCurrentPeriodEnd),
    stripeCancelAtPeriodEnd: readBoolean(raw?.stripeCancelAtPeriodEnd, false),
    activeDeviceCount: readNonNegativeInt(raw?.activeDeviceCount),
    storedBatchCount: readNonNegativeInt(raw?.storedBatchCount),
    storedPrivateBatchCount: readNonNegativeInt(raw?.storedPrivateBatchCount),
    currentUsageMonth: readNonEmptyString(raw?.currentUsageMonth),
    currentMonthPointsUploaded: readNonNegativeInt(raw?.currentMonthPointsUploaded),
    limitOverrides: normalizeLimitOverrides(raw?.limitOverrides),
    createdAt: readNonEmptyString(raw?.createdAt),
  };
}

function statusKeepsPaidEntitlements(status: SubscriptionStatus | null): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

function effectivePlanIdFor(data: StoredEntitlementData): SubscriptionPlanId {
  if (data.planId === "research_lab" && data.source === "manual" && data.status === "active") {
    return "research_lab";
  }
  if (data.planId && data.planId !== "free_community" && data.source === "stripe" && statusKeepsPaidEntitlements(data.status)) {
    return data.planId;
  }
  return "free_community";
}

function effectiveSourceFor(data: StoredEntitlementData, planId: SubscriptionPlanId): SubscriptionSource {
  if (planId === "free_community") {
    return "free";
  }
  return data.source ?? PLAN_DEFINITIONS[planId].source;
}

function effectiveStatusFor(data: StoredEntitlementData, planId: SubscriptionPlanId): SubscriptionStatus {
  if (planId === "free_community") {
    return "active";
  }
  return data.status ?? "inactive";
}

function applyCounterOverride(
  current: StoredEntitlementData,
  override: StoredCounterOverride,
): StoredEntitlementData {
  return {
    ...current,
    activeDeviceCount: override.activeDeviceCount ?? current.activeDeviceCount,
    storedBatchCount: override.storedBatchCount ?? current.storedBatchCount,
    storedPrivateBatchCount: override.storedPrivateBatchCount ?? current.storedPrivateBatchCount,
    currentUsageMonth: override.currentUsageMonth ?? current.currentUsageMonth,
    currentMonthPointsUploaded: override.currentMonthPointsUploaded ?? current.currentMonthPointsUploaded,
  };
}

function quotaMeta(
  summary: SubscriptionSummary,
  dimension: QuotaDimension,
  limit: number,
  current: number,
  requested: number,
): Record<string, unknown> {
  return {
    planId: summary.planId,
    billingInterval: summary.billingInterval,
    resetAt: summary.usage.resetAt,
    limits: summary.limits,
    usage: summary.usage,
    quota: {
      dimension,
      limit,
      current,
      requested,
    },
  };
}

function secondsUntil(targetIso: string, now: Date): number {
  const targetMs = Date.parse(targetIso);
  if (Number.isNaN(targetMs)) {
    return 60;
  }
  return Math.max(1, Math.ceil((targetMs - now.getTime()) / 1000));
}

function quotaExceeded(
  summary: SubscriptionSummary,
  dimension: QuotaDimension,
  limit: number,
  current: number,
  requested: number,
  message: string,
) {
  return httpError(403, "quota_exceeded", message, quotaMeta(summary, dimension, limit, current, requested));
}

function monthlyQuotaExceeded(
  summary: SubscriptionSummary,
  pointCount: number,
  now: Date,
) {
  const error = httpError(
    429,
    "quota_reset_pending",
    "Monthly upload budget reached for the current plan. Wait for the next reset or upgrade the account.",
    quotaMeta(
      summary,
      "monthly_points",
      summary.limits.monthlyPoints,
      summary.usage.monthlyPointsUsed,
      pointCount,
    ),
  ) as Error & { headers?: Record<string, string> };
  error.headers = { "retry-after": String(secondsUntil(summary.usage.resetAt, now)) };
  return error;
}

function docRef(targetDb: Firestore, userId: string): DocumentReference {
  return targetDb.collection(ACCOUNT_ENTITLEMENTS_COLLECTION).doc(userId);
}

export function listSubscriptionOffers(): SubscriptionOffer[] {
  const toPublicOffer = (offer: StripeOfferConfig): SubscriptionOffer => ({
    offerId: offer.offerId,
    planId: offer.planId,
    label: offer.label,
    description: offer.description,
    currency: offer.currency,
    unitAmount: offer.unitAmount,
    billingInterval: offer.billingInterval,
    action: offer.action,
    contactEmail: offer.contactEmail,
  });
  return [
    toPublicOffer(STRIPE_OFFERS.pro_monthly),
    toPublicOffer(STRIPE_OFFERS.pro_yearly),
    RESEARCH_CONTACT_OFFER,
  ];
}

export function getStripeOfferConfig(offerId: string | null | undefined): StripeOfferConfig | null {
  if (!offerId) {
    return null;
  }
  if (offerId === "pro_monthly" || offerId === "pro_yearly") {
    return STRIPE_OFFERS[offerId];
  }
  return null;
}

export function defaultBatchVisibilityForSubscription(summary: SubscriptionSummary): BatchVisibility {
  return summary.limits.maxStoredPrivateBatches > 0 ? "private" : "public";
}

export function buildSubscriptionSummary(
  raw: Record<string, unknown> | undefined,
  now: Date = new Date(),
): SubscriptionSummary {
  const stored = readStoredEntitlementData(raw);
  const effectivePlanId = effectivePlanIdFor(stored);
  const effectivePlan = PLAN_DEFINITIONS[effectivePlanId];
  const limits = mergeLimits(
    effectivePlan.limits,
    effectivePlanId === stored.planId ? stored.limitOverrides : {},
  );
  const activeUsageMonth = monthKeyFor(now);
  const monthlyPointsUsed = stored.currentUsageMonth === activeUsageMonth
    ? stored.currentMonthPointsUploaded
    : 0;
  return {
    planId: effectivePlanId,
    label: effectivePlan.label,
    source: effectiveSourceFor(stored, effectivePlanId),
    status: effectiveStatusFor(stored, effectivePlanId),
    billingInterval: effectivePlanId === "free_community" ? null : stored.billingInterval,
    canManageBilling: Boolean(stored.stripeCustomerId),
    cancelAtPeriodEnd: stored.stripeCancelAtPeriodEnd,
    currentPeriodEnd: stored.stripeCurrentPeriodEnd,
    videoDownloadAccess: effectivePlan.videoDownloadAccess,
    limits,
    usage: {
      activeDevices: stored.activeDeviceCount,
      storedBatchesTotal: stored.storedBatchCount,
      storedPrivateBatches: stored.storedPrivateBatchCount,
      monthlyPointsUsed,
      monthlyPointsRemaining: Math.max(0, limits.monthlyPoints - monthlyPointsUsed),
      monthKey: activeUsageMonth,
      resetAt: monthResetAt(activeUsageMonth),
    },
  };
}

export async function getSubscriptionSummary(
  userId: string,
  targetDb: Firestore = getDb(),
): Promise<SubscriptionSummary> {
  const snap = await docRef(targetDb, userId).get();
  return buildSubscriptionSummary(snap.exists ? (snap.data() as Record<string, unknown>) : undefined);
}

export async function getStripeCustomerIdForUser(
  userId: string,
  targetDb: Firestore = getDb(),
): Promise<string | null> {
  const snap = await docRef(targetDb, userId).get();
  return readStoredEntitlementData(snap.exists ? (snap.data() as Record<string, unknown>) : undefined).stripeCustomerId;
}

function baseCounterPayload(
  userId: string,
  now: Date,
  data: StoredEntitlementData,
  override: StoredCounterOverride,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    userId,
    activeDeviceCount: override.activeDeviceCount ?? data.activeDeviceCount,
    storedBatchCount: override.storedBatchCount ?? data.storedBatchCount,
    storedPrivateBatchCount: override.storedPrivateBatchCount ?? data.storedPrivateBatchCount,
    currentUsageMonth: override.currentUsageMonth ?? data.currentUsageMonth ?? monthKeyFor(now),
    currentMonthPointsUploaded: override.currentMonthPointsUploaded ?? data.currentMonthPointsUploaded,
    updatedAt: override.updatedAt ?? now.toISOString(),
  };
  if (!data.createdAt) {
    payload.createdAt = now.toISOString();
  }
  return payload;
}

export async function reserveUploadQuota(args: {
  userId: string;
  visibility: BatchVisibility;
  pointCount: number;
  targetDb?: Firestore;
  now?: Date;
}): Promise<UploadQuotaReservation> {
  const targetDb = args.targetDb ?? getDb();
  const now = args.now ?? new Date();

  return targetDb.runTransaction(async (tx) => {
    const ref = docRef(targetDb, args.userId);
    const snap = await tx.get(ref);
    const raw = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
    const stored = readStoredEntitlementData(raw);
    const summary = buildSubscriptionSummary(raw, now);

    if (args.pointCount > summary.limits.maxPointsPerBatch) {
      throw quotaExceeded(
        summary,
        "points_per_batch",
        summary.limits.maxPointsPerBatch,
        summary.limits.maxPointsPerBatch,
        args.pointCount,
        "Batch exceeds the per-batch upload budget for the current plan.",
      );
    }

    if (args.visibility === "private" && summary.limits.maxStoredPrivateBatches < 1) {
      throw quotaExceeded(
        summary,
        "stored_private_batches",
        summary.limits.maxStoredPrivateBatches,
        summary.usage.storedPrivateBatches,
        1,
        "Private batch uploads require a paid subscription.",
      );
    }

    if (summary.usage.storedBatchesTotal + 1 > summary.limits.maxStoredBatchesTotal) {
      throw quotaExceeded(
        summary,
        "stored_batches_total",
        summary.limits.maxStoredBatchesTotal,
        summary.usage.storedBatchesTotal,
        1,
        "Stored batch limit reached for the current plan.",
      );
    }

    if (args.visibility === "private" && summary.usage.storedPrivateBatches + 1 > summary.limits.maxStoredPrivateBatches) {
      throw quotaExceeded(
        summary,
        "stored_private_batches",
        summary.limits.maxStoredPrivateBatches,
        summary.usage.storedPrivateBatches,
        1,
        "Private batch limit reached for the current plan.",
      );
    }

    if (summary.usage.monthlyPointsUsed + args.pointCount > summary.limits.monthlyPoints) {
      throw monthlyQuotaExceeded(summary, args.pointCount, now);
    }

    const currentMonthKey = monthKeyFor(now);
    const override: StoredCounterOverride = {
      storedBatchCount: summary.usage.storedBatchesTotal + 1,
      storedPrivateBatchCount: summary.usage.storedPrivateBatches + (args.visibility === "private" ? 1 : 0),
      currentUsageMonth: currentMonthKey,
      currentMonthPointsUploaded: summary.usage.monthlyPointsUsed + args.pointCount,
      updatedAt: now.toISOString(),
    };
    tx.set(ref, baseCounterPayload(args.userId, now, stored, override), { merge: true });

    return {
      monthKey: currentMonthKey,
      pointCount: args.pointCount,
      visibility: args.visibility,
      subscription: buildSubscriptionSummary(applyCounterOverride(stored, override) as unknown as Record<string, unknown>, now),
    };
  });
}

export async function rollbackUploadQuotaReservation(args: {
  userId: string;
  visibility: BatchVisibility;
  pointCount: number;
  reservationMonthKey: string;
  targetDb?: Firestore;
  now?: Date;
}): Promise<void> {
  const targetDb = args.targetDb ?? getDb();
  const now = args.now ?? new Date();

  await targetDb.runTransaction(async (tx) => {
    const ref = docRef(targetDb, args.userId);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return;
    }
    const raw = snap.data() as Record<string, unknown>;
    const stored = readStoredEntitlementData(raw);
    const currentPoints = stored.currentUsageMonth === args.reservationMonthKey
      ? Math.max(0, stored.currentMonthPointsUploaded - args.pointCount)
      : stored.currentMonthPointsUploaded;
    const override: StoredCounterOverride = {
      storedBatchCount: Math.max(0, stored.storedBatchCount - 1),
      storedPrivateBatchCount: args.visibility === "private"
        ? Math.max(0, stored.storedPrivateBatchCount - 1)
        : stored.storedPrivateBatchCount,
      currentMonthPointsUploaded: currentPoints,
      updatedAt: now.toISOString(),
    };
    tx.set(ref, baseCounterPayload(args.userId, now, stored, override), { merge: true });
  });
}

export async function writeDeviceWithQuota(args: {
  userId: string;
  deviceRef: DocumentReference;
  deviceData: Record<string, unknown>;
  targetDb?: Firestore;
  now?: Date;
}): Promise<void> {
  const targetDb = args.targetDb ?? getDb();
  const now = args.now ?? new Date();

  await targetDb.runTransaction(async (tx) => {
    const ref = docRef(targetDb, args.userId);
    const snap = await tx.get(ref);
    const raw = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
    const stored = readStoredEntitlementData(raw);
    const summary = buildSubscriptionSummary(raw, now);
    if (summary.usage.activeDevices + 1 > summary.limits.maxActiveDevices) {
      throw quotaExceeded(
        summary,
        "active_devices",
        summary.limits.maxActiveDevices,
        summary.usage.activeDevices,
        1,
        "Active device limit reached for the current plan.",
      );
    }

    tx.set(args.deviceRef, args.deviceData);
    const override: StoredCounterOverride = {
      activeDeviceCount: summary.usage.activeDevices + 1,
      currentUsageMonth: summary.usage.monthKey,
      currentMonthPointsUploaded: summary.usage.monthlyPointsUsed,
      updatedAt: now.toISOString(),
    };
    tx.set(ref, baseCounterPayload(args.userId, now, stored, override), { merge: true });
  });
}

export async function decrementActiveDeviceCount(args: {
  userId: string;
  targetDb?: Firestore;
  now?: Date;
}): Promise<void> {
  const targetDb = args.targetDb ?? getDb();
  const now = args.now ?? new Date();

  await targetDb.runTransaction(async (tx) => {
    const ref = docRef(targetDb, args.userId);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return;
    }
    const raw = snap.data() as Record<string, unknown>;
    const stored = readStoredEntitlementData(raw);
    const override: StoredCounterOverride = {
      activeDeviceCount: Math.max(0, stored.activeDeviceCount - 1),
      updatedAt: now.toISOString(),
    };
    tx.set(ref, baseCounterPayload(args.userId, now, stored, override), { merge: true });
  });
}

export async function applyStoredBatchDeletion(args: {
  userId: string;
  visibility: BatchVisibility;
  targetDb?: Firestore;
  now?: Date;
}): Promise<void> {
  const targetDb = args.targetDb ?? getDb();
  const now = args.now ?? new Date();

  await targetDb.runTransaction(async (tx) => {
    const ref = docRef(targetDb, args.userId);
    const snap = await tx.get(ref);
    if (!snap.exists) {
      return;
    }
    const raw = snap.data() as Record<string, unknown>;
    const stored = readStoredEntitlementData(raw);
    const override: StoredCounterOverride = {
      storedBatchCount: Math.max(0, stored.storedBatchCount - 1),
      storedPrivateBatchCount: args.visibility === "private"
        ? Math.max(0, stored.storedPrivateBatchCount - 1)
        : stored.storedPrivateBatchCount,
      updatedAt: now.toISOString(),
    };
    tx.set(ref, baseCounterPayload(args.userId, now, stored, override), { merge: true });
  });
}

export async function applyBatchVisibilityChange(args: {
  userId: string;
  fromVisibility: BatchVisibility;
  toVisibility: BatchVisibility;
  targetDb?: Firestore;
  now?: Date;
}): Promise<void> {
  if (args.fromVisibility === args.toVisibility) {
    return;
  }

  const targetDb = args.targetDb ?? getDb();
  const now = args.now ?? new Date();

  await targetDb.runTransaction(async (tx) => {
    const ref = docRef(targetDb, args.userId);
    const snap = await tx.get(ref);
    const raw = snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
    const stored = readStoredEntitlementData(raw);
    const summary = buildSubscriptionSummary(raw, now);

    if (args.toVisibility === "private" && summary.limits.maxStoredPrivateBatches < 1) {
      throw quotaExceeded(
        summary,
        "stored_private_batches",
        summary.limits.maxStoredPrivateBatches,
        summary.usage.storedPrivateBatches,
        1,
        "Private batches require a paid subscription.",
      );
    }

    const nextPrivateCount = args.toVisibility === "private"
      ? summary.usage.storedPrivateBatches + 1
      : Math.max(0, summary.usage.storedPrivateBatches - 1);

    if (args.toVisibility === "private" && nextPrivateCount > summary.limits.maxStoredPrivateBatches) {
      throw quotaExceeded(
        summary,
        "stored_private_batches",
        summary.limits.maxStoredPrivateBatches,
        summary.usage.storedPrivateBatches,
        1,
        "Private batch limit reached for the current plan.",
      );
    }

    const override: StoredCounterOverride = {
      storedPrivateBatchCount: nextPrivateCount,
      updatedAt: now.toISOString(),
    };
    tx.set(ref, baseCounterPayload(args.userId, now, stored, override), { merge: true });
  });
}

export async function upsertStripeSubscriptionState(
  state: StripeSubscriptionState,
  targetDb: Firestore = getDb(),
): Promise<void> {
  const ref = docRef(targetDb, state.userId);
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    userId: state.userId,
    planId: state.planId,
    source: "stripe",
    status: state.status,
    billingInterval: state.billingInterval,
    stripeCustomerId: state.stripeCustomerId,
    stripeSubscriptionId: state.stripeSubscriptionId,
    stripePriceId: state.stripePriceId,
    stripeCancelAtPeriodEnd: Boolean(state.cancelAtPeriodEnd),
    updatedAt: now,
  };
  if (state.stripeCheckoutSessionId !== undefined) {
    payload.stripeCheckoutSessionId = state.stripeCheckoutSessionId;
  }
  if (state.currentPeriodEnd !== undefined) {
    payload.stripeCurrentPeriodEnd = state.currentPeriodEnd;
  }
  await ref.set(payload, { merge: true });
}

export async function linkStripeCustomerToUser(
  userId: string,
  stripeCustomerId: string,
  targetDb: Firestore = getDb(),
): Promise<void> {
  await docRef(targetDb, userId).set({
    schemaVersion: ENTITLEMENT_SCHEMA_VERSION,
    userId,
    stripeCustomerId,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
}
