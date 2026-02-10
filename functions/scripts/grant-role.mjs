#!/usr/bin/env node
import admin from "firebase-admin";

const VALID_ROLES = new Set(["super_admin", "moderator"]);

function parseArg(name) {
  const args = process.argv.slice(2);
  const direct = args.find((entry) => entry.startsWith(`--${name}=`));
  if (direct) return direct.slice(name.length + 3);
  const index = args.indexOf(`--${name}`);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function parseRoles(input) {
  const values = (input || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const unique = Array.from(new Set(values));
  const invalid = unique.filter((role) => !VALID_ROLES.has(role));
  if (invalid.length) {
    throw new Error(`Invalid role(s): ${invalid.join(", ")}. Allowed: super_admin, moderator`);
  }

  return unique;
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

  const claims = { ...(userRecord.customClaims ?? {}) };
  delete claims.roles;
  delete claims.admin;

  if (roles.length) {
    claims.roles = roles;
  }
  if (roles.includes("super_admin")) {
    claims.admin = true;
  }

  await auth.setCustomUserClaims(userRecord.uid, Object.keys(claims).length ? claims : null);

  console.log(JSON.stringify({
    uid: userRecord.uid,
    email: userRecord.email ?? null,
    roles,
    admin: roles.includes("super_admin"),
  }, null, 2));
}

run().catch((err) => {
  console.error("[grant-role] failed", err.message || err);
  process.exitCode = 1;
});
