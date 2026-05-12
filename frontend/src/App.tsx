import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { UserThemeSettings } from "@crowdpm/types";
import type { AuthMode } from "./components/AuthDialog";
import { ExternalAnchor, ExternalLink } from "./components/ExternalLink";
import { LegalDocumentDialog, LegalDocumentLink, type LegalDocumentId } from "./components/LegalDocumentDialog";
import { APP_ROUTES, getDeepLinkedAppTab, getRouteForDeepLinkedAppTab, isActivationRoute, isDeepLinkedAppRoute, type DeepLinkedAppTab } from "./lib/appRoutes";
import { PROJECT_LINKS, PROJECT_RESOURCE_LINKS } from "./lib/projectLinks";
import { logWarning } from "./lib/logger";
import { useAuth } from "./providers/AuthProvider";
import { useUserSettings } from "./providers/UserSettingsProvider";
import {
  confirmThemeSaveCheckoutSession,
  createThemeSaveCheckoutSession,
  type IngestSmokeTestCleanupResponse,
  type IngestSmokeTestResponse,
} from "./lib/api";
import {
  Theme,
  Box,
  Button,
  Callout,
  DropdownMenu,
  Flex,
  Heading,
  Text,
  Avatar,
  Separator,
  Link,
  IconButton,
  Dialog,
} from "@radix-ui/themes";
import { GitHubLogoIcon, HamburgerMenuIcon, LinkedInLogoIcon } from "@radix-ui/react-icons";

const TEAM_MEMBERS: Array<{
  name: string;
  role: string;
  email: string;
  github: string;
  linkedin: string;
}> = [
  {
    name: "Jaron Rosenau",
    role: "Team Lead",
    email: "rosenauj@oregonstate.edu",
    github: "https://github.com/denuoweb",
    linkedin: "https://www.linkedin.com/in/jaronrosenau/",
  },
  {
    name: "Jack Armstrong",
    role: "Team Manager",
    email: "armsjack@oregonstate.edu",
    github: "https://github.com/JackArmstrong22",
    linkedin: "https://www.linkedin.com/in/jack-t-armstrong/",
  },
  {
    name: "Skylar Soon",
    role: "Developer",
    email: "soonsk@oregonstate.edu",
    github: "https://github.com/skylarsoon",
    linkedin: "https://www.linkedin.com/in/skylar-soon/",
  },
  {
    name: "Mark Sparhawk",
    role: "Developer",
    email: "sparhawm@oregonstate.edu",
    github: "https://github.com/MarkSparhawk",
    linkedin: "https://www.linkedin.com/in/mark-sparhawk/",
  },
];

const THEME_SHORTCUT_IGNORED_SELECTOR = [
  "[contenteditable]",
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  'input:not([type="radio"], [type="checkbox"])',
  "select",
  "textarea",
].join(",");

