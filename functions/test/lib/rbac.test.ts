import { describe, expect, it } from "vitest";
import { hasPermission, rolesFromClaims, rolesFromToken } from "../../src/lib/rbac.js";

describe("rbac", () => {
  it("returns only supported roles from claims", () => {
    const roles = rolesFromClaims({ roles: ["moderator", "super_admin", "ignored"] });
    expect(roles.sort()).toEqual(["moderator", "super_admin"]);
  });

  it("reads exact roles from the decoded token", () => {
    const roles = rolesFromToken({ uid: "user-1", roles: ["super_admin"] } as never);
    expect(roles).toEqual(["super_admin"]);
  });

  it("grants moderator permissions without users.manage", () => {
    const user = { uid: "mod-1", roles: ["moderator"] } as never;
    expect(hasPermission(user, "submissions.read_all")).toBe(true);
    expect(hasPermission(user, "submissions.moderate")).toBe(true);
    expect(hasPermission(user, "devices.moderate")).toBe(true);
    expect(hasPermission(user, "users.manage")).toBe(false);
  });
});
