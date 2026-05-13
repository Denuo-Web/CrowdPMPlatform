import type {
  UserSettings,
  UserThemeAccentColor,
  UserThemeAppearance,
  UserThemeGrayColor,
  UserThemePanelBackground,
  UserThemeRadius,
  UserThemeScaling,
  UserThemeSettings,
} from "@crowdpm/types";
import type { FastifyPluginAsync } from "fastify";
import { db } from "../lib/fire.js";
import type { BatchVisibility } from "../lib/batchVisibility.js";
import { normalizeVisibility } from "../lib/httpValidation.js";
import { httpError } from "../lib/httpError.js";
import { rateLimitGuard, requireUserGuard, requestUserId } from "../lib/routeGuards.js";
import {
  defaultBatchVisibilityForSubscription,
  getSubscriptionSummary,
  listSubscriptionOffers,
} from "../services/accountEntitlements.js";

const DEFAULT_INTERLEAVED_RENDERING = false;
const DEFAULT_THEME_SAVE_UNLOCKED = false;
const DEFAULT_THEME_SETTINGS: UserThemeSettings = {
  appearance: "dark",
  accentColor: "iris",
  grayColor: "auto",
  panelBackground: "translucent",
  radius: "full",
  scaling: "100%",
};

const THEME_APPEARANCES = ["light", "dark"] as const satisfies readonly UserThemeAppearance[];
const THEME_ACCENT_COLORS = [
  "gray",
  "gold",
  "bronze",
  "brown",
  "yellow",
  "amber",
  "orange",
  "tomato",
  "red",
  "ruby",
  "crimson",
  "pink",
  "plum",
  "purple",
  "violet",
  "iris",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "jade",
  "green",
  "grass",
  "lime",
  "mint",
  "sky",
] as const satisfies readonly UserThemeAccentColor[];
const THEME_GRAY_COLORS = ["auto", "gray", "mauve", "slate", "sage", "olive", "sand"] as const satisfies readonly UserThemeGrayColor[];
const THEME_PANEL_BACKGROUNDS = ["solid", "translucent"] as const satisfies readonly UserThemePanelBackground[];
const THEME_RADII = ["none", "small", "medium", "large", "full"] as const satisfies readonly UserThemeRadius[];
const THEME_SCALINGS = ["90%", "95%", "100%", "105%", "110%"] as const satisfies readonly UserThemeScaling[];

function normalizeInterleavedRendering(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }
  return null;
}

function normalizeStringUnion<T extends string>(value: unknown, values: readonly T[]): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? value as T : null;
}

function normalizeThemeSaveUnlocked(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function normalizeThemeSettings(value: unknown, base: UserThemeSettings = DEFAULT_THEME_SETTINGS): UserThemeSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;

  const appearance = "appearance" in input
    ? normalizeStringUnion(input.appearance, THEME_APPEARANCES)
    : base.appearance;
  const accentColor = "accentColor" in input
    ? normalizeStringUnion(input.accentColor, THEME_ACCENT_COLORS)
    : base.accentColor;
  const grayColor = "grayColor" in input
    ? normalizeStringUnion(input.grayColor, THEME_GRAY_COLORS)
    : base.grayColor;
  const panelBackground = "panelBackground" in input
    ? normalizeStringUnion(input.panelBackground, THEME_PANEL_BACKGROUNDS)
    : base.panelBackground;
  const radius = "radius" in input
    ? normalizeStringUnion(input.radius, THEME_RADII)
    : base.radius;
  const scaling = "scaling" in input
    ? normalizeStringUnion(input.scaling, THEME_SCALINGS)
    : base.scaling;

  if (!appearance || !accentColor || !grayColor || !panelBackground || !radius || !scaling) return null;
  return { appearance, accentColor, grayColor, panelBackground, radius, scaling };
}

function readThemeSettings(value: unknown): UserThemeSettings {
  return normalizeThemeSettings(value, DEFAULT_THEME_SETTINGS) ?? DEFAULT_THEME_SETTINGS;
}

function readThemeSaveUnlocked(value: unknown): boolean {
  return normalizeThemeSaveUnlocked(value) ?? DEFAULT_THEME_SAVE_UNLOCKED;
}

type UserSettingsResponse = UserSettings;

type UserSettingsBody = {
  defaultBatchVisibility?: unknown;
  interleavedRendering?: unknown;
  theme?: unknown;
};

