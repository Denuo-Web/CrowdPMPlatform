import { describe, expect, it } from "vitest";
import { hasPermission, rolesFromClaims, rolesFromToken } from "../../src/lib/rbac.js";

describe("rbac", () => {
  it("maps legacy admin boolean to super_admin", () => {
    const roles = rolesFromToken({ uid: "user-1", admin: true } as never);
    expect(roles).toEqual(["super_admin"]);
  });

  it("normalizes roles claim values", () => {
    const roles = rolesFromClaims({ roles: ["moderator", "admin", "ignored"] });
    expect(roles.sort()).toEqual(["moderator", "super_admin"]);
  });

  it("grants moderator permissions without users.manage", () => {
    const user = { uid: "mod-1", roles: ["moderator"] } as never;
    expect(hasPermission(user, "submissions.read_all")).toBe(true);
    expect(hasPermission(user, "submissions.moderate")).toBe(true);
    expect(hasPermission(user, "devices.moderate")).toBe(true);
    expect(hasPermission(user, "users.manage")).toBe(false);
  });
});
