export const VALID_ROLES = ["super_admin", "moderator"];
const VALID_ROLE_SET = new Set(VALID_ROLES);

export function parseRoles(input) {
  const values = (input || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const unique = Array.from(new Set(values));
  const invalid = unique.filter((role) => !VALID_ROLE_SET.has(role));
  if (invalid.length) {
    throw new Error(`Invalid role(s): ${invalid.join(", ")}. Allowed: super_admin, moderator`);
  }

  return unique;
}

export function applyAdminRoleClaims(existingClaims, roles) {
  const claims = { ...(existingClaims ?? {}) };
  delete claims.roles;
  delete claims.admin;

  if (roles.length) {
    claims.roles = roles;
  }

  return Object.keys(claims).length ? claims : null;
}