const MapPage = lazy(() => import("./pages/MapPage"));
const UserDashboard = lazy(() => import("./pages/UserDashboard"));
const SmokeTestLab = lazy(() => import("./pages/SmokeTestLab"));
const AdminModerationPage = lazy(() => import("./pages/AdminModerationPage"));
const AuthDialog = lazy(async () => {
  const module = await import("./components/AuthDialog");
  return { default: module.AuthDialog };
});
const ActivationPage = lazy(async () => {
  const module = await import("./pages/ActivationPage");
  return { default: module.ActivationPage };
});
const PairingInfoPage = lazy(() => import("./pages/PairingInfoPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const NodePage = lazy(() => import("./pages/NodePage"));
const ThemeSettingsControls = lazy(async () => {
  const module = await import("./components/ThemeSettingsControls");
  return { default: module.ThemeSettingsControls };
});
const MAP_VIEWPORT_BOTTOM_INSET = "max(12px, env(safe-area-inset-bottom, 0px))";

type AppTab = "map" | "dashboard" | "smoke" | "admin" | DeepLinkedAppTab;
type ThemeCheckoutNotice = "success" | "cancelled" | null;

function isDeepLinkedTab(tab: AppTab): tab is DeepLinkedAppTab {
  return tab === "pairing-info" || tab === "about" || tab === "node";
}

function readThemeCheckoutNotice(): ThemeCheckoutNotice {
  if (typeof window === "undefined") return null;
  const status = new URLSearchParams(window.location.search).get("themeCheckout");
  return status === "success" || status === "cancelled" ? status : null;
}

function clearThemeCheckoutNoticeFromUrl() {
  if (typeof window === "undefined") return;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.delete("themeCheckout");
  nextUrl.searchParams.delete("themeCheckoutSessionId");
  window.history.replaceState({}, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

function readThemeCheckoutSessionId(): string | null {
  if (typeof window === "undefined") return null;
  const sessionId = new URLSearchParams(window.location.search).get("themeCheckoutSessionId");
  return typeof sessionId === "string" && sessionId.trim().length > 0 ? sessionId : null;
}

export default function App() {
  const { user, isLoading, signOut, isModerator, isSuperAdmin } = useAuth();
  const { settings } = useUserSettings();
  const userScopedKey = user?.uid ?? "anon";
  const initialDeepLinkedTab = typeof window !== "undefined"
    ? getDeepLinkedAppTab(window.location.pathname)
    : null;
  const initialThemeCheckoutNotice = readThemeCheckoutNotice();
  const initialThemeCheckoutSessionId = readThemeCheckoutSessionId();
  const [tab, setTab] = useState<AppTab>(initialDeepLinkedTab ?? "map");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthDialogOpen, setAuthDialogOpen] = useState(false);
  const initialActivationPath = typeof window !== "undefined" && isActivationRoute(window.location.pathname);
  const [isActivationModalOpen, setActivationModalOpen] = useState(initialActivationPath);
  const [isTeamModalOpen, setTeamModalOpen] = useState(false);
  const [isThemeModalOpen, setThemeModalOpen] = useState(Boolean(initialThemeCheckoutNotice));
  const [themeCheckoutNotice, setThemeCheckoutNotice] = useState<ThemeCheckoutNotice>(initialThemeCheckoutNotice);
  const [themeCheckoutSessionId, setThemeCheckoutSessionId] = useState<string | null>(initialThemeCheckoutSessionId);
  const [themeDraft, setThemeDraft] = useState<UserThemeSettings | null>(null);
  const [dashboardRefreshToken, setDashboardRefreshToken] = useState(0);
  const [pendingSmokeResult, setPendingSmokeResult] = useState<IngestSmokeTestResponse | null>(null);
  const [pendingSmokeCleanup, setPendingSmokeCleanup] = useState<IngestSmokeTestCleanupResponse | null>(null);

  const isSignedIn = Boolean(user);
  const canUseSmokeTests = Boolean(user) && isSuperAdmin;
  const canUseAdmin = Boolean(user) && (isModerator || isSuperAdmin);
  const activeTab = !isSignedIn && tab !== "map" && tab !== "pairing-info" && tab !== "about" && tab !== "node"
    ? "map"
    : (tab === "smoke" && (!user || !canUseSmokeTests)
      ? "map"
      : (tab === "admin" && !canUseAdmin ? "map" : tab));
  const activeTheme = themeDraft ?? settings.theme;
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

  const closeThemeModal = useCallback(() => {
    setThemeModalOpen(false);
    setThemeDraft(null);
    if (themeCheckoutNotice || themeCheckoutSessionId) {
      setThemeCheckoutNotice(null);
      setThemeCheckoutSessionId(null);
      clearThemeCheckoutNoticeFromUrl();
    }
  }, [themeCheckoutNotice, themeCheckoutSessionId]);

  const handleThemeModalOpenChange = useCallback((next: boolean) => {
    if (next) {
      setThemeModalOpen(true);
      return;
    }
    closeThemeModal();
  }, [closeThemeModal]);

  const toggleThemeModal = useCallback(() => {
    if (isThemeModalOpen) {
      closeThemeModal();
      return;
    }
    setThemeModalOpen(true);
  }, [closeThemeModal, isThemeModalOpen]);

  const openThemeModal = useCallback(() => {
    setThemeModalOpen(true);
  }, []);

  const openTeamModal = useCallback(() => {
    setTeamModalOpen(true);
  }, []);

  useEffect(() => {
    if (user) return;
    setThemeDraft(null);
  }, [user]);

  const handleProtectedTabClick = (target: "dashboard" | "smoke" | "admin") => {
    if (user) {
      if (target === "smoke" && !canUseSmokeTests) return;
      if (target === "admin" && !canUseAdmin) return;
      setTab(target);
      return;
    }
    openAuthDialog("login");
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setTab("map");
    }
    catch (err) {
      logWarning("Sign out failed", undefined, err);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleThemeShortcut = (event: KeyboardEvent) => {
      const isModifierActive = event.altKey || event.ctrlKey || event.shiftKey || event.metaKey;
      if (event.key?.toUpperCase() !== "T" || isModifierActive) return;

      const activeElement = document.activeElement;
      if (activeElement instanceof Element && activeElement.closest(THEME_SHORTCUT_IGNORED_SELECTOR)) return;

      event.preventDefault();
      event.stopPropagation();
      toggleThemeModal();
    };

    window.addEventListener("keydown", handleThemeShortcut, true);
    return () => window.removeEventListener("keydown", handleThemeShortcut, true);
  }, [toggleThemeModal]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isActivationModalOpen) {
      if (!isActivationRoute(window.location.pathname)) {
        window.history.pushState({}, "", APP_ROUTES.activation);
      }
    }
    else if (isActivationRoute(window.location.pathname)) {
      window.history.replaceState({}, "", APP_ROUTES.home);
    }
  }, [isActivationModalOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pathname = window.location.pathname.toLowerCase();
    if (isDeepLinkedTab(tab)) {
      const targetRoute = getRouteForDeepLinkedAppTab(tab);
      if (!pathname.startsWith(targetRoute)) {
        window.history.pushState({}, "", targetRoute);
      }
    }
    else if (isDeepLinkedAppRoute(pathname)) {
      window.history.replaceState({}, "", APP_ROUTES.home);
    }
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const pathname = window.location.pathname.toLowerCase();
      const deepLinkedTab = getDeepLinkedAppTab(pathname);
      setActivationModalOpen(isActivationRoute(pathname));
      if (deepLinkedTab) {
        setTab(deepLinkedTab);
      }
      else if (isDeepLinkedTab(tab)) {
        setTab("map");
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [tab]);

  const openActivationModal = () => {
    if (!user) {
      openAuthDialog("login");
      return;
    }
    setActivationModalOpen(true);
  };

  const handleActivationComplete = () => {
    setActivationModalOpen(false);
    setTab("dashboard");
    setDashboardRefreshToken((prev) => prev + 1);
  };

  const handleSmokeTestComplete = (result: IngestSmokeTestResponse) => {
    setPendingSmokeResult(result);
    setPendingSmokeCleanup(null);
    setTab("map");
  };

  const handleSmokeTestCleanup = (detail: IngestSmokeTestCleanupResponse) => {
    setPendingSmokeCleanup(detail);
    setPendingSmokeResult((prev) => {
      if (!prev) return prev;
      const cleared = new Set<string>();
      if (typeof detail.clearedDeviceId === "string" && detail.clearedDeviceId.length) {
        cleared.add(detail.clearedDeviceId);
      }
      if (Array.isArray(detail.clearedDeviceIds)) {
        detail.clearedDeviceIds.forEach((id) => {
          if (typeof id === "string" && id.length) cleared.add(id);
        });
      }
      return cleared.has(prev.deviceId) ? null : prev;
    });
  };

  const tabPanelFallback = (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="3"
      style={{ padding: "var(--space-8)", textAlign: "center" }}
    >
      <Text size="2" color="gray">Loading...</Text>
    </Flex>
  );

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
        onOpenChange={setActivationModalOpen}
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

      {/* ---- Branded top bar (fixed across all pages) ---- */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 99,
          display: "flex",
          flexDirection: "column",
          pointerEvents: "none",
        }}
      >
        {/* Accent gradient line */}
        <div
          style={{
            height: 3,
            background: "linear-gradient(90deg, var(--accent-9), var(--accent-7), var(--accent-9))",
            opacity: 0.9,
          }}
        />
        {/* Logo bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "var(--space-3) var(--space-4)",
            paddingLeft: "calc(var(--space-4) + 2.5px)",
            color: mapHeaderForegroundColor,
            background: mapHeaderBackground,
            backdropFilter: activeTab === "map" ? "none" : "blur(12px)",
            WebkitBackdropFilter: activeTab === "map" ? "none" : "blur(12px)",
            pointerEvents: "auto",
          }}
        >
          {/* Clickable logo + title — navigates back to map */}
          <button
            type="button"
            onClick={() => setTab("map")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: "inherit",
            }}
            aria-label="Return to map"
          >
            <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden>
              <circle cx="14" cy="14" r="13" stroke="var(--accent-9)" strokeWidth="1.5" fill="none" opacity="0.7" />
              <path
                d="M8 17a3.5 3.5 0 0 1 .5-6.95A5 5 0 0 1 18 10a4 4 0 0 1 2 7.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="12" cy="20" r="1" fill="var(--accent-9)" opacity="0.8" />
              <circle cx="16" cy="21" r="0.7" fill="var(--accent-9)" opacity="0.6" />
              <circle cx="14" cy="23" r="0.5" fill="var(--accent-9)" opacity="0.4" />
            </svg>
            <span
              style={{
                fontSize: "var(--font-size-4)",
                fontWeight: 700,
                color: "currentColor",
                letterSpacing: 0,
                textShadow: "0 1px 4px var(--gray-a6)",
              }}
            >
              CrowdPM
            </span>
            <span
              style={{
                fontSize: "var(--font-size-1)",
                color: airQualityNetworkColor,
                fontWeight: 400,
                letterSpacing: 0,
                textTransform: "uppercase",
              }}
            >
              Air Quality Network
            </span>
          </button>
        </div>
      </div>

      {/* ---- Hamburger navigation menu ---- */}
      <Box style={{ position: "fixed", top: 68, left: "var(--space-4)", zIndex: 100 }}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton
              variant="solid"
              size="3"
              aria-label="Navigation menu"
              style={{
                backdropFilter: "blur(12px)",
                backgroundColor: "color-mix(in srgb, var(--color-panel-solid) 88%, transparent)",
                color: "var(--gray-12)",
                boxShadow: "var(--shadow-4)",
                border: "1px solid var(--gray-a6)",
              }}
            >
              <HamburgerMenuIcon width={18} height={18} />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content sideOffset={8} align="start">
            <DropdownMenu.Item
              onSelect={() => setTab("map")}
              style={activeTab === "map" ? { fontWeight: 600 } : undefined}
              disabled={isLoading}
            >
              Map
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => setTab("node")}
              style={activeTab === "node" ? { fontWeight: 600 } : undefined}
              disabled={isLoading}
            >
              Products
            </DropdownMenu.Item>
            {isSignedIn ? (
              <>
                <DropdownMenu.Item
                  onSelect={() => handleProtectedTabClick("dashboard")}
                  style={activeTab === "dashboard" ? { fontWeight: 600 } : undefined}
                  disabled={isLoading}
                >
                  User Dashboard
                </DropdownMenu.Item>
                {canUseAdmin ? (
                  <DropdownMenu.Item
                    onSelect={() => handleProtectedTabClick("admin")}
                    style={activeTab === "admin" ? { fontWeight: 600 } : undefined}
                    disabled={isLoading}
                  >
                    Admin
                  </DropdownMenu.Item>
                ) : null}
                <DropdownMenu.Item
                  onSelect={() => setTab("about")}
                  style={activeTab === "about" ? { fontWeight: 600 } : undefined}
                  disabled={isLoading}
                >
                  About
                </DropdownMenu.Item>
              </>
            ) : (
              <DropdownMenu.Item
                onSelect={() => setTab("about")}
                style={activeTab === "about" ? { fontWeight: 600 } : undefined}
                disabled={isLoading}
              >
                About
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator />
            {user ? (
              <DropdownMenu.Item color="red" onSelect={handleSignOut}>
                Sign out
              </DropdownMenu.Item>
            ) : (
              <>
                <DropdownMenu.Item onSelect={() => openAuthDialog("login")} disabled={isLoading}>
                  Log in
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => openAuthDialog("signup")} disabled={isLoading}>
                  Sign up
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Box>

      <main
        id="main-content"
        style={{
          minHeight: "100vh",
          height: activeTab === "map" ? "100dvh" : "100dvh",
          overflowY: activeTab === "map" ? "hidden" : "auto",
          WebkitOverflowScrolling: activeTab === "map" ? undefined : "touch",
        }}
      >
        {activeTab === "map" ? (
          /* Full-bleed map — fills the entire viewport */
          <Box
            style={{
              width: "100%",
              height: "100dvh",
              paddingBottom: MAP_VIEWPORT_BOTTOM_INSET,
              boxSizing: "border-box",
            }}
          >
            <Suspense fallback={tabPanelFallback}>
              <MapPage
                key={`map:${userScopedKey}`}
                pendingSmokeResult={user ? pendingSmokeResult : null}
                onSmokeResultConsumed={user ? (() => setPendingSmokeResult(null)) : undefined}
                pendingCleanupDetail={user ? pendingSmokeCleanup : null}
                onCleanupDetailConsumed={user ? (() => setPendingSmokeCleanup(null)) : undefined}
              />
            </Suspense>
          </Box>
        ) : (
          /* All other tabs get the branded header + content layout */
          <Box
            style={{
              minHeight: "100dvh",
              backgroundColor: "var(--color-surface)",
              backgroundImage:
                "radial-gradient(120% 80% at 0% 0%, var(--accent-a4), transparent), radial-gradient(80% 80% at 100% 0%, var(--gray-a3), transparent)",
            }}
          >
            {/* ---- Page content ---- */}
            <Box
              style={{
                maxWidth: 1100,
                margin: "0 auto",
                padding: "var(--space-5) var(--space-6)",
                paddingTop: 64,
                paddingBottom: "max(var(--space-6), env(safe-area-inset-bottom, 0px) + var(--space-5))",
              }}
            >
              <Box
                style={{
                  borderRadius: "var(--radius-4)",
                  background: "var(--color-panel-solid)",
                  boxShadow: "var(--shadow-3)",
                  padding: "var(--space-4)",
                }}
              >
                <Suspense fallback={tabPanelFallback}>
                  {activeTab === "dashboard" && user ? (
                    <UserDashboard
                      key={`dashboard:${userScopedKey}`}
                      onRequestActivation={openActivationModal}
                      onOpenSmokeTest={canUseSmokeTests ? (() => handleProtectedTabClick("smoke")) : undefined}
                      onOpenThemeModal={openThemeModal}
                      refreshToken={dashboardRefreshToken}
                    />
                  ) : activeTab === "smoke" && user && canUseSmokeTests ? (
                    <SmokeTestLab
                      key={`smoke:${userScopedKey}`}
                      onSmokeTestComplete={handleSmokeTestComplete}
                      onSmokeTestCleared={handleSmokeTestCleanup}
                    />
                  ) : activeTab === "admin" && user && canUseAdmin ? (
                    <AdminModerationPage key={`admin:${userScopedKey}`} />
                  ) : activeTab === "pairing-info" ? (
                    <PairingInfoPage onOpenActivation={openActivationModal} />
                  ) : activeTab === "about" ? (
                    <AboutPage onOpenTeamModal={openTeamModal} />
                  ) : activeTab === "node" ? (
                    <NodePage />
                  ) : (
                    <Flex
                      direction="column"
                      align="center"
                      justify="center"
                      gap="3"
                      style={{ padding: "var(--space-8)", textAlign: "center" }}
                    >
                      <Heading size="5">Sign in to access CrowdPM</Heading>
                      <Text size="2" color="gray" style={{ maxWidth: 360 }}>
                        Log in to explore the CrowdPM map, review batches, and access the coordination resources.
                      </Text>
                    </Flex>
                  )}
                </Suspense>
              </Box>
            </Box>
          </Box>
        )}
      </main>
      <Suspense fallback={null}>
        {isAuthDialogOpen ? (
          <AuthDialog
            open={isAuthDialogOpen}
            mode={authMode}
            onModeChange={setAuthMode}
            onOpenChange={setAuthDialogOpen}
            onAuthenticated={() => setTab("dashboard")}
          />
        ) : null}
      </Suspense>
    </Theme>
  );
}

type ActivationModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onActivationComplete: () => void;
};

