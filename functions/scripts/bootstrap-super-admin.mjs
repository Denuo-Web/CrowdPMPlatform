#!/usr/bin/env node
import admin from "firebase-admin";
import { applyAdminRoleClaims } from "./lib/adminClaims.mjs";

function parseArg(name) {
  const args = process.argv.slice(2);
  const direct = args.find((entry) => entry.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function usage() {
  console.log("Usage:");
  console.log("  node functions/scripts/bootstrap-super-admin.mjs --email admin@example.com");
  console.log("  node functions/scripts/bootstrap-super-admin.mjs --email admin@example.com --password '<initial-password>'");
  console.log("");
  console.log("Environment fallback: FIRST_SUPER_ADMIN_EMAIL, FIRST_SUPER_ADMIN_PASSWORD, FIRST_SUPER_ADMIN_DISPLAY_NAME.");
}

function isUserNotFound(error) {
  const code = error?.code;
  return code === "auth/user-not-found" || String(error?.message || "").includes("auth/user-not-found");
}

async function run() {
  const email = (parseArg("email") || process.env.FIRST_SUPER_ADMIN_EMAIL || "").trim();
  const password = parseArg("password") || process.env.FIRST_SUPER_ADMIN_PASSWORD || "";
  const displayName = (parseArg("display-name") || process.env.FIRST_SUPER_ADMIN_DISPLAY_NAME || "CrowdPM Admin").trim();

  if (!email) {
    usage();
    throw new Error("Provide --email or FIRST_SUPER_ADMIN_EMAIL");
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || undefined,
    });
  }

  const auth = admin.auth();
  let userRecord;
  let created = false;

  try {
    userRecord = await auth.getUserByEmail(email);
  }
  catch (error) {
    if (!isUserNotFound(error)) {
      throw error;
    }
    if (!password) {
      throw new Error(`No Firebase Auth user exists for ${email}. Provide FIRST_SUPER_ADMIN_PASSWORD once to create it, or create the user before running this script.`);
    }
    userRecord = await auth.createUser({
      email,
      password,
      emailVerified: true,
      displayName: displayName || undefined,
      disabled: false,
    });
    created = true;
  }

  const claims = applyAdminRoleClaims(userRecord.customClaims, ["super_admin"]);
  await auth.setCustomUserClaims(userRecord.uid, claims);

  console.log(JSON.stringify({
    uid: userRecord.uid,
    email: userRecord.email ?? email,
    roles: ["super_admin"],
    created,
  }, null, 2));
}

run().catch((err) => {
  console.error("[bootstrap-super-admin] failed", err.message || err);
  process.exitCode = 1;
});
