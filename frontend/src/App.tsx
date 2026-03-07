import { lazy, Suspense, useEffect, useState } from "react";
import { AuthDialog, type AuthMode } from "./components/AuthDialog";
import { useAuth } from "./providers/AuthProvider";
import { type IngestSmokeTestCleanupResponse, type IngestSmokeTestResponse } from "./lib/api";
import {
  Theme,
  ThemePanel,
  Box,
  Card,
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

const rawSmokeTestEmails = import.meta.env.VITE_SMOKE_TEST_USER_EMAILS
  ?? import.meta.env.VITE_SMOKE_TEST_USER_EMAIL
  ?? "smoke-tester@crowdpm.dev";
const SMOKE_TEST_EMAILS = parseSmokeTestEmails(
  typeof rawSmokeTestEmails === "string" ? rawSmokeTestEmails : String(rawSmokeTestEmails)
);

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

const RESOURCE_LINKS: Array<{ label: string; href: string }> = [
  {
    label: "Capstone Portal",
    href: "https://eecs.engineering.oregonstate.edu/capstone/submission/pages/viewSingleProject.php?id=WHBsGlAFvH7HrCiH",
  },
  {
    label: "Capstone Drive",
    href: "https://drive.google.com/drive/folders/1Yh_4dku-TqYAlbGtKzT0UM0-LubAig17?usp=sharing",
  },
  {
    label: "Technical Requirements Doc",
    href: "https://docs.google.com/document/d/1i0fjx2_IagNerPkSPpG9JzbErKNKuu0caAm-F-koBTo/edit?usp=sharing",
  },
  {
    label: "GitHub Monorepo",
    href: "https://github.com/Denuo-Web/CrowdPMPlatform/",
  },
  {
    label: "Deep Wiki",
    href: "https://deepwiki.com/Denuo-Web/CrowdPMPlatform",
  },
  {
    label: "Asana Board",
    href: "https://app.asana.com/1/941689499454829/project/1211814553979599/board",
  },
  {
    label: "Discord Invite",
    href: "https://discord.gg/cEbGw8HAUQ",
  },
];

const MapPage = lazy(() => import("./pages/MapPage"));
const UserDashboard = lazy(() => import("./pages/UserDashboard"));
const SmokeTestLab = lazy(() => import("./pages/SmokeTestLab"));
const AdminModerationPage = lazy(() => import("./pages/AdminModerationPage"));
const ActivationPage = lazy(async () => {
  const module = await import("./pages/ActivationPage");
  return { default: module.ActivationPage };
});
const PairingInfoPage = lazy(() => import("./pages/PairingInfoPage"));

export default function App() {
  const { user, isLoading, signOut, isModerator, isSuperAdmin } = useAuth();
  const userScopedKey = user?.uid ?? "anon";
  const initialPairingGuidePath = typeof window !== "undefined" && window.location.pathname.toLowerCase().startsWith("/pairing-guide");
  const [tab, setTab] = useState<"map" | "dashboard" | "smoke" | "admin" | "pairing-info">(initialPairingGuidePath ? "pairing-info" : "map");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthDialogOpen, setAuthDialogOpen] = useState(false);
  const initialActivationPath = typeof window !== "undefined" && window.location.pathname.toLowerCase().startsWith("/activate");
  const [isActivationModalOpen, setActivationModalOpen] = useState(initialActivationPath);
  const [isTeamModalOpen, setTeamModalOpen] = useState(false);
  const [dashboardRefreshToken, setDashboardRefreshToken] = useState(0);
  const [pendingSmokeResult, setPendingSmokeResult] = useState<IngestSmokeTestResponse | null>(null);
  const [pendingSmokeCleanup, setPendingSmokeCleanup] = useState<IngestSmokeTestCleanupResponse | null>(null);

  const isSignedIn = Boolean(user);
  const canUseSmokeTests = (() => {
    const email = user?.email;
    return typeof email === "string" && email.length > 0 && isSmokeTestEmail(email);
  })();
  const canUseAdmin = Boolean(user) && (isModerator || isSuperAdmin);
  const activeTab = !isSignedIn && tab !== "map" && tab !== "pairing-info"
    ? "map"
    : (tab === "smoke" && (!user || !canUseSmokeTests)
      ? "map"
      : (tab === "admin" && !canUseAdmin ? "map" : tab));

  const openAuthDialog = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthDialogOpen(true);
  };

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
      console.warn("Sign out failed", err);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isActivationModalOpen) {
      if (!window.location.pathname.toLowerCase().startsWith("/activate")) {
        window.history.pushState({}, "", "/activate");
      }
    }
    else if (window.location.pathname.toLowerCase().startsWith("/activate")) {
      window.history.replaceState({}, "", "/");
    }
  }, [isActivationModalOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const pathname = window.location.pathname.toLowerCase();
    if (tab === "pairing-info") {
      if (!pathname.startsWith("/pairing-guide")) {
        window.history.pushState({}, "", "/pairing-guide");
      }
    }
    else if (pathname.startsWith("/pairing-guide")) {
      window.history.replaceState({}, "", "/");
    }
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handlePopState = () => {
      const pathname = window.location.pathname.toLowerCase();
      setActivationModalOpen(pathname.startsWith("/activate"));
      if (pathname.startsWith("/pairing-guide")) {
        setTab("pairing-info");
      }
      else if (tab === "pairing-info") {
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
    <Theme appearance="dark" accentColor="iris" radius="full" panelBackground="translucent" scaling="100%">
      {import.meta.env.DEV ? <ThemePanel defaultOpen={false} /> : null}
      <ActivationModal
        open={isActivationModalOpen}
        onOpenChange={setActivationModalOpen}
        onActivationComplete={handleActivationComplete}
      />
      <TeamModal open={isTeamModalOpen} onOpenChange={setTeamModalOpen} isSignedIn={isSignedIn} />

      {/* ---- Hamburger navigation menu ---- */}
      <Box style={{ position: "fixed", top: "var(--space-4)", left: "var(--space-4)", zIndex: 100 }}>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <IconButton
              variant="solid"
              size="3"
              aria-label="Navigation menu"
              style={{
                backdropFilter: "blur(12px)",
                backgroundColor: "rgba(0, 0, 0, 0.75)",
                color: "white",
                boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.12)",
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
              onSelect={() => setTab("pairing-info")}
              style={activeTab === "pairing-info" ? { fontWeight: 600 } : undefined}
              disabled={isLoading}
            >
              Pairing Guide
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setTeamModalOpen(true)} disabled={isLoading}>
              Team
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
                {canUseSmokeTests ? (
                  <DropdownMenu.Item
                    onSelect={() => handleProtectedTabClick("smoke")}
                    style={activeTab === "smoke" ? { fontWeight: 600 } : undefined}
                    disabled={isLoading}
                  >
                    Smoke Test
                  </DropdownMenu.Item>
                ) : null}
                {canUseAdmin ? (
                  <DropdownMenu.Item
                    onSelect={() => handleProtectedTabClick("admin")}
                    style={activeTab === "admin" ? { fontWeight: 600 } : undefined}
                    disabled={isLoading}
                  >
                    Admin
                  </DropdownMenu.Item>
                ) : null}
              </>
            ) : null}
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

      <main id="main-content" style={{ minHeight: "100vh" }}>
        {activeTab === "map" ? (
          /* Full-bleed map — fills the entire viewport */
          <Box style={{ width: "100%", height: "100vh" }}>
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
          /* All other tabs keep the existing padded Card layout */
          <Box
            style={{
              minHeight: "100vh",
              padding: "var(--space-6)",
              backgroundColor: "var(--color-surface)",
              backgroundImage:
                "radial-gradient(120% 80% at 0% 0%, var(--accent-a4), transparent), radial-gradient(80% 80% at 100% 0%, var(--gray-a3), transparent)",
            }}
          >
            <Flex
              direction="column"
              gap="6"
              align="center"
              style={{ maxWidth: "1100px", margin: "0 auto" }}
            >
              <Card size="4" style={{ width: "100%" }}>
                <Heading as="h2" size="6" trim="start">
                  CrowdPM Platform
                </Heading>
                <Text size="2" color="gray" mt="2">
                  Explore the map or adjust ingest settings across your network.
                </Text>

                <Box
                  mt="4"
                  style={{
                    borderRadius: "var(--radius-4)",
                    background: "var(--color-panel-solid)",
                    boxShadow: "var(--shadow-3)",
                  }}
                >
                  <Box style={{ padding: "var(--space-4)" }}>
                    <Suspense fallback={tabPanelFallback}>
                      {activeTab === "dashboard" && user ? (
                        <UserDashboard
                        key={`dashboard:${userScopedKey}`}
                        onRequestActivation={openActivationModal}
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
                            Log in to explore the CrowdPM map, run smoke tests, review batches, and access the coordination
                            resources.
                          </Text>
                        </Flex>
                      )}
                    </Suspense>
                  </Box>
                </Box>
              </Card>
            </Flex>
          </Box>
        )}
      </main>
      <AuthDialog
        open={isAuthDialogOpen}
        mode={authMode}
        onModeChange={setAuthMode}
        onOpenChange={setAuthDialogOpen}
        onAuthenticated={() => setTab("dashboard")}
      />
    </Theme>
  );
}

function parseSmokeTestEmails(raw: string): string[] {
  return raw.split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

function isSmokeTestEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && SMOKE_TEST_EMAILS.includes(normalized);
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
          <Link
            href="https://ecampus.oregonstate.edu/online-degrees/undergraduate/electrical-computer-engineering/"
            target="_blank"
            rel="noreferrer"
            color="iris"
            highContrast
          >
            OSU EECS
          </Link>{" "}
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
                  <a href={member.github} target="_blank" rel="noreferrer">
                    <GitHubLogoIcon />
                  </a>
                </IconButton>
                <IconButton
                  asChild
                  variant="soft"
                  size="1"
                  radius="full"
                  aria-label={`${member.name} LinkedIn profile`}
                >
                  <a href={member.linkedin} target="_blank" rel="noreferrer">
                    <LinkedInLogoIcon />
                  </a>
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
              {RESOURCE_LINKS.map((resource) => (
                <Link
                  key={resource.href}
                  href={resource.href}
                  target="_blank"
                  rel="noreferrer"
                  color="iris"
                  size="2"
                >
                  {resource.label}
                </Link>
              ))}
            </Flex>
          </>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
