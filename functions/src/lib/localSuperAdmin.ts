import { app } from "./fire.js";

function isEmulatorRuntime() {
  return process.env.FUNCTIONS_EMULATOR === "true" || Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
}

const DEFAULT_EMAIL = process.env.FIRST_SUPER_ADMIN_EMAIL?.trim() || "admin@crowdpm.dev";
const DEFAULT_PASSWORD = process.env.FIRST_SUPER_ADMIN_PASSWORD || "crowdpm-dev";
const DEFAULT_DISPLAY_NAME = process.env.FIRST_SUPER_ADMIN_DISPLAY_NAME?.trim() || "CrowdPM Admin";

function withSuperAdminClaims(claims: Record<string, unknown> | undefined): Record<string, unknown> {
  const next = { ...(claims ?? {}) };
  next.roles = ["super_admin"];
  delete next.admin;
  return next;
}

export async function ensureLocalSuperAdmin() {
  if (!isEmulatorRuntime()) return;

  const auth = app().auth();
  try {
    const existing = await auth.getUserByEmail(DEFAULT_EMAIL);
    await auth.setCustomUserClaims(existing.uid, withSuperAdminClaims(existing.customClaims));
    console.debug(`[local-admin-bootstrap] Emulator super admin ${DEFAULT_EMAIL} already exists; refreshed claims.`);
    return;
  }
  catch (error) {
    const code = (error as { code?: string })?.code;
    if (code && code !== "auth/user-not-found") {
      console.error("[local-admin-bootstrap] Failed to verify local super admin.", error);
      return;
    }
    if (!code && (error as Error).message && !(error as Error).message.includes("auth/user-not-found")) {
      console.error("[local-admin-bootstrap] Failed to verify local super admin.", error);
      return;
    }
  }

  try {
    const created = await auth.createUser({
      email: DEFAULT_EMAIL,
      password: DEFAULT_PASSWORD,
      emailVerified: true,
      displayName: DEFAULT_DISPLAY_NAME || undefined,
      disabled: false,
    });
    await auth.setCustomUserClaims(created.uid, withSuperAdminClaims(created.customClaims));
    console.info(`[local-admin-bootstrap] Created local super admin ${DEFAULT_EMAIL}.`);
  }
  catch (error) {
    console.error("[local-admin-bootstrap] Failed to create local super admin.", error);
  }
}
