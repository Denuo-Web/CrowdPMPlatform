import type { firestore } from "firebase-admin";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type { BatchVisibility, SmokeTestResponse } from "@crowdpm/types";
import {
  DEFAULT_BATCH_VISIBILITY,
  getUserDefaultBatchVisibility,
} from "../lib/batchVisibility.js";
import { app as getFirebaseApp, db as getDb } from "../lib/fire.js";
import { normalizeVisibility } from "../lib/httpValidation.js";
import type { IngestService } from "./ingestService.js";
import { prepareSmokeTestPlan, type SmokeTestBody, type SmokeTestPlan } from "./smokeTest.js";

export type SmokeTestRequest = {
  user: DecodedIdToken;
  body?: SmokeTestBody;
};

export type SmokeTestResult = SmokeTestResponse;

export type SmokeTestErrorReason = "forbidden" | "invalid_payload";

export class SmokeTestServiceError extends Error {
  readonly statusCode: number;
  readonly reason: SmokeTestErrorReason;

  constructor(reason: SmokeTestErrorReason, message: string, statusCode: number) {
    super(message);
    this.reason = reason;
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, SmokeTestServiceError.prototype);
  }
}

type ResolvedDependencies = {
  db: Firestore;
  preparePlan: typeof prepareSmokeTestPlan;
  getUserDefaultBatchVisibility: typeof getUserDefaultBatchVisibility;
  arrayUnion: (...values: unknown[]) => firestore.FieldValue;
  authorize: (user: DecodedIdToken) => Promise<void> | void;
  ingest?: Pick<IngestService, "ingest">;
};

export type SmokeTestServiceDependencies = Partial<ResolvedDependencies>;

export function authorizeSmokeTestUser(user: DecodedIdToken): void {
  if (isSmokeTestEmail(user)) return;
  const roles = extractRoles(user);
  const allowedRoles = new Set(["smoke-test", "smoke_test", "smoketester"]);
  const hasAllowedRole = roles.some((role) => allowedRoles.has(role.toLowerCase()));
  if (hasAllowedRole) return;
  throw new SmokeTestServiceError("forbidden", "Caller lacks permission to run smoke tests", 403);
}

function defaultAuthorizeSmokeTest(user: DecodedIdToken): void {
  authorizeSmokeTestUser(user);
}

const SMOKE_TEST_EMAILS = normalizeEmails(
  process.env.SMOKE_TEST_USER_EMAILS
  ?? process.env.SMOKE_TEST_USER_EMAIL
  ?? process.env.DEV_AUTH_USER_EMAIL
  ?? "smoke-tester@crowdpm.dev"
);

function normalizeEmails(raw: string): Set<string> {
  return new Set(
    raw.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
}

function isSmokeTestEmail(user: DecodedIdToken): boolean {
  const email = (user as { email?: unknown }).email;
  if (typeof email !== "string") return false;
  return SMOKE_TEST_EMAILS.has(email.trim().toLowerCase());
}

function extractRoles(user: DecodedIdToken): string[] {
  const rawRoles = (user as { roles?: unknown }).roles;
  if (!Array.isArray(rawRoles)) return [];
  return rawRoles
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

export class IngestSmokeTestService {
  private readonly deps: ResolvedDependencies;
  private ingestInstance: Pick<IngestService, "ingest"> | null = null;

  constructor(overrides?: SmokeTestServiceDependencies) {
    const arrayUnion = overrides?.arrayUnion ?? getFirebaseApp().firestore.FieldValue.arrayUnion;
    this.deps = {
      db: overrides?.db ?? getDb(),
      preparePlan: overrides?.preparePlan ?? prepareSmokeTestPlan,
      getUserDefaultBatchVisibility: overrides?.getUserDefaultBatchVisibility ?? getUserDefaultBatchVisibility,
      arrayUnion,
      authorize: overrides?.authorize ?? defaultAuthorizeSmokeTest,
      ingest: overrides?.ingest,
    };
  }

  async runSmokeTest(request: SmokeTestRequest): Promise<SmokeTestResult> {
    await this.deps.authorize(request.user);

    const plan = this.buildPlan(request.user.uid, request.body);
    const visibility = await this.resolveVisibility(request.user.uid, request.body?.visibility);
    const ingest = await this.resolveIngest();

    await this.seedSmokeTestDevices({
      ownerIds: [request.user.uid],
      ownerSegment: plan.ownerSegment,
      seedTargets: plan.seedTargets,
      scopedToRawIds: plan.scopedToRawIds,
    });

    const raw = JSON.stringify(plan.payload);
    const ingestResult = await ingest.ingest({
      rawBody: raw,
      body: plan.payload,
      deviceId: plan.primaryDeviceId,
      visibility,
    });

    return {
      ...ingestResult,
      payload: plan.payload,
      points: plan.displayPoints,
      seededDeviceId: plan.primaryDeviceId,
      seededDeviceIds: plan.seedTargets,
    };
  }

  private buildPlan(userId: string, body?: SmokeTestBody): SmokeTestPlan {
    try {
      return this.deps.preparePlan(userId, body);
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "invalid smoke test payload";
      throw new SmokeTestServiceError("invalid_payload", message, 400);
    }
  }

  private async resolveVisibility(userId: string, requestedVisibility: BatchVisibility | null | undefined): Promise<BatchVisibility> {
    const defaultVisibility = await this.deps.getUserDefaultBatchVisibility(userId);
    return normalizeVisibility(requestedVisibility, defaultVisibility ?? DEFAULT_BATCH_VISIBILITY);
  }

  private async resolveIngest(): Promise<Pick<IngestService, "ingest">> {
    if (this.ingestInstance) return this.ingestInstance;
    if (this.deps.ingest) {
      this.ingestInstance = this.deps.ingest;
      return this.ingestInstance;
    }
    const module = await import("./ingestService.js");
    this.ingestInstance = module.ingestService;
    return this.ingestInstance;
  }

  private async seedSmokeTestDevices({ ownerIds, ownerSegment, seedTargets, scopedToRawIds }: {
    ownerIds: string[];
    ownerSegment: string;
    seedTargets: string[];
    scopedToRawIds: Map<string, string>;
  }): Promise<void> {
    if (!seedTargets.length) return;
    const primaryOwnerId = ownerIds[0] ?? null;
    const timestamp = new Date().toISOString();

    await Promise.all(seedTargets.map(async (deviceId) => {
      const publicDeviceId = scopedToRawIds.get(deviceId) ?? deviceId;
      const payload: Record<string, unknown> = {
        status: "ACTIVE",
        name: "Smoke Test Device",
        createdAt: timestamp,
        publicDeviceId,
        ownerScope: ownerSegment,
      };
      if (primaryOwnerId) {
        payload.ownerUserId = primaryOwnerId;
      }
      if (ownerIds.length) {
        payload.ownerUserIds = this.deps.arrayUnion(...ownerIds);
      }
      await this.deps.db.collection("devices").doc(deviceId).set(payload, { merge: true });
    }));
  }
}

export function createIngestSmokeTestService(overrides?: SmokeTestServiceDependencies): IngestSmokeTestService {
  return new IngestSmokeTestService(overrides);
}

let cachedSmokeTestService: IngestSmokeTestService | null = null;

export function getIngestSmokeTestService(): IngestSmokeTestService {
  if (!cachedSmokeTestService) {
    cachedSmokeTestService = createIngestSmokeTestService();
  }
  return cachedSmokeTestService;
}