function ActivationModal({ open, onOpenChange, onActivationComplete }: ActivationModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="4"
        style={{
          width: "min(760px, 96vw)",
          maxWidth: "760px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <Suspense fallback={<Text size="2" color="gray">Loading activation...</Text>}>
          <ActivationPage layout="dialog" onActivationComplete={onActivationComplete} />
        </Suspense>
      </Dialog.Content>
    </Dialog.Root>
  );
}

type ThemePreferencesModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  checkoutNotice: ThemeCheckoutNotice;
  checkoutSessionId: string | null;
  theme: UserThemeSettings;
  onThemeChange: (next: UserThemeSettings) => void;
  onThemeSaved: () => void;
};

function ThemePreferencesModal({
  open,
  onOpenChange,
  checkoutNotice,
  checkoutSessionId,
  theme,
  onThemeChange,
  onThemeSaved,
}: ThemePreferencesModalProps) {
  const { user } = useAuth();
  const { settings, refresh, isLoading, isSaving, updateSettings } = useUserSettings();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [isConfirmingCheckout, setIsConfirmingCheckout] = useState(false);
  const [openLegalDocument, setOpenLegalDocument] = useState<LegalDocumentId | null>(null);
  const controlsDisabled = isLoading || isSaving || isStartingCheckout || isConfirmingCheckout;
  const hasUnsavedChanges = JSON.stringify(theme) !== JSON.stringify(settings.theme);
  const saveDisabled = controlsDisabled || !user || !settings.themeSaveUnlocked || !hasUnsavedChanges;
  const unlockDisabled = controlsDisabled || !user || settings.themeSaveUnlocked;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (checkoutNotice === "success") {
      setMessage(settings.themeSaveUnlocked
        ? "Theme saving is now unlocked for this account."
        : "Theme purchase completed. If saving is still locked, give the account a moment to refresh.");
      return;
    }
    if (checkoutNotice === "cancelled") {
      setMessage("Theme save unlock checkout was cancelled before payment completed.");
      return;
    }
    setMessage(null);
  }, [checkoutNotice, open, settings.themeSaveUnlocked]);

  useEffect(() => {
    if (!open || checkoutNotice !== "success" || !user) {
      setIsConfirmingCheckout(false);
      return;
    }
    let isCancelled = false;
    setIsConfirmingCheckout(true);
    void (async () => {
      try {
        if (checkoutSessionId) {
          await confirmThemeSaveCheckoutSession(checkoutSessionId);
        }
        await refresh();
      }
      catch (err) {
        if (isCancelled) return;
        if (err instanceof Error && err.message === "theme_save_pending") {
          setError("Theme purchase is still processing. Please try again in a moment.");
          return;
        }
        setError(err instanceof Error ? err.message : "Unable to refresh theme entitlements.");
      }
      finally {
        if (!isCancelled) {
          setIsConfirmingCheckout(false);
        }
      }
    })();
    return () => {
      isCancelled = true;
    };
  }, [checkoutNotice, checkoutSessionId, open, refresh, user]);

  const handleSave = async () => {
    if (!user) {
      setMessage(null);
      setError("Sign in to save theme preferences.");
      return;
    }
    if (!settings.themeSaveUnlocked) {
      setMessage(null);
      setError("Purchase the theme save unlock to persist theme preferences.");
      return;
    }
    if (!hasUnsavedChanges) {
      setMessage("No theme changes to save.");
      setError(null);
      return;
    }

    setMessage(null);
    setError(null);
    try {
      await updateSettings({ theme });
      onThemeSaved();
      setMessage("Theme preferences saved.");
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update theme preferences.");
    }
  };

  const handlePurchaseThemeSave = async () => {
    if (!user) {
      setMessage(null);
      setError("Sign in to purchase and save theme preferences.");
      return;
    }

    setMessage(null);
    setError(null);
    setIsStartingCheckout(true);
    try {
      const session = await createThemeSaveCheckoutSession();
      window.location.assign(session.url);
      return;
    }
    catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open theme checkout right now.");
      setIsStartingCheckout(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="3"
        style={{
          width: "min(460px, 96vw)",
          maxWidth: "460px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <Dialog.Title>Theme</Dialog.Title>
        <Dialog.Description>
          Preview changes live, then save them when you are ready.
        </Dialog.Description>
        <Flex direction="column" gap="3" mt="4">
          {!user ? (
            <Callout.Root color="amber" variant="surface">
              <Callout.Text>
                Sign in to purchase the theme save unlock and save theme preferences to your account.
              </Callout.Text>
            </Callout.Root>
          ) : !settings.themeSaveUnlocked ? (
            <Callout.Root color="amber" variant="surface">
              <Callout.Text>
                Theme saving is locked for this account. Live preview stays available, but saving
                requires a one-time $3 theme save unlock.
              </Callout.Text>
            </Callout.Root>
          ) : (
            <Callout.Root color="green" variant="surface">
              <Callout.Text>
                Theme saving is unlocked for this account.
              </Callout.Text>
            </Callout.Root>
          )}

          {open ? (
            <Suspense fallback={<Text size="2" color="gray">Loading theme settings...</Text>}>
              <ThemeSettingsControls
                value={theme}
                onChange={onThemeChange}
                disabled={controlsDisabled}
              />
            </Suspense>
          ) : null}

          {!settings.themeSaveUnlocked ? (
            <Flex direction="column" gap="2">
              <Button
                size="3"
                variant="solid"
                onClick={() => { void handlePurchaseThemeSave(); }}
                disabled={unlockDisabled}
              >
                {isStartingCheckout ? "Opening Checkout..." : "Unlock Theme Saving - $3"}
              </Button>
              <Text size="1" color="gray">
                Sold by Denuo Web LLC as a one-time digital expansion purchase. No shipping applies,
                applicable sales tax is calculated in Stripe Checkout, and theme save unlock purchases
                are subject to the{" "}
                <LegalDocumentLink documentId="terms" onOpen={setOpenLegalDocument}>
                  Terms
                </LegalDocumentLink>
                ,{" "}
                <LegalDocumentLink documentId="license" onOpen={setOpenLegalDocument}>
                  License
                </LegalDocumentLink>
                , and{" "}
                <LegalDocumentLink documentId="privacy" onOpen={setOpenLegalDocument}>
                  Privacy Policy
                </LegalDocumentLink>
                .
              </Text>
            </Flex>
          ) : null}

          <Flex justify="end" gap="3" mt="2">
            <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={() => { void handleSave(); }} disabled={saveDisabled}>
              Save
            </Button>
          </Flex>
        </Flex>
        {error ? (
          <Text color="tomato" size="2" mt="3">{error}</Text>
        ) : null}
        {message ? (
          <Text color="green" size="2" mt="3">{message}</Text>
        ) : null}
      </Dialog.Content>
      <LegalDocumentDialog
        documentId={openLegalDocument}
        onOpenChange={(next) => {
          if (!next) setOpenLegalDocument(null);
        }}
      />
    </Dialog.Root>
  );
}

type TeamModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  isSignedIn: boolean;
};

function TeamModal({ open, onOpenChange, isSignedIn }: TeamModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="4"
        style={{
          width: "min(560px, 96vw)",
          maxWidth: "560px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <Heading as="h2" size="5" trim="start">
          <ExternalLink href={PROJECT_LINKS.osuEecsProgram} color="iris" highContrast>
            OSU EECS
          </ExternalLink>{" "}
          Capstone Team
        </Heading>
        <Text size="2" color="gray" mt="2">
          Key collaborators for the capstone effort and their primary roles.
        </Text>
        <Flex direction="column" gap="3" mt="4">
          {TEAM_MEMBERS.map((member) => (
            <Flex key={member.name} align="center" gap="3" style={{ width: "100%" }}>
              <Flex align="center" gap="3" style={{ flex: 1, minWidth: 0 }}>
                <Avatar
                  radius="full"
                  size="2"
                  fallback={member.name.charAt(0).toUpperCase() || "?"}
                />
                <Text size="2" weight="medium">
                  <Link href={`mailto:${member.email}`} color="iris" highContrast>
                    {member.name}
                  </Link>
                </Text>
              </Flex>
              <Text
                size="1"
                color="gray"
                style={{ minWidth: "120px", textAlign: "right" }}
              >
                {member.role}
              </Text>
              <Flex gap="2">
                <IconButton
                  asChild
                  variant="soft"
                  size="1"
                  radius="full"
                  aria-label={`${member.name} GitHub profile`}
                >
                  <ExternalAnchor href={member.github}>
                    <GitHubLogoIcon />
                  </ExternalAnchor>
                </IconButton>
                <IconButton
                  asChild
                  variant="soft"
                  size="1"
                  radius="full"
                  aria-label={`${member.name} LinkedIn profile`}
                >
                  <ExternalAnchor href={member.linkedin}>
                    <LinkedInLogoIcon />
                  </ExternalAnchor>
                </IconButton>
              </Flex>
            </Flex>
          ))}
        </Flex>
        {isSignedIn ? (
          <>
            <Separator my="4" />
            <Text size="2" color="gray">
              Coordination links
            </Text>
            <Flex direction="column" gap="2" mt="2">
              {PROJECT_RESOURCE_LINKS.map((resource) => (
                <ExternalLink
                  key={resource.href}
                  href={resource.href}
                  color="iris"
                  highContrast
                  size="2"
                >
                  {resource.label}
                </ExternalLink>
              ))}
            </Flex>
          </>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
