import type { DecodedIdToken } from "firebase-admin/auth";
import { readAdminRolesFromClaims, type AdminRole } from "@crowdpm/types";

export type { AdminRole };

export type Permission =
  | "users.manage"
  | "submissions.read_all"
  | "submissions.moderate"
  | "devices.moderate";

const MODERATOR_PERMISSIONS: Permission[] = [
  "submissions.read_all",
  "submissions.moderate",
  "devices.moderate",
];

export function rolesFromToken(user: DecodedIdToken): AdminRole[] {
  return rolesFromClaims(user as unknown as Record<string, unknown>);
}

export function rolesFromClaims(claims: Record<string, unknown> | undefined): AdminRole[] {
  return readAdminRolesFromClaims(claims);
}

export function hasRole(user: DecodedIdToken, role: AdminRole): boolean {
  return rolesFromToken(user).includes(role);
}

export function hasPermission(user: DecodedIdToken, permission: Permission): boolean {
  const roles = rolesFromToken(user);
  if (roles.includes("super_admin")) return true;

  if (roles.includes("moderator")) return MODERATOR_PERMISSIONS.includes(permission);

  return false;
}
