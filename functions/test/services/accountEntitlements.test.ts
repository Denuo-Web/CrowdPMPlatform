import { describe, expect, it } from "vitest";
import {
  getSubscriptionSummary,
  reserveUploadQuota,
  writeDeviceWithQuota,
} from "../../src/services/accountEntitlements.js";

type CollectionName = "accountEntitlements" | "batches" | "devices";
type QueryFilter = { field: string; op: string; value: unknown };
type StoredDoc = Record<string, unknown>;

function matchesFilter(data: StoredDoc, filter: QueryFilter): boolean {
  const actual = data[filter.field];
  if (filter.op === "array-contains") {
    return Array.isArray(actual) && actual.includes(filter.value);
  }
  if (filter.op === "==") {
    return actual === filter.value;
  }
  throw new Error(`unsupported filter ${filter.op}`);
}

function makeTestDb(seed?: Partial<Record<CollectionName, Array<[string, StoredDoc]>>>) {
  const store: Record<CollectionName, Map<string, StoredDoc>> = {
    accountEntitlements: new Map(seed?.accountEntitlements ?? []),
    batches: new Map(seed?.batches ?? []),
    devices: new Map(seed?.devices ?? []),
  };

  function queryEntries(collectionName: CollectionName, filters: QueryFilter[]) {
    return Array.from(store[collectionName].entries())
      .filter(([, data]) => filters.every((filter) => matchesFilter(data, filter)));
  }

  function makeSnapshot(id: string, data: StoredDoc | undefined) {
    return {
      id,
      exists: Boolean(data),
      data: () => data,
      get: (field: string) => data?.[field],
    };
  }

  function makeDocRef(collectionName: CollectionName, id: string) {
    return {
      get: async () => makeSnapshot(id, store[collectionName].get(id)),
      set: async (payload: StoredDoc, options?: { merge?: boolean }) => {
        const previous = store[collectionName].get(id) ?? {};
        store[collectionName].set(id, options?.merge ? { ...previous, ...payload } : { ...payload });
      },
    };
  }

  function makeQuery(collectionName: CollectionName, filters: QueryFilter[] = []) {
    return {
      where: (field: string, op: string, value: unknown) => makeQuery(collectionName, [...filters, { field, op, value }]),
      get: async () => {
        const docs = queryEntries(collectionName, filters).map(([id, data]) => makeSnapshot(id, data));
        return {
          docs,
          forEach: (callback: (doc: typeof docs[number]) => void) => docs.forEach(callback),
        };
      },
      count: () => ({
        get: async () => ({
          data: () => ({ count: queryEntries(collectionName, filters).length }),
        }),
      }),
    };
  }

  const db = {
    collection: (name: string) => {
      const collectionName = name as CollectionName;
      return {
        doc: (id: string) => makeDocRef(collectionName, id),
        where: (field: string, op: string, value: unknown) => makeQuery(collectionName, [{ field, op, value }]),
      };
    },
    runTransaction: async <T>(handler: (tx: {
      get: (target: { get: () => Promise<unknown> }) => Promise<unknown>;
      set: (target: { set: (payload: StoredDoc, options?: { merge?: boolean }) => Promise<void> }, payload: StoredDoc, options?: { merge?: boolean }) => Promise<void>;
    }) => Promise<T>) => handler({
      get: (target) => target.get(),
      set: (target, payload, options) => target.set(payload, options),
    }),
  };

  return { db, store };
}

describe("account entitlements", () => {
  it("builds subscription usage from live devices and batches when stored counters are stale", async () => {
    const { db } = makeTestDb({
      accountEntitlements: [[
        "user-1",
        {
          activeDeviceCount: 0,
          storedBatchCount: 0,
          storedPrivateBatchCount: 0,
        },
      ]],
      devices: [
        ["device-1", { ownerUserIds: ["user-1"], status: "ACTIVE", registryStatus: "active" }],
        ["device-2", { ownerUserIds: ["user-1"], status: "ACTIVE", registryStatus: "active" }],
        ["device-3", { ownerUserIds: ["user-1"], status: "SUSPENDED", registryStatus: "suspended" }],
      ],
      batches: [
        ["batch-1", { ownerUserIds: ["user-1"], visibility: "public" }],
        ["batch-2", { ownerUserIds: ["user-1"], visibility: "private" }],
      ],
    });

    const summary = await getSubscriptionSummary("user-1", db as never);

    expect(summary.usage).toMatchObject({
      activeDevices: 2,
      storedBatchesTotal: 2,
      storedPrivateBatches: 1,
    });
  });

  it("rejects uploads when actual stored batches already hit the plan limit", async () => {
    const batches: Array<[string, StoredDoc]> = Array.from({ length: 100 }, (_, index) => [
      `batch-${index + 1}`,
      { ownerUserIds: ["user-1"], visibility: "public" },
    ]);
    const { db } = makeTestDb({
      accountEntitlements: [[
        "user-1",
        {
          storedBatchCount: 0,
          storedPrivateBatchCount: 0,
          currentUsageMonth: "2026-05",
          currentMonthPointsUploaded: 0,
        },
      ]],
      batches,
    });

    await expect(reserveUploadQuota({
      userId: "user-1",
      visibility: "public",
      pointCount: 1,
      targetDb: db as never,
      now: new Date("2026-05-13T00:00:00.000Z"),
    })).rejects.toMatchObject({
      statusCode: 403,
      code: "quota_exceeded",
      message: "Stored batch limit reached for the current plan.",
    });
  });

  it("rejects device registration when actual active devices already hit the plan limit", async () => {
    const { db, store } = makeTestDb({
      accountEntitlements: [[
        "user-1",
        {
          activeDeviceCount: 0,
          currentUsageMonth: "2026-05",
          currentMonthPointsUploaded: 0,
        },
      ]],
      devices: [
        ["device-1", { ownerUserIds: ["user-1"], status: "ACTIVE", registryStatus: "active" }],
        ["device-2", { ownerUserIds: ["user-1"], status: "ACTIVE", registryStatus: "active" }],
      ],
    });

    await expect(writeDeviceWithQuota({
      userId: "user-1",
      deviceRef: db.collection("devices").doc("device-3") as never,
      deviceData: {
        ownerUserIds: ["user-1"],
        status: "ACTIVE",
        registryStatus: "active",
      },
      targetDb: db as never,
      now: new Date("2026-05-13T00:00:00.000Z"),
    })).rejects.toMatchObject({
      statusCode: 403,
      code: "quota_exceeded",
      message: "Active device limit reached for the current plan.",
    });
    expect(store.devices.has("device-3")).toBe(false);
  });
});
