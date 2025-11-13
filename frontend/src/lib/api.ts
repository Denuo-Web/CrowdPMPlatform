import { auth } from "./firebase";

const rawBase = import.meta.env.VITE_API_BASE as string | undefined;
const BASE = rawBase ? rawBase.trim().replace(/\/$/, "") : "";
const FIREBASE_HOSTING_DOMAINS = ["web.app", "firebaseapp.com"] as const;

function ensureBase(): string {
  if (!BASE) {
    throw new Error("VITE_API_BASE is not configured. Set it to your Functions API (see README).");
  }
  return BASE;
}

function buildUrl(path: string): string {
  const base = ensureBase();
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
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
      try {
        const parsed = JSON.parse(errorBody) as { error?: unknown; message?: unknown };
        const parsedMessage = typeof parsed.error === "string"
          ? parsed.error
          : typeof parsed.message === "string"
            ? parsed.message
            : null;
        if (parsedMessage) {
          throw new Error(parsedMessage);
        }
      }
      catch {
        // fall through to raw body handling
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
    const hint = isFirebaseHostingHost(hostname)
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

export type DeviceSummary = {
  id: string;
  name?: string | null;
  status?: string | null;
  registryStatus?: string | null;
  ownerUserId?: string | null;
  ownerUserIds?: string[] | null;
  publicDeviceId?: string | null;
  ownerScope?: string | null;
  createdAt?: string | null;
  fingerprint?: string | null;
  lastSeenAt?: string | null;
};

export type FirestoreTimestampLike = {
  toDate(): Date;
  toMillis(): number;
};

export type MeasurementRecord = {
  id: string;
  deviceId: string;
  pollutant: "pm25";
  value: number;
  unit?: string | null;
  lat: number;
  lon: number;
  altitude?: number | null;
  precision?: number | null;
  timestamp: string | number | Date | FirestoreTimestampLike;
  flags?: number;
};

export type BatchVisibility = "public" | "private";

export type IngestSmokeTestPoint = {
  device_id: string;
  pollutant: string;
  value: number;
  unit?: string | null;
  lat?: number;
  lon?: number;
  timestamp: string;
  altitude?: number | null;
  precision?: number | null;
  flags?: number;
};

export type IngestSmokeTestPayload = {
  points: IngestSmokeTestPoint[];
};

export type IngestSmokeTestResponse = {
  accepted: boolean;
  batchId: string;
  deviceId: string;
  storagePath: string;
  visibility: BatchVisibility;
  seededDeviceId: string;
  seededDeviceIds?: string[];
  payload?: {
    points?: IngestSmokeTestPoint[];
  };
  points?: IngestSmokeTestPoint[];
};

export type BatchSummary = {
  batchId: string;
  deviceId: string;
  deviceName?: string | null;
  count: number;
  processedAt?: string | null;
  visibility: BatchVisibility;
};

export type BatchDetail = BatchSummary & {
  points: IngestSmokeTestPoint[];
};

export type UserSettings = {
  defaultBatchVisibility: BatchVisibility;
};

export type ActivationSession = {
  device_code: string;
  user_code: string;
  model: string;
  version: string;
  fingerprint: string;
  requested_at: string;
  expires_at: string;
  requester_ip?: string | null;
  requester_asn?: string | null;
  status: string;
  poll_interval: number;
  authorized_account?: string | null;
  viewer_account?: string | null;
};

export async function listDevices(): Promise<DeviceSummary[]> {
  return requestJson<DeviceSummary[]>("/v1/devices");
}
export async function fetchMeasurements(q: {
  device_id: string; pollutant?: "pm25"; t0: string; t1: string; limit?: number;
}): Promise<MeasurementRecord[]> {
  const qs = new URLSearchParams(Object.entries(q).map(([k,v])=>[k,String(v)]));
  return requestJson<MeasurementRecord[]>(`/v1/measurements?${qs}`);
}

export async function listBatches(): Promise<BatchSummary[]> {
  return requestJson<BatchSummary[]>("/v1/batches");
}

export async function fetchBatchDetail(deviceId: string, batchId: string): Promise<BatchDetail> {
  const safeDevice = encodeURIComponent(deviceId);
  const safeBatch = encodeURIComponent(batchId);
  return requestJson<BatchDetail>(`/v1/batches/${safeDevice}/${safeBatch}`);
}

export async function runIngestSmokeTest(
  payload?: IngestSmokeTestPayload,
  options?: { visibility?: BatchVisibility }
): Promise<IngestSmokeTestResponse> {
  const body: Record<string, unknown> = payload ? { payload } : {};
  if (options?.visibility) {
    body.visibility = options.visibility;
  }
  return requestJson<IngestSmokeTestResponse>("/v1/admin/ingest-smoke-test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function cleanupIngestSmokeTest(deviceId?: string | string[]): Promise<{ clearedDeviceId: string | null; clearedDeviceIds?: string[] }> {
  const payload = Array.isArray(deviceId)
    ? (deviceId.length ? { deviceIds: deviceId } : {})
    : (deviceId ? { deviceId } : {});
  return requestJson<{ clearedDeviceId: string | null; clearedDeviceIds?: string[] }>("/v1/admin/ingest-smoke-test/cleanup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
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
