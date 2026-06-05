import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useState } from "react";
import type { UserThemeSettings } from "@crowdpm/types";
import type { AuthMode } from "./components/AuthDialog";
import {
  APP_ROUTES,
  getAppTabFromPath,
  getDemoMapRoute,
  getRouteForAppTab,
  isActivationRoute,
  isDemoMapSearch,
  type RoutedAppTab,
} from "./lib/appRoutes";
import { logWarning } from "./lib/logger";
import { pushAppLocation, replaceAppLocation, replaceCurrentUrl, useBrowserLocation } from "./lib/locationStore";
import { useAuth } from "./providers/AuthProvider";
import { useUserSettings } from "./providers/UserSettingsProvider";
import { Theme } from "@radix-ui/themes";
import { ActivationModal } from "./components/ActivationModal";
import { AppMainContent, type SubscriptionCheckoutNotice } from "./components/AppMainContent";
import { AppNavigation } from "./components/AppNavigation";
import { TeamModal } from "./components/TeamModal";
import { ThemePreferencesModal, type ThemeCheckoutNotice } from "./components/ThemePreferencesModal";

const THEME_SHORTCUT_IGNORED_SELECTOR = [
  "[contenteditable]",
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  'input:not([type="radio"], [type="checkbox"])',
  "select",
  "textarea",
].join(",");

const AuthDialog = lazy(async () => {
  const module = await import("./components/AuthDialog");
  return { default: module.AuthDialog };
});

type AppTab = RoutedAppTab;

function readThemeCheckoutNotice(search: string): ThemeCheckoutNotice {
  const status = new URLSearchParams(search).get("themeCheckout");
  return status === "success" || status === "cancelled" ? status : null;
}

function clearThemeCheckoutNoticeFromUrl() {
  replaceCurrentUrl((nextUrl) => {
    nextUrl.searchParams.delete("themeCheckout");
    nextUrl.searchParams.delete("themeCheckoutSessionId");
  });
}

function readThemeCheckoutSessionId(search: string): string | null {
  const sessionId = new URLSearchParams(search).get("themeCheckoutSessionId");
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : null;
}

function readSubscriptionCheckoutNotice(search: string): SubscriptionCheckoutNotice {
  const status = new URLSearchParams(search).get("subscriptionCheckout");
  return status === "success" || status === "cancelled" ? status : null;
}

function readSubscriptionCheckoutSessionId(search: string): string | null {
  const sessionId = new URLSearchParams(search).get("subscriptionCheckoutSessionId");
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : null;
}

