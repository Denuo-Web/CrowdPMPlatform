#!/usr/bin/env node
import admin from "firebase-admin";
import { applyAdminRoleClaims, parseRoles } from "./lib/adminClaims.mjs";

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
  console.log("  node functions/scripts/grant-role.mjs --email user@example.com --roles super_admin");
  console.log("  node functions/scripts/grant-role.mjs --uid <firebase-uid> --roles moderator");
}

async function run() {
  const uid = parseArg("uid");
  const email = parseArg("email");
  const rolesInput = parseArg("roles");

  if (!uid && !email) {
    usage();
    throw new Error("Provide --uid or --email");
  }
  if (!rolesInput) {
    usage();
    throw new Error("Provide --roles (comma-separated)");
  }

  const roles = parseRoles(rolesInput);

  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const auth = admin.auth();
  const userRecord = uid
    ? await auth.getUser(uid)
    : await auth.getUserByEmail(email);

  const claims = applyAdminRoleClaims(userRecord.customClaims, roles);

  await auth.setCustomUserClaims(userRecord.uid, claims);

  console.log(JSON.stringify({
    uid: userRecord.uid,
    email: userRecord.email ?? null,
    roles,
  }, null, 2));
}

run().catch((err) => {
  console.error("[grant-role] failed", err.message || err);
  process.exitCode = 1;
});
