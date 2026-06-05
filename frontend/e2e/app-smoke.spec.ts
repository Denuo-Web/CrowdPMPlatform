import { expect, test } from "@playwright/test";
import { mockCrowdPmApi, signInAsE2eUser } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockCrowdPmApi(page);
});

test("guest can use public routes and protected routes stay gated", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Hyper-local PM2\.5 mapping/i })).toBeVisible();

  await page.getByRole("button", { name: "Explore live map" }).click();
  await expect(page).toHaveURL(/\/map$/);
  await expect(page.getByText("Measurement batch")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Measurement batch" })).toContainText("E2E Mobile Node");
  await expect(page.getByRole("button", { name: "See Demo Data" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pair a node" })).toHaveCount(0);

  await page.goto("/about");
  await expect(page.getByRole("heading", { name: /About/i })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Hyper-local PM2\.5 mapping/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "User Dashboard" })).toHaveCount(0);
});

test("signed-in user can reach dashboard data and sign out", async ({ page }) => {
  await signInAsE2eUser(page, { email: "user.e2e@example.com" });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome back, user.e2e@example.com" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Registered devices" })).toBeVisible();
  await expect(page.getByText("device-e2e-1").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Batch uploads" })).toBeVisible();
  await expect(page.getByText("batch-e2e-1").first()).toBeVisible();

  await page.getByRole("button", { name: "Navigation menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
});

test("admin route is role-gated and renders admin workflows for super admins", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /Hyper-local PM2\.5 mapping/i })).toBeVisible();

  const adminPage = page.context().pages()[0];
  await signInAsE2eUser(adminPage, {
    email: "admin.e2e@example.com",
    roles: ["super_admin"],
  });

  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("heading", { name: "Front Page Demo Data" })).toBeVisible();
  await expect(adminPage.getByRole("heading", { name: "Submission moderation" })).toBeVisible();
  await expect(adminPage.getByRole("heading", { name: "User moderation" })).toBeVisible();
  await expect(adminPage.getByText("admin.e2e@example.com")).toBeVisible();
});

test("node waitlist flow records a non-binding pledge", async ({ page }) => {
  await page.goto("/node");
  await expect(page.getByRole("heading", { name: "Join the CrowdPM node waitlist before paid reservations open." })).toBeVisible();

  await expect(page.getByRole("button", { name: "Paid Reservations Paused" })).toBeDisabled();
  await page.getByPlaceholder("Name").fill("Expo Visitor");
  await page.getByPlaceholder("Email").fill("visitor@example.com");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Join Reservation Waitlist" }).click();
  await expect(page.getByText("You are on the reservation waitlist.")).toBeVisible();
});
