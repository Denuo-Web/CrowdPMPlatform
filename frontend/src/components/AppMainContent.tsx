import { lazy, Suspense } from "react";
import type { UserThemeAppearance } from "@crowdpm/types";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import type { AuthMode } from "./AuthDialog";
import type { RoutedAppTab } from "../lib/appRoutes";
import HomePage from "../pages/HomePage";

const MapPage = lazy(() => import("../pages/MapPage"));
const UserDashboard = lazy(() => import("../pages/UserDashboard"));
const AdminModerationPage = lazy(() => import("../pages/AdminModerationPage"));
const PairingInfoPage = lazy(() => import("../pages/PairingInfoPage"));
const AboutPage = lazy(() => import("../pages/AboutPage"));
const NodePage = lazy(() => import("../pages/NodePage"));
const ApiDocsPage = lazy(() => import("../pages/ApiDocsPage"));

const MAP_VIEWPORT_BOTTOM_INSET = "max(12px, env(safe-area-inset-bottom, 0px))";

export type SubscriptionCheckoutNotice = "success" | "cancelled" | null;

type AppMainContentProps = {
  activeTab: RoutedAppTab;
  isSignedIn: boolean;
  canAccessAdmin: boolean;
  userScopedKey: string;
  mapAppearance: UserThemeAppearance;
  dashboardRefreshToken: number;
  subscriptionCheckoutNotice: SubscriptionCheckoutNotice;
  subscriptionCheckoutSessionId: string | null;
  onNavigate: (tab: RoutedAppTab) => void;
  onProtectedTabClick: (target: "dashboard" | "admin") => void;
  onOpenActivation: () => void;
  onOpenThemeModal: () => void;
  onSubscriptionCheckoutHandled: () => void;
  onOpenTeamModal: () => void;
  onOpenAuth: (mode: AuthMode) => void;
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

export function AppMainContent({
  activeTab,
  isSignedIn,
  canAccessAdmin,
  userScopedKey,
  mapAppearance,
  dashboardRefreshToken,
  subscriptionCheckoutNotice,
  subscriptionCheckoutSessionId,
  onNavigate,
  onProtectedTabClick,
  onOpenActivation,
  onOpenThemeModal,
  onSubscriptionCheckoutHandled,
  onOpenTeamModal,
  onOpenAuth,
}: AppMainContentProps) {
  return (
    <main
      id="main-content"
      style={activeTab === "map"
        ? {
          minHeight: "100vh",
          height: "100dvh",
          overflowY: "hidden",
        }
        : {
          minHeight: "100vh",
        }}
    >
      {activeTab === "map" ? (
        <Box
          style={{
            width: "100%",
            height: "100dvh",
            paddingBottom: MAP_VIEWPORT_BOTTOM_INSET,
            boxSizing: "border-box",
          }}
        >
          <Suspense fallback={tabPanelFallback}>
            <MapPage key={`map:${userScopedKey}`} mapAppearance={mapAppearance} />
          </Suspense>
        </Box>
      ) : (
        <Box
          style={{
            minHeight: "100vh",
            backgroundColor: "var(--color-surface)",
            backgroundImage:
              "radial-gradient(120% 80% at 0% 0%, var(--accent-a4), transparent), radial-gradient(80% 80% at 100% 0%, var(--gray-a3), transparent)",
          }}
        >
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
                {activeTab === "home" ? (
                  <HomePage
                    isSignedIn={isSignedIn}
                    onExploreMap={() => onNavigate("map")}
                    onOpenDashboard={() => onProtectedTabClick("dashboard")}
                    onOpenActivation={onOpenActivation}
                    onOpenAbout={() => onNavigate("about")}
                    onOpenProducts={() => onNavigate("node")}
                    onOpenAuth={onOpenAuth}
                  />
                ) : activeTab === "dashboard" && isSignedIn ? (
                  <UserDashboard
                    key={`dashboard:${userScopedKey}`}
                    onRequestActivation={onOpenActivation}
                    onOpenThemeModal={onOpenThemeModal}
                    subscriptionCheckoutNotice={subscriptionCheckoutNotice}
                    subscriptionCheckoutSessionId={subscriptionCheckoutSessionId}
                    onSubscriptionCheckoutHandled={onSubscriptionCheckoutHandled}
                    refreshToken={dashboardRefreshToken}
                  />
                ) : activeTab === "admin" && isSignedIn && canAccessAdmin ? (
                  <AdminModerationPage key={`admin:${userScopedKey}`} />
                ) : activeTab === "pairing-info" ? (
                  <PairingInfoPage onOpenActivation={onOpenActivation} />
                ) : activeTab === "about" ? (
                  <AboutPage onOpenTeamModal={onOpenTeamModal} />
                ) : activeTab === "node" ? (
                  <NodePage />
                ) : activeTab === "api-docs" ? (
                  <ApiDocsPage />
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
  );
}
