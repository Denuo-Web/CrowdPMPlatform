import { auth } from "./firebase";
import type {
  ActivationSession,
  AdminSubmissionListResponse,
  AdminSubmissionSummary,
  AdminSubmissionUpdateRequest,
  AdminUserSummary,
  AdminUserUpdateRequest,
  AdminUsersListResponse,
  AdminRole,
  BatchDetail,
  BatchSummary,
  BatchVisibility,
  DemoBatchSetting,
  DeviceSummary,
  FirestoreTimestampLike,
  MeasurementRecord,
  ModerationState,
  NodeCampaignTierId,
  NodePurchaseReceipt,
  NodePurchaseVariantId,
  PublicBatchDetail,
  PublicBatchMapResponse,
  PublicBatchSummary,
  SubscriptionOffer,
  SubscriptionOfferId,
  SubscriptionSummary,
  UserSettings,
} from "@crowdpm/types";

const rawBase = import.meta.env.VITE_API_BASE as string | undefined;
const BASE = rawBase ? rawBase.trim().replace(/\/$/, "") : "/api";
const FIREBASE_HOSTING_DOMAINS = ["web.app", "firebaseapp.com"] as const;

function buildUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BASE}${normalizedPath}`;
}

function isFirebaseHostingHost(hostname: string | null | undefined): boolean {
  if (!hostname) {
    return false;
  }
  const normalized = hostname.toLowerCase();
  return FIREBASE_HOSTING_DOMAINS.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = buildUrl(path);
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Authorization")) {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }
  const response = await fetch(url, { ...init, headers });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const bodyText = await response.text().catch(() => "");

  if (!response.ok) {
    const errorBody = bodyText.trim();
    if (errorBody) {
      let parsedMessage: string | null = null;
      try {
        const parsed = JSON.parse(errorBody) as { error?: unknown; message?: unknown };
        parsedMessage = typeof parsed.message === "string"
          ? parsed.message
          : typeof parsed.error === "string"
            ? parsed.error
            : null;
      }
      catch {
        // fall through to raw body handling
      }
      if (parsedMessage) {
        throw new Error(parsedMessage);
      }
    }
    throw new Error(errorBody || `Request to ${url} failed with status ${response.status}`);
  }

  if (!contentType.includes("application/json")) {
    const { host, hostname } = (() => {
      try {
        const parsed = new URL(url);
        return { host: parsed.host, hostname: parsed.hostname };
      }
      catch {
        return { host: url, hostname: null };
      }
    })();
    const snippet = bodyText.trim().replace(/\s+/g, " ").slice(0, 160);
    const hint = url.startsWith("/api")
      ? "Ensure /api is proxied or rewritten to crowdpmApi, or set VITE_API_BASE to the Functions endpoint."
      : isFirebaseHostingHost(hostname)
        ? "Ensure VITE_API_BASE points to your Functions endpoint instead of the Hosting URL."
        : "Ensure VITE_API_BASE points to your Functions endpoint.";
    const responsePreview = snippet ? ` Response starts with: ${snippet}` : "";
    throw new Error(`Expected JSON from ${host} but received ${contentType || "unknown content"}. ${hint}${responsePreview}`);
  }

  try {
    return JSON.parse(bodyText) as T;
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to parse JSON payload from ${url}: ${message}`);
  }
}

export type {
  ActivationSession,
  AdminSubmissionSummary,
  AdminUserSummary,
  AdminRole,
  BatchDetail,
  BatchSummary,
  BatchVisibility,
  DemoBatchSetting,
  DeviceSummary,
  FirestoreTimestampLike,
  MeasurementRecord,
  ModerationState,
  NodeCampaignTierId,
  NodePurchaseReceipt,
  NodePurchaseVariantId,
  PublicBatchDetail,
  PublicBatchMapResponse,
  PublicBatchSummary,
  SubscriptionOffer,
  SubscriptionOfferId,
  SubscriptionSummary,
  UserSettings,
};
export type CheckoutRedirectSession = {
  sessionId: string;
  url: string;
};

export async function listDevices(): Promise<DeviceSummary[]> {
  return requestJson<DeviceSummary[]>("/v1/devices");
}