export default function App() {
  const { user, isLoading, signOut, canAccessAdmin } = useAuth();
  const { settings } = useUserSettings();
  const location = useBrowserLocation();
  const userScopedKey = user?.uid ?? "anon";
  const [requestedTab, setRequestedTab] = useState<AppTab>(() => getAppTabFromPath(location.pathname) ?? "home");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthDialogOpen, setAuthDialogOpen] = useState(false);
  const [isTeamModalOpen, setTeamModalOpen] = useState(false);
  const [isThemeModalRequested, setThemeModalRequested] = useState(false);
  const [themeDraft, setThemeDraft] = useState<UserThemeSettings | null>(null);
  const [dashboardRefreshToken, setDashboardRefreshToken] = useState(0);

  const themeCheckoutNotice = readThemeCheckoutNotice(location.search);
  const themeCheckoutSessionId = readThemeCheckoutSessionId(location.search);
  const subscriptionCheckoutNotice = readSubscriptionCheckoutNotice(location.search);
  const subscriptionCheckoutSessionId = readSubscriptionCheckoutSessionId(location.search);
  const routeTab = getAppTabFromPath(location.pathname);
  const isActivationModalOpen = isActivationRoute(location.pathname);
  const isSignedIn = Boolean(user);
  const tab = routeTab ?? requestedTab;
  const preferredTab = user && subscriptionCheckoutNotice ? "dashboard" : tab;
  const activeTab = !isSignedIn
    && preferredTab !== "home"
    && preferredTab !== "map"
    && preferredTab !== "pairing-info"
    && preferredTab !== "about"
    && preferredTab !== "node"
    && preferredTab !== "api-docs"
    ? "home"
    : (preferredTab === "admin" && !canAccessAdmin ? "home" : preferredTab);
  const isThemeModalOpen = isThemeModalRequested || Boolean(themeCheckoutNotice);
  const activeTheme = user ? themeDraft ?? settings.theme : settings.theme;
  const shouldLoadDemoBatch = activeTab === "map" && isDemoMapSearch(location.search);
  const isDarkTheme = activeTheme.appearance === "dark";
  const mapHeaderBackground = activeTab === "map"
    ? isDarkTheme
      ? "linear-gradient(180deg, color-mix(in srgb, var(--color-panel-solid) 96%, transparent) 0%, color-mix(in srgb, var(--color-panel-solid) 88%, transparent) 58%, color-mix(in srgb, var(--color-panel-solid) 60%, transparent) 100%)"
      : "linear-gradient(180deg, color-mix(in srgb, white 96%, transparent) 0%, color-mix(in srgb, white 88%, transparent) 58%, color-mix(in srgb, white 56%, transparent) 100%)"
    : "color-mix(in srgb, var(--color-panel-solid) 88%, transparent)";
  const mapHeaderForegroundColor = "var(--gray-12)";
  const airQualityNetworkColor = "var(--gray-11)";

  const openAuthDialog = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthDialogOpen(true);
  };

  const navigateToTab = useCallback((nextTab: AppTab) => {
    setRequestedTab(nextTab);
    const targetRoute = getRouteForAppTab(nextTab);
    if (location.pathname.toLowerCase() !== targetRoute.toLowerCase()) {
      pushAppLocation(targetRoute);
    }
  }, [location.pathname]);

  const openDemoMap = useCallback(() => {
    setRequestedTab("map");
    const targetRoute = getDemoMapRoute();
    if (`${location.pathname}${location.search}`.toLowerCase() !== targetRoute.toLowerCase()) {
      pushAppLocation(targetRoute);
    }
  }, [location.pathname, location.search]);

  const closeThemeModal = useCallback(() => {
    setThemeModalRequested(false);
    setThemeDraft(null);
    if (themeCheckoutNotice || themeCheckoutSessionId) {
      clearThemeCheckoutNoticeFromUrl();
    }
  }, [themeCheckoutNotice, themeCheckoutSessionId]);

  const handleThemeModalOpenChange = useCallback((next: boolean) => {
    if (next) {
      setThemeModalRequested(true);
      return;
    }
    closeThemeModal();
  }, [closeThemeModal]);

  const toggleThemeModal = useCallback(() => {
    if (isThemeModalOpen) {
      closeThemeModal();
      return;
    }
    setThemeModalRequested(true);
  }, [closeThemeModal, isThemeModalOpen]);

  const openThemeModal = useCallback(() => {
    setThemeModalRequested(true);
  }, []);

  const handleProtectedTabClick = (target: "dashboard" | "admin") => {
    if (user) {
      if (target === "admin" && !canAccessAdmin) return;
      navigateToTab(target);
      return;
    }
    openAuthDialog("login");
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setRequestedTab("home");
      setThemeDraft(null);
      setThemeModalRequested(false);
      replaceAppLocation(APP_ROUTES.home);
    }
    catch (err) {
      logWarning("Sign out failed", undefined, err);
    }
  };

  const handleThemeShortcut = useEffectEvent((event: KeyboardEvent) => {
    const isModifierActive = event.altKey || event.ctrlKey || event.shiftKey || event.metaKey;
    if (event.key?.toUpperCase() !== "T" || isModifierActive) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof Element && activeElement.closest(THEME_SHORTCUT_IGNORED_SELECTOR)) return;

    event.preventDefault();
    event.stopPropagation();
    toggleThemeModal();
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      handleThemeShortcut(event);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const openActivationModal = () => {
    if (!user) {
      openAuthDialog("login");
      return;
    }
    if (!isActivationModalOpen) {
      pushAppLocation(APP_ROUTES.activation);
    }
  };

  const handleActivationModalOpenChange = useCallback((next: boolean) => {
    if (next) {
      if (!user) {
        openAuthDialog("login");
        return;
      }
      if (!isActivationModalOpen) {
        pushAppLocation(APP_ROUTES.activation);
      }
      return;
    }

    if (isActivationModalOpen) {
      replaceAppLocation(getRouteForAppTab(requestedTab));
    }
  }, [isActivationModalOpen, requestedTab, user]);

  const handleActivationComplete = () => {
    setRequestedTab("dashboard");
    setDashboardRefreshToken((prev) => prev + 1);
    if (isActivationModalOpen) {
      replaceAppLocation(APP_ROUTES.dashboard);
    }
  };

  const handleSubscriptionCheckoutHandled = useCallback(() => {
    if (!subscriptionCheckoutNotice && !subscriptionCheckoutSessionId) {
      return;
    }
    setRequestedTab("dashboard");
    replaceAppLocation(APP_ROUTES.dashboard);
  }, [subscriptionCheckoutNotice, subscriptionCheckoutSessionId]);

  const handleDemoBatchRequestHandled = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname.toLowerCase() !== APP_ROUTES.map) return;
    if (!isDemoMapSearch(window.location.search)) return;
    replaceAppLocation(APP_ROUTES.map);
  }, []);

  return (
    <Theme
      appearance={activeTheme.appearance}
      accentColor={activeTheme.accentColor}
      grayColor={activeTheme.grayColor}
      radius={activeTheme.radius}
      panelBackground={activeTheme.panelBackground}
      scaling={activeTheme.scaling}
    >
      <ActivationModal
        open={isActivationModalOpen}
        onOpenChange={handleActivationModalOpenChange}
        onActivationComplete={handleActivationComplete}
      />
      <TeamModal open={isTeamModalOpen} onOpenChange={setTeamModalOpen} isSignedIn={isSignedIn} />
      <ThemePreferencesModal
        open={isThemeModalOpen}
        onOpenChange={handleThemeModalOpenChange}
        checkoutNotice={themeCheckoutNotice}
        checkoutSessionId={themeCheckoutSessionId}
        theme={activeTheme}
        onThemeChange={setThemeDraft}
        onThemeSaved={() => setThemeDraft(null)}
      />

      <AppNavigation
        activeTab={activeTab}
        isLoading={isLoading}
        isSignedIn={isSignedIn}
        canAccessAdmin={canAccessAdmin}
        mapHeaderBackground={mapHeaderBackground}
        mapHeaderForegroundColor={mapHeaderForegroundColor}
        airQualityNetworkColor={airQualityNetworkColor}
        onNavigate={navigateToTab}
        onProtectedTabClick={handleProtectedTabClick}
        onOpenAuth={openAuthDialog}
        onSignOut={() => { void handleSignOut(); }}
      />
      <AppMainContent
        activeTab={activeTab}
        isSignedIn={isSignedIn}
        canAccessAdmin={canAccessAdmin}
        userScopedKey={userScopedKey}
        mapAppearance={activeTheme.appearance}
        dashboardRefreshToken={dashboardRefreshToken}
        subscriptionCheckoutNotice={subscriptionCheckoutNotice}
        subscriptionCheckoutSessionId={subscriptionCheckoutSessionId}
        shouldLoadDemoBatch={shouldLoadDemoBatch}
        onNavigate={navigateToTab}
        onProtectedTabClick={handleProtectedTabClick}
        onExploreDemoMap={openDemoMap}
        onOpenActivation={openActivationModal}
        onOpenThemeModal={openThemeModal}
        onSubscriptionCheckoutHandled={handleSubscriptionCheckoutHandled}
        onDemoBatchRequestHandled={handleDemoBatchRequestHandled}
        onOpenTeamModal={() => setTeamModalOpen(true)}
        onOpenAuth={openAuthDialog}
      />
      <Suspense fallback={null}>
        {isAuthDialogOpen ? (
          <AuthDialog
            open={isAuthDialogOpen}
            mode={authMode}
            onModeChange={setAuthMode}
            onOpenChange={setAuthDialogOpen}
            onAuthenticated={() => navigateToTab(routeTab === "admin" ? "admin" : "dashboard")}
          />
        ) : null}
      </Suspense>
    </Theme>
  );
}
