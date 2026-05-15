import type { AdminRole } from "@crowdpm/types";

export function isAdminRole(value: unknown): value is AdminRole {
  return value === "super_admin" || value === "moderator";
}

export function normalizeAdminRoles(value: unknown): AdminRole[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const out = new Set<AdminRole>();
  value.forEach((entry) => {
    if (isAdminRole(entry)) {
      out.add(entry);
    }
  });
  return Array.from(out);
}

export function readAdminRolesFromClaims(claims: { roles?: unknown } | undefined): AdminRole[] {
  return normalizeAdminRoles(claims?.roles);
}