export const userSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/v1/user/settings", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `user-settings:get:${requestUserId(req)}`, 60, 60_000),
      rateLimitGuard("user-settings:get:global", 2_000, 60_000),
    ],
  }, async (req) => {
    const userId = requestUserId(req);
    const [snap, subscription] = await Promise.all([
      db().collection("userSettings").doc(userId).get(),
      getSubscriptionSummary(userId, db()),
    ]);
    const requestedVisibility = normalizeVisibility(snap.get("defaultBatchVisibility"), null);
    const visibility = requestedVisibility === "private" && subscription.limits.maxStoredPrivateBatches < 1
      ? "public"
      : (requestedVisibility ?? defaultBatchVisibilityForSubscription(subscription));
    const interleavedRendering = snap.exists
      ? normalizeInterleavedRendering(snap.get("interleavedRendering")) ?? DEFAULT_INTERLEAVED_RENDERING
      : DEFAULT_INTERLEAVED_RENDERING;
    const theme = snap.exists ? readThemeSettings(snap.get("theme")) : DEFAULT_THEME_SETTINGS;
    const themeSaveUnlocked = snap.exists ? readThemeSaveUnlocked(snap.get("themeSaveUnlocked")) : DEFAULT_THEME_SAVE_UNLOCKED;
    return {
      defaultBatchVisibility: visibility,
      interleavedRendering,
      theme,
      themeSaveUnlocked,
      subscription,
      subscriptionOffers: listSubscriptionOffers(),
    } satisfies UserSettingsResponse;
  });

  app.put<{ Body: UserSettingsBody }>("/v1/user/settings", {
    preHandler: [
      requireUserGuard(),
      rateLimitGuard((req) => `user-settings:update:${requestUserId(req)}`, 30, 60_000),
      rateLimitGuard("user-settings:update:global", 1_000, 60_000),
    ],
  }, async (req) => {
    const userId = requestUserId(req);
    const subscription = await getSubscriptionSummary(userId, db());
    const hasVisibility = "defaultBatchVisibility" in (req.body ?? {});
    const hasInterleaved = "interleavedRendering" in (req.body ?? {});
    const hasTheme = "theme" in (req.body ?? {});

    if (!hasVisibility && !hasInterleaved && !hasTheme) {
      throw httpError(400, "missing_fields", "Provide defaultBatchVisibility, interleavedRendering, or theme to update.");
    }

    let visibility: BatchVisibility | null = null;
    if (hasVisibility) {
      visibility = normalizeVisibility(req.body?.defaultBatchVisibility, null);
      if (!visibility) {
        throw httpError(400, "invalid_visibility", "defaultBatchVisibility must be 'public' or 'private'.");
      }
      if (visibility === "private" && subscription.limits.maxStoredPrivateBatches < 1) {
        throw httpError(403, "quota_exceeded", "Private batches require a paid subscription.", {
          planId: subscription.planId,
          limits: subscription.limits,
          usage: subscription.usage,
        });
      }
    }

    let interleavedRendering: boolean | null = null;
    if (hasInterleaved) {
      interleavedRendering = normalizeInterleavedRendering(req.body?.interleavedRendering);
      if (interleavedRendering === null) {
        throw httpError(400, "invalid_interleaved", "interleavedRendering must be boolean.");
      }
    }

    const docRef = db().collection("userSettings").doc(userId);
    let theme: UserThemeSettings | null = null;
    if (hasTheme) {
      const existingSnap = await docRef.get();
      const themeSaveUnlocked = readThemeSaveUnlocked(existingSnap.get("themeSaveUnlocked"));
      if (!themeSaveUnlocked) {
        throw httpError(403, "theme_save_locked", "Purchase the theme save unlock to persist theme preferences.");
      }
      theme = normalizeThemeSettings(req.body?.theme, readThemeSettings(existingSnap.get("theme")));
      if (!theme) {
        throw httpError(400, "invalid_theme", "theme contains an unsupported value.");
      }
    }

    const payload: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (visibility) payload.defaultBatchVisibility = visibility;
    if (interleavedRendering !== null) payload.interleavedRendering = interleavedRendering;
    if (theme) payload.theme = theme;
    await docRef.set(payload, { merge: true });

    const snap = await docRef.get();
    const nextVisibility = normalizeVisibility(snap.get("defaultBatchVisibility"));
    const nextInterleaved = normalizeInterleavedRendering(snap.get("interleavedRendering")) ?? DEFAULT_INTERLEAVED_RENDERING;
    const nextTheme = readThemeSettings(snap.get("theme"));
    const nextThemeSaveUnlocked = readThemeSaveUnlocked(snap.get("themeSaveUnlocked"));
    const nextSubscription = await getSubscriptionSummary(userId, db());
    return {
      defaultBatchVisibility: nextVisibility === "private" && nextSubscription.limits.maxStoredPrivateBatches < 1
        ? "public"
        : (nextVisibility ?? defaultBatchVisibilityForSubscription(nextSubscription)),
      interleavedRendering: nextInterleaved,
      theme: nextTheme,
      themeSaveUnlocked: nextThemeSaveUnlocked,
      subscription: nextSubscription,
      subscriptionOffers: listSubscriptionOffers(),
    } satisfies UserSettingsResponse;
  });
};
