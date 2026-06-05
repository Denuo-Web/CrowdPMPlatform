import { Box, DropdownMenu, IconButton } from "@radix-ui/themes";
import { HamburgerMenuIcon } from "@radix-ui/react-icons";
import type { AuthMode } from "./AuthDialog";
import type { RoutedAppTab } from "../lib/appRoutes";

type AppNavigationProps = {
  activeTab: RoutedAppTab;
  isLoading: boolean;
  isSignedIn: boolean;
  canAccessAdmin: boolean;
  mapHeaderBackground: string;
  mapHeaderForegroundColor: string;
  airQualityNetworkColor: string;
  onNavigate: (tab: RoutedAppTab) => void;
  onProtectedTabClick: (target: "dashboard" | "admin") => void;
  onOpenAuth: (mode: AuthMode) => void;
  onSignOut: () => void;
};

export function AppNavigation({
  activeTab,
  isLoading,
  isSignedIn,
  canAccessAdmin,
  mapHeaderBackground,
  mapHeaderForegroundColor,
  airQualityNetworkColor,
  onNavigate,
  onProtectedTabClick,
  onOpenAuth,
  onSignOut,
}: AppNavigationProps) {
  return (
    <>
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
        <div
          style={{
            height: 3,
            background: "linear-gradient(90deg, var(--accent-9), var(--accent-7), var(--accent-9))",
            opacity: 0.9,
          }}
        />
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
          <button
            type="button"
            onClick={() => onNavigate("home")}
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
            aria-label="Return to home"
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
              onSelect={() => onNavigate("home")}
              style={activeTab === "home" ? { fontWeight: 600 } : undefined}
              disabled={isLoading}
            >
              Home
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onNavigate("map")}
              style={activeTab === "map" ? { fontWeight: 600 } : undefined}
              disabled={isLoading}
            >
              Explore Map
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onNavigate("node")}
              style={activeTab === "node" ? { fontWeight: 600 } : undefined}
              disabled={isLoading}
            >
              Node
            </DropdownMenu.Item>
            {isSignedIn ? (
              <>
                <DropdownMenu.Item
                  onSelect={() => onProtectedTabClick("dashboard")}
                  style={activeTab === "dashboard" ? { fontWeight: 600 } : undefined}
                  disabled={isLoading}
                >
                  User Dashboard
                </DropdownMenu.Item>
                {canAccessAdmin ? (
                  <DropdownMenu.Item
                    onSelect={() => onProtectedTabClick("admin")}
                    style={activeTab === "admin" ? { fontWeight: 600 } : undefined}
                    disabled={isLoading}
                  >
                    Admin
                  </DropdownMenu.Item>
                ) : null}
                <DropdownMenu.Item
                  onSelect={() => onNavigate("about")}
                  style={activeTab === "about" ? { fontWeight: 600 } : undefined}
                  disabled={isLoading}
                >
                  About
                </DropdownMenu.Item>
              </>
            ) : (
              <DropdownMenu.Item
                onSelect={() => onNavigate("about")}
                style={activeTab === "about" ? { fontWeight: 600 } : undefined}
                disabled={isLoading}
              >
                About
              </DropdownMenu.Item>
            )}
            <DropdownMenu.Separator />
            {isSignedIn ? (
              <DropdownMenu.Item color="red" onSelect={onSignOut}>
                Sign out
              </DropdownMenu.Item>
            ) : (
              <>
                <DropdownMenu.Item onSelect={() => onOpenAuth("login")} disabled={isLoading}>
                  Log in
                </DropdownMenu.Item>
                <DropdownMenu.Item onSelect={() => onOpenAuth("signup")} disabled={isLoading}>
                  Sign up
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </Box>
    </>
  );
}