export async function createNodePurchaseCheckoutSession(
  variantId: NodePurchaseVariantId = "standard",
  quantity = 1,
): Promise<CheckoutRedirectSession> {
  return requestJson<CheckoutRedirectSession>("/v1/node-purchase/checkout-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ variantId, quantity }),
  });
}

export async function createNodeCampaignCheckoutSession(
  tierId: NodeCampaignTierId,
  quantity = 1,
): Promise<CheckoutRedirectSession> {
  return requestJson<CheckoutRedirectSession>("/v1/node-purchase/checkout-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ tierId, quantity }),
  });
}

export async function listNodePurchaseReceipts(): Promise<NodePurchaseReceipt[]> {
  return requestJson<NodePurchaseReceipt[]>("/v1/node-purchase/receipts");
}

export async function createThemeSaveCheckoutSession(): Promise<CheckoutRedirectSession> {
  return requestJson<CheckoutRedirectSession>("/v1/theme-purchase/checkout-session", {
    method: "POST",
  });
}

export async function createSubscriptionCheckoutSession(offerId: "pro_monthly" | "pro_yearly"): Promise<CheckoutRedirectSession> {
  return requestJson<CheckoutRedirectSession>("/v1/subscription/checkout-session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ offerId }),
  });
}

export async function confirmSubscriptionCheckoutSession(sessionId: string): Promise<{
  confirmed: true;
  sessionId: string;
  subscriptionSynchronized: true;
}> {
  return requestJson("/v1/subscription/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionId }),
  });
}

export async function createBillingPortalSession(): Promise<CheckoutRedirectSession> {
  return requestJson<CheckoutRedirectSession>("/v1/subscription/billing-portal", {
    method: "POST",
  });
}

export async function confirmThemeSaveCheckoutSession(sessionId: string): Promise<{
  confirmed: true;
  sessionId: string;
  unlockGranted: true;
}> {
  return requestJson("/v1/theme-purchase/confirm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sessionId }),
  });
}

export async function listBatches(limit?: number): Promise<BatchSummary[]> {
  const qs = new URLSearchParams();
  if (typeof limit === "number" && Number.isFinite(limit)) {
    qs.set("limit", String(Math.max(1, Math.floor(limit))));
  }
  const suffix = qs.toString();
  return requestJson<BatchSummary[]>(suffix ? `/v1/batches?${suffix}` : "/v1/batches");
}

