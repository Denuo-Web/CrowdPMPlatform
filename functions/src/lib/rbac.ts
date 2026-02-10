import type { DecodedIdToken } from "firebase-admin/auth";
import type { AdminRole } from "@crowdpm/types";

export type { AdminRole };

export type Permission =
  | "users.manage"
  | "submissions.read_all"
  | "submissions.moderate"
  | "devices.moderate";

function normalizeRole(value: unknown): AdminRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["super_admin", "super-admin", "superadmin", "admin"].includes(normalized)) {
    return "super_admin";
  }
  if (["moderator", "mod"].includes(normalized)) {
    return "moderator";
  }
  return null;
}

export function rolesFromToken(user: DecodedIdToken): AdminRole[] {
  return rolesFromClaims(user as unknown as Record<string, unknown>);
}

export function rolesFromClaims(claims: Record<string, unknown> | undefined): AdminRole[] {
  const out = new Set<AdminRole>();
  const rawRoles = claims?.roles;
  if (Array.isArray(rawRoles)) {
    rawRoles.forEach((entry) => {
      const normalized = normalizeRole(entry);
      if (normalized) out.add(normalized);
    });
  }
  if (claims?.admin === true) {
    out.add("super_admin");
  }
  return Array.from(out);
}

export function hasRole(user: DecodedIdToken, role: AdminRole): boolean {
  return rolesFromToken(user).includes(role);
}

export function hasPermission(user: DecodedIdToken, permission: Permission): boolean {
  const roles = rolesFromToken(user);
  if (roles.includes("super_admin")) return true;

  if (roles.includes("moderator")) {
    return ["submissions.read_all", "submissions.moderate", "devices.moderate"].includes(permission);
  }

  return false;
}
