import type { Page, Route } from "@playwright/test";
import type { AdminRole } from "@crowdpm/types";

const E2E_AUTH_STORAGE_KEY = "crowdpm:e2eAuth";

export async function signInAsE2eUser(
  page: Page,
  options: { uid?: string; email?: string; roles?: AdminRole[] } = {},
) {
  const state = {
    uid: options.uid ?? "e2e-user",
    email: options.email ?? "e2e@example.com",
    roles: options.roles ?? [],
  };
  await page.addInitScript(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: E2E_AUTH_STORAGE_KEY, value: state });
  await page.evaluate(({ key, value }) => {
    window.localStorage.setItem(key, JSON.stringify(value));
  }, { key: E2E_AUTH_STORAGE_KEY, value: state }).catch(() => {});
}

const nowIso = "2026-05-19T06:00:00.000Z";

const subscription = {
  planId: "free_community",
  label: "Free / Community",
  source: "free",
  status: "active",
  billingInterval: null,
  canManageBilling: false,
  cancelAtPeriodEnd: false,
  currentPeriodEnd: null,
  videoDownloadAccess: "preview_watermarked",
  limits: {
    maxActiveDevices: 2,
    maxStoredBatchesTotal: 100,
    maxStoredPrivateBatches: 0,
    monthlyPoints: 100_000,
    maxPointsPerBatch: 5_000,
  },
  usage: {
    activeDevices: 1,
    storedBatchesTotal: 1,
    storedPrivateBatches: 0,
    monthlyPointsUsed: 120,
    monthlyPointsRemaining: 99_880,
    monthKey: "2026-05",
    resetAt: "2026-06-01T00:00:00.000Z",
  },
};

const userSettings = {
  defaultBatchVisibility: "public",
  interleavedRendering: false,
  theme: {
    appearance: "dark",
    accentColor: "iris",
    grayColor: "auto",
    panelBackground: "translucent",
    radius: "full",
    scaling: "100%",
  },
  themeSaveUnlocked: false,
  subscription,
  subscriptionOffers: [
    {
      offerId: "pro_monthly",
      planId: "pro",
      label: "Pro Monthly",
      description: "Higher device and export limits.",
      currency: "usd",
      unitAmount: 900,
      billingInterval: "month",
      action: "checkout",
      contactEmail: null,
    },
  ],
};

const devices = [
  {
    id: "device-e2e-1",
    name: "E2E Mobile Node",
    status: "active",
    registryStatus: "active",
    createdAt: nowIso,
    lastSeenAt: nowIso,
    fingerprint: "fp-e2e",
  },
];

const batches = [
  {
    batchId: "batch-e2e-1",
    deviceId: "device-e2e-1",
    deviceName: "E2E Mobile Node",
    count: 2,
    processedAt: nowIso,
    visibility: "public",
    moderationState: "approved",
  },
];

const batchDetail = {
  ...batches[0],
  points: [
    {
      device_id: "device-e2e-1",
      pollutant: "pm25",
      value: 12.4,
      unit: "ug/m3",
      lat: 44.56,
      lon: -123.26,
      timestamp: nowIso,
      precision: 8,
    },
    {
      device_id: "device-e2e-1",
      pollutant: "pm25",
      value: 14.1,
      unit: "ug/m3",
      lat: 44.561,
      lon: -123.261,
      timestamp: "2026-05-19T06:01:00.000Z",
      precision: 9,
    },
  ],
};

const adminUsers = {
  users: [
    {
      uid: "admin-e2e",
      email: "admin.e2e@example.com",
      disabled: false,
      roles: ["super_admin"],
      createdAt: nowIso,
      lastSignInAt: nowIso,
    },
  ],
  nextPageToken: null,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

export async function mockCrowdPmApi(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();

    if (method === "GET" && path === "/v1/user/settings") return json(route, userSettings);
    if (method === "PUT" && path === "/v1/user/settings") return json(route, userSettings);
    if (method === "GET" && path === "/v1/devices") return json(route, devices);
    if (method === "GET" && path === "/v1/batches") return json(route, batches);
    if (method === "GET" && path === "/v1/node-purchase/receipts") return json(route, []);
    if (method === "GET" && path === "/v1/public/batches") return json(route, batches);
    if (method === "GET" && path === "/v1/public/batches/map") return json(route, { batches: [batchDetail] });
    if (method === "GET" && path === "/v1/public/demo-batch") return json(route, batches[0]);
    if (method === "GET" && path === "/v1/public/batches/device-e2e-1/batch-e2e-1") return json(route, batchDetail);
    if (method === "GET" && path === "/v1/batches/device-e2e-1/batch-e2e-1") return json(route, batchDetail);
    if (method === "GET" && path === "/v1/admin/submissions") return json(route, { submissions: batches });
    if (method === "GET" && path === "/v1/admin/users") return json(route, adminUsers);
    if (method === "GET" && path === "/v1/admin/demo-batch") return json(route, { deviceId: "device-e2e-1", batchId: "batch-e2e-1", summary: batches[0] });
    if (method === "POST" && path === "/v1/node-purchase/checkout-session") {
      return json(route, {
        sessionId: "cs_e2e_node",
        url: `${url.origin}/node?checkout=success`,
      });
    }

    return json(route, { error: `Unhandled E2E route: ${method} ${path}` }, 500);
  });
}
