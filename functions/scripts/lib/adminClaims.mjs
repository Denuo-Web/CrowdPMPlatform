export const VALID_ROLES = new Set(["super_admin", "moderator"]);

export function parseRoles(input) {
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

export function applyAdminRoleClaims(existingClaims, roles) {
  const claims = { ...(existingClaims ?? {}) };
  delete claims.roles;
  delete claims.admin;

  if (roles.length) {
    claims.roles = roles;
  }
  if (roles.includes("super_admin")) {
    claims.admin = true;
  }

  return Object.keys(claims).length ? claims : null;
}
