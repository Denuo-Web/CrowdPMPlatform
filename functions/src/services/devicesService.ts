import type { firestore } from "firebase-admin";
import type { Firestore } from "firebase-admin/firestore";
import { db as getDb } from "../lib/fire.js";
import { httpError } from "../lib/httpError.js";
import { loadOwnedDeviceDocs, userOwnsDevice } from "../lib/deviceOwnership.js";
import { timestampToIsoString } from "../lib/time.js";
import { revokeDevice as revokeRegistryDevice } from "./deviceRegistry.js";

export type DeviceRecord = Record<string, unknown> & {
  id: string;
  createdAt: string | null;
  lastSeenAt: string | null;
};

type ResolvedDependencies = {
  db: Firestore;
  loadOwnedDeviceDocs: typeof loadOwnedDeviceDocs;
  userOwnsDevice: typeof userOwnsDevice;
  revokeDevice: typeof revokeRegistryDevice;
  now: () => Date;
};

export type DevicesServiceDependencies = Partial<ResolvedDependencies>;

export class DevicesService {
  private readonly deps: ResolvedDependencies;

  constructor(deps: DevicesServiceDependencies = {}) {
    this.deps = {
      db: deps.db ?? getDb(),
      loadOwnedDeviceDocs: deps.loadOwnedDeviceDocs ?? loadOwnedDeviceDocs,
      userOwnsDevice: deps.userOwnsDevice ?? userOwnsDevice,
      revokeDevice: deps.revokeDevice ?? revokeRegistryDevice,
      now: deps.now ?? (() => new Date()),
    };
  }

  async list(userId: string): Promise<DeviceRecord[]> {
    if (!userId) {
      throw httpError(401, "unauthorized", "Authentication required");
    }
    const { docs } = await this.deps.loadOwnedDeviceDocs(userId);
    return Array.from(docs.entries()).map(([id, data]) => this.serialize(id, data));
  }

  async create(userId: string, params: { name?: string | null }): Promise<{ id: string }> {
    if (!userId) {
      throw httpError(401, "unauthorized", "Authentication required");
    }
    const ref = this.deps.db.collection("devices").doc();
    const createdAt = this.deps.now().toISOString();
    await ref.set({
      name: params.name,
      ownerUserId: userId,
      ownerUserIds: [userId],
      status: "ACTIVE",
      createdAt,
    });
    return { id: ref.id };
  }

  async revoke(deviceId: string, userId: string): Promise<void> {
    if (!userId) {
      throw httpError(401, "unauthorized", "Authentication required");
    }
    const trimmedId = deviceId.trim();
    if (!trimmedId) {
      throw httpError(400, "invalid_device_id", "Device id is required");
    }

    const snap = await this.deps.db.collection("devices").doc(trimmedId).get();
    if (!snap.exists) {
      throw httpError(404, "not_found", "Device not found");
    }
    if (!this.deps.userOwnsDevice(snap.data(), userId)) {
      throw httpError(403, "forbidden", "You do not have access to this device.");
    }

    await this.deps.revokeDevice(trimmedId, userId, "user_initiated");
  }

  private serialize(id: string, data: firestore.DocumentData | undefined): DeviceRecord {
    const createdAt = timestampToIsoString(data?.createdAt);
    const lastSeenAt = timestampToIsoString(data?.lastSeenAt);
    const payload: Record<string, unknown> = { id, ...data };
    payload.createdAt = createdAt ?? null;
    payload.lastSeenAt = lastSeenAt ?? null;
    return payload as DeviceRecord;
  }
}

let cachedDevicesService: DevicesService | null = null;

export function createDevicesService(overrides?: DevicesServiceDependencies): DevicesService {
  return new DevicesService(overrides);
}

export function getDevicesService(): DevicesService {
  if (!cachedDevicesService) {
    cachedDevicesService = createDevicesService();
  }
  return cachedDevicesService;
}
