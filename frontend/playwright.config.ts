import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_API_BASE: "/api",
      VITE_E2E_AUTH_ENABLED: "true",
      VITE_E2E_MAP_STUB: "true",
      VITE_GOOGLE_MAPS_API_KEY: "e2e-google-maps-key",
      VITE_GOOGLE_MAP_ID: "e2e-map-id",
      VITE_FIREBASE_API_KEY: "e2e-firebase-api-key",
      VITE_FIREBASE_AUTH_DOMAIN: "crowdpm-local.firebaseapp.com",
      VITE_FIREBASE_PROJECT_ID: "crowdpm-local",
      VITE_FIREBASE_STORAGE_BUCKET: "crowdpm-local.appspot.com",
      VITE_FIREBASE_MESSAGING_SENDER_ID: "123456789",
      VITE_FIREBASE_APP_ID: "1:123456789:web:e2e",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
