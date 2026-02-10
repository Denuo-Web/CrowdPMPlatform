export type BatchVisibility = "public" | "private";
export type ModerationState = "approved" | "quarantined";
export type AdminRole = "super_admin" | "moderator";

export type DeviceSummary = {
  id: string;
  name?: string | null;
  status?: string | null;
  registryStatus?: string | null;
  ownerUserId?: string | null;
  ownerUserIds?: string[] | null;
  publicDeviceId?: string | null;
  ownerScope?: string | null;
  createdAt: string | null;
  fingerprint?: string | null;
  lastSeenAt: string | null;
} & Record<string, unknown>;

export type FirestoreTimestampLike = {
  toDate(): Date;
  toMillis(): number;
};

export type TimestampInput =
  | string
  | number
  | Date
  | FirestoreTimestampLike
  | { toDate?: () => Date | null; toMillis?: () => number }
  | null
  | undefined;

function hasToDate(value: unknown): value is { toDate: () => Date | null } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { toDate?: () => Date | null }).toDate === "function";
}

function hasToMillis(value: unknown): value is { toMillis: () => number } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { toMillis?: () => number }).toMillis === "function";
}

export function timestampToDate(input: TimestampInput): Date | null {
  if (input === null || input === undefined) return null;
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === "number") {
    return Number.isFinite(input) ? new Date(input) : null;
  }
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (hasToDate(input)) {
    try {
      const date = input.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date;
      }
    }
    catch {
      // try toMillis fallback below when available
    }
  }
  if (hasToMillis(input)) {
    try {
      const millis = input.toMillis();
      return Number.isFinite(millis) ? new Date(millis) : null;
    }
    catch {
      return null;
    }
  }
  return null;
}

export function timestampToMillis(input: TimestampInput): number | null {
  const date = timestampToDate(input);
  return date ? date.getTime() : null;
}

export function timestampToIsoString(input: TimestampInput): string | null {
  const date = timestampToDate(input);
  return date ? date.toISOString() : null;
}

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

export type IngestPoint = {
  device_id: string;
  pollutant: string;
  value: number;
  unit?: string | null;
  lat?: number;
  lon?: number;
  altitude?: number | null;
  precision?: number | null;
  timestamp: string;
  flags?: number;
};

export type IngestBody = {
  device_id?: string;
  points?: IngestPoint[];
};

export type IngestBatchPayload = {
  device_id?: string;
  points: IngestPoint[];
};

export type IngestResult = {
  accepted: true;
  batchId: string;
  deviceId: string;
  storagePath: string;
  visibility: BatchVisibility;
};

export type BatchSummary = {
  batchId: string;
  deviceId: string;
  deviceName?: string | null;
  count: number;
  processedAt: string | null;
  visibility: BatchVisibility;
  moderationState: ModerationState;
};

export type BatchDetail = BatchSummary & {
  points: IngestPoint[];
};

export type PublicBatchSummary = BatchSummary;
export type PublicBatchDetail = BatchDetail;

export type AdminSubmissionSummary = BatchSummary & {
  moderationReason?: string | null;
  moderatedBy?: string | null;
  moderatedAt?: string | null;
};

export type AdminSubmissionListResponse = {
  submissions: AdminSubmissionSummary[];
};

export type AdminSubmissionUpdateRequest = {
  moderationState: ModerationState;
  reason?: string | null;
};

export type UserSettings = {
  defaultBatchVisibility: BatchVisibility;
  interleavedRendering: boolean;
};

export type SmokeTestRequestBody = {
  deviceId?: string;
  payload?: IngestBody;
  pointOverrides?: Partial<IngestPoint>;
  visibility?: BatchVisibility;
};

export type SmokeTestResponse = IngestResult & {
  payload: IngestBatchPayload;
  points: IngestPoint[];
  seededDeviceId: string;
  seededDeviceIds: string[];
};

export type SmokeTestCleanupResponse = {
  clearedDeviceId: string | null;
  clearedDeviceIds?: string[];
};

export type AdminUserSummary = {
  uid: string;
  email: string | null;
  disabled: boolean;
  roles: AdminRole[];
  createdAt: string | null;
  lastSignInAt: string | null;
};

export type AdminUsersListResponse = {
  users: AdminUserSummary[];
  nextPageToken: string | null;
};

export type AdminUserUpdateRequest = {
  roles?: AdminRole[];
  disabled?: boolean;
  reason?: string;
};

export type SessionStatus = "pending" | "authorized" | "redeemed" | "expired";

export type PairingPublicKey = {
  kty: string;
  crv?: string;
  x?: string;
  [key: string]: unknown;
};

export type PairingSession = {
  id: string;
  deviceCode: string;
  userCode: string;
  userCodeCanonical: string;
  pubKeJwk: PairingPublicKey;
  pubKeThumbprint: string;
  model: string;
  version: string;
  nonce: string | null;
  status: SessionStatus;
  createdAt: Date;
  expiresAt: Date;
  pollInterval: number;
  requesterIp: string | null;
  requesterAsn: string | null;
  fingerprint: string;
  accId: string | null;
  authorizedAt: Date | null;
  authorizedBy: string | null;
  registrationTokenJti: string | null;
  registrationTokenExpiresAt: Date | null;
  lastPollAt: Date | null;
  deviceId: string | null;
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
  status: SessionStatus;
  poll_interval: number;
  authorized_account?: string | null;
  viewer_account?: string | null;
};
