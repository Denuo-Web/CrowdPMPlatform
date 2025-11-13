import { app } from "./fire.js";

function isEmulatorRuntime() {
  return process.env.FUNCTIONS_EMULATOR === "true" || Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

const DEFAULT_EMAIL = process.env.DEV_AUTH_USER_EMAIL?.trim() || "smoke-tester@crowdpm.dev";
const DEFAULT_PASSWORD = process.env.DEV_AUTH_USER_PASSWORD || "crowdpm-dev";
const DEFAULT_DISPLAY_NAME = process.env.DEV_AUTH_USER_DISPLAY_NAME?.trim() || "CrowdPM Smoke Tester";

export async function ensureDevAuthUser() {
  if (!isEmulatorRuntime()) return;

  const auth = app().auth();
  try {
    await auth.getUserByEmail(DEFAULT_EMAIL);
    console.debug(`[dev-bootstrap] Emulator user ${DEFAULT_EMAIL} already exists; skipping creation.`);
    return;
  }
  catch (error) {
    const code = (error as { code?: string })?.code;
    if (code && code !== "auth/user-not-found") {
      console.error("[dev-bootstrap] Failed to verify default emulator user.", error);
      return;
    }
    if (!code && (error as Error).message && !(error as Error).message.includes("auth/user-not-found")) {
      console.error("[dev-bootstrap] Failed to verify default emulator user.", error);
      return;
    }
  }

  try {
    await auth.createUser({
      email: DEFAULT_EMAIL,
      password: DEFAULT_PASSWORD,
      emailVerified: true,
      displayName: DEFAULT_DISPLAY_NAME || undefined,
      disabled: false,
    });
    console.info(`[dev-bootstrap] Created default emulator user ${DEFAULT_EMAIL}.`);
  }
  catch (error) {
    console.error("[dev-bootstrap] Failed to create default emulator user.", error);
  }
}