export async function updateBatchVisibility(
  deviceId: string,
  batchId: string,
  visibility: BatchVisibility
): Promise<BatchSummary> {
  const safeDevice = encodeURIComponent(deviceId);
  const safeBatch = encodeURIComponent(batchId);
  return requestJson<BatchSummary>(`/v1/batches/${safeDevice}/${safeBatch}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ visibility }),
  });
}

export async function deleteBatch(deviceId: string, batchId: string): Promise<{ status: string; deviceId: string; batchId: string }> {
  const safeDevice = encodeURIComponent(deviceId);
  const safeBatch = encodeURIComponent(batchId);
  return requestJson<{ status: string; deviceId: string; batchId: string }>(`/v1/batches/${safeDevice}/${safeBatch}`, {
    method: "DELETE",
  });
}

export async function fetchBatchDetail(deviceId: string, batchId: string): Promise<BatchDetail> {
  const safeDevice = encodeURIComponent(deviceId);
  const safeBatch = encodeURIComponent(batchId);
  return requestJson<BatchDetail>(`/v1/batches/${safeDevice}/${safeBatch}`);
}

export async function listPublicBatches(limit?: number): Promise<PublicBatchSummary[]> {
  const qs = new URLSearchParams();
  if (typeof limit === "number" && Number.isFinite(limit)) {
    qs.set("limit", String(Math.max(1, Math.floor(limit))));
  }
  const suffix = qs.toString();
  return requestJson<PublicBatchSummary[]>(suffix ? `/v1/public/batches?${suffix}` : "/v1/public/batches");
}

export async function fetchPublicBatchDetail(deviceId: string, batchId: string): Promise<PublicBatchDetail> {
  const safeDevice = encodeURIComponent(deviceId);
  const safeBatch = encodeURIComponent(batchId);
  return requestJson<PublicBatchDetail>(`/v1/public/batches/${safeDevice}/${safeBatch}`);
}

export async function fetchPublicBatchMap(params?: {
  limit?: number;
  since?: string;
}): Promise<PublicBatchMapResponse> {
  const qs = new URLSearchParams();
  if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
    qs.set("limit", String(Math.max(1, Math.floor(params.limit))));
  }
  if (typeof params?.since === "string" && params.since.trim().length > 0) {
    qs.set("since", params.since.trim());
  }
  const suffix = qs.toString();
  return requestJson<PublicBatchMapResponse>(suffix ? `/v1/public/batches/map?${suffix}` : "/v1/public/batches/map");
}

export async function fetchDemoBatch(): Promise<PublicBatchSummary | null> {
  return requestJson<PublicBatchSummary | null>("/v1/public/demo-batch");
}

export async function listAdminSubmissions(params?: {
  limit?: number;
  moderationState?: ModerationState;
  visibility?: BatchVisibility;
}): Promise<AdminSubmissionSummary[]> {
  const qs = new URLSearchParams();
  if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
    qs.set("limit", String(Math.max(1, Math.floor(params.limit))));
  }
  if (params?.moderationState) {
    qs.set("moderationState", params.moderationState);
  }
  if (params?.visibility) {
    qs.set("visibility", params.visibility);
  }
  const suffix = qs.toString();
  const response = await requestJson<AdminSubmissionListResponse>(suffix ? `/v1/admin/submissions?${suffix}` : "/v1/admin/submissions");
  return Array.isArray(response.submissions) ? response.submissions : [];
}

export async function getAdminDemoBatch(): Promise<DemoBatchSetting> {
  return requestJson<DemoBatchSetting>("/v1/admin/demo-batch");
}

export async function setAdminDemoBatch(deviceId: string, batchId: string): Promise<NonNullable<DemoBatchSetting>> {
  return requestJson<NonNullable<DemoBatchSetting>>("/v1/admin/demo-batch", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId, batchId }),
  });
}

export async function moderateAdminSubmission(
  deviceId: string,
  batchId: string,
  payload: AdminSubmissionUpdateRequest
): Promise<AdminSubmissionSummary> {
  const safeDevice = encodeURIComponent(deviceId);
  const safeBatch = encodeURIComponent(batchId);
  return requestJson<AdminSubmissionSummary>(`/v1/admin/submissions/${safeDevice}/${safeBatch}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function listAdminUsers(params?: { pageToken?: string; limit?: number }): Promise<AdminUsersListResponse> {
  const qs = new URLSearchParams();
  if (params?.pageToken) {
    qs.set("pageToken", params.pageToken);
  }
  if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
    qs.set("limit", String(Math.max(1, Math.floor(params.limit))));
  }
  const suffix = qs.toString();
  return requestJson<AdminUsersListResponse>(suffix ? `/v1/admin/users?${suffix}` : "/v1/admin/users");
}

export async function updateAdminUser(uid: string, payload: AdminUserUpdateRequest): Promise<AdminUserSummary> {
  const safeUid = encodeURIComponent(uid);
  return requestJson<AdminUserSummary>(`/v1/admin/users/${safeUid}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchUserSettings(): Promise<UserSettings> {
  return requestJson<UserSettings>("/v1/user/settings");
}

export async function updateUserSettings(next: Partial<UserSettings>): Promise<UserSettings> {
  return requestJson<UserSettings>("/v1/user/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
}

export async function fetchActivationSession(userCode: string): Promise<ActivationSession> {
  const qs = new URLSearchParams({ user_code: userCode.trim() });
  return requestJson<ActivationSession>(`/v1/device-activation?${qs}`);
}

export async function authorizeActivationSession(userCode: string): Promise<ActivationSession> {
  return requestJson<ActivationSession>("/v1/device-activation/authorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_code: userCode.trim() }),
  });
}

export async function revokeDevice(deviceId: string): Promise<{ status: string }> {
  const encoded = encodeURIComponent(deviceId);
  return requestJson<{ status: string }>(`/v1/devices/${encoded}/revoke`, {
    method: "POST",
  });
}
