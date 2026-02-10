import { lazy, Suspense, useEffect, useState } from "react";
import { AuthDialog, type AuthMode } from "./components/AuthDialog";
import { useAuth } from "./providers/AuthProvider";
import { type IngestSmokeTestCleanupResponse, type IngestSmokeTestResponse } from "./lib/api";
import {
  Theme,
  ThemePanel,
  Box,
  Card,
  Flex,
  Heading,
  Text,
  Avatar,
  Separator,
  Button,
  Link,
  IconButton,
  Dialog,
} from "@radix-ui/themes";
import { ChevronDownIcon, GitHubLogoIcon, LinkedInLogoIcon } from "@radix-ui/react-icons";

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

const COORDINATION_LINKS_COLLAPSE_WIDTH = 1024;
const COORDINATION_LINKS_CONTENT_ID = "coordination-links-content";
const getShouldCollapseCoordinationLinks = () =>
  typeof window !== "undefined" ? window.innerWidth < COORDINATION_LINKS_COLLAPSE_WIDTH : false;
const MapPage = lazy(() => import("./pages/MapPage"));
const UserDashboard = lazy(() => import("./pages/UserDashboard"));
const SmokeTestLab = lazy(() => import("./pages/SmokeTestLab"));
const ActivationPage = lazy(async () => {
  const module = await import("./pages/ActivationPage");
  return { default: module.ActivationPage };
});

export default function App() {
  const { user, isLoading, signOut } = useAuth();
  const userScopedKey = user?.uid ?? "anon";
  const [tab, setTab] = useState<"map" | "dashboard" | "smoke">("map");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthDialogOpen, setAuthDialogOpen] = useState(false);
  const initialActivationPath = typeof window !== "undefined" && window.location.pathname.toLowerCase().startsWith("/activate");
  const [isActivationModalOpen, setActivationModalOpen] = useState(initialActivationPath);
  const [pendingSmokeResult, setPendingSmokeResult] = useState<IngestSmokeTestResponse | null>(null);
  const [pendingSmokeCleanup, setPendingSmokeCleanup] = useState<IngestSmokeTestCleanupResponse | null>(null);
  const [shouldCollapseResourceLinks, setShouldCollapseResourceLinks] = useState(() => getShouldCollapseCoordinationLinks());
  const [resourceLinksExpandedOverride, setResourceLinksExpandedOverride] = useState(false);

  const isSignedIn = Boolean(user);
  const canUseSmokeTests = (() => {
    const email = user?.email;
    return typeof email === "string" && email.length > 0 && isSmokeTestEmail(email);
  })();
  const activeTab = !isSignedIn && tab !== "map"
    ? "map"
    : (tab === "smoke" && (!user || !canUseSmokeTests) ? "map" : tab);

  const openAuthDialog = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthDialogOpen(true);
  };

  const handleProtectedTabClick = (target: "dashboard" | "smoke") => {
    if (user) {
      if (target === "smoke" && !canUseSmokeTests) return;
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
    const handlePopState = () => {
      const next = window.location.pathname.toLowerCase().startsWith("/activate");
      setActivationModalOpen(next);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openActivationModal = () => {
    if (!user) {
      openAuthDialog("login");
      return;
    }
    setActivationModalOpen(true);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateShouldCollapse = () => {
      const nextShouldCollapse = getShouldCollapseCoordinationLinks();
      setShouldCollapseResourceLinks((prev) => {
        if (prev === nextShouldCollapse) return prev;
        return nextShouldCollapse;
      });
      if (nextShouldCollapse) {
        setResourceLinksExpandedOverride(false);
      }
    };
    window.addEventListener("resize", updateShouldCollapse);
    return () => window.removeEventListener("resize", updateShouldCollapse);
  }, []);

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

  const areResourceLinksExpanded = shouldCollapseResourceLinks ? resourceLinksExpandedOverride : true;
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
      <ActivationModal open={isActivationModalOpen} onOpenChange={setActivationModalOpen} />
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
          <Flex
            direction={{ initial: "column", md: "row" }}
            gap="6"
            align="stretch"
            style={{ width: "100%" }}
          >
            <Card size="4" style={{ flexBasis: "320px", flexShrink: 0, overflow: "visible" }}>
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
              <Flex direction="column" gap="3" mt="3">
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
                  {shouldCollapseResourceLinks ? (
                    <Box>
                      <Flex align="center" justify="between" gap="2" wrap="wrap">
                        <Text size="2" color="gray">
                          Coordination links
                        </Text>
                        <Button
                          variant="soft"
                          size="1"
                          onClick={() => setResourceLinksExpandedOverride((prev) => !prev)}
                          aria-expanded={areResourceLinksExpanded}
                          aria-controls={COORDINATION_LINKS_CONTENT_ID}
                        >
                          {areResourceLinksExpanded ? "Hide" : "Show"} links
                          <ChevronDownIcon
                            style={{
                              marginLeft: "var(--space-1)",
                              transition: "transform 200ms ease",
                              transform: areResourceLinksExpanded ? "rotate(180deg)" : "rotate(0deg)",
                            }}
                            aria-hidden
                          />
                        </Button>
                      </Flex>
                      <Box
                        id={COORDINATION_LINKS_CONTENT_ID}
                        aria-hidden={!areResourceLinksExpanded}
                        style={{
                          display: "grid",
                          gridTemplateRows: areResourceLinksExpanded ? "1fr" : "0fr",
                          opacity: areResourceLinksExpanded ? 1 : 0,
                          marginTop: areResourceLinksExpanded ? "var(--space-2)" : "0px",
                          transition: "grid-template-rows 240ms ease, opacity 200ms ease, margin-top 200ms ease",
                        }}
                      >
                        <Box style={{ overflow: "hidden" }}>
                          <Flex direction="column" gap="2">
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
                        </Box>
                      </Box>
                    </Box>
                  ) : (
                    <>
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
                  )}
                </>
              ) : null}
            </Card>

            <Card size="4" style={{ flex: 1, minWidth: 0 }}>
              <Heading as="h2" size="6" trim="start">
                CrowdPM Platform
              </Heading>
              <Text size="2" color="gray" mt="2">
                Explore the map or adjust ingest settings across your network.
              </Text>
              <Flex
                direction={{ initial: "column", sm: "row" }}
                align={{ initial: "stretch", sm: "center" }}
                justify="between"
                gap="3"
                mt="4"
              >
                <Flex gap="3">
                  <Button variant={activeTab === "map" ? "solid" : "soft"} onClick={() => setTab("map")}>
                    Map
                  </Button>
                  {isSignedIn ? (
                    <>
                      <Button
                        variant={activeTab === "dashboard" ? "solid" : "soft"}
                        onClick={() => handleProtectedTabClick("dashboard")}
                        disabled={isLoading}
                      >
                        User Dashboard
                      </Button>
                      {canUseSmokeTests ? (
                        <Button
                          variant={activeTab === "smoke" ? "solid" : "soft"}
                          onClick={() => handleProtectedTabClick("smoke")}
                          disabled={isLoading}
                        >
                          Smoke Test
                        </Button>
                      ) : null}
                    </>
                  ) : null}
                </Flex>
                <Flex gap="2" justify="end">
                  {user ? (
                    <Button variant="soft" onClick={handleSignOut}>
                      Sign out
                    </Button>
                  ) : (
                    <>
                      <Button variant="soft" onClick={() => openAuthDialog("login")} disabled={isLoading}>
                        Log in
                      </Button>
                      <Button onClick={() => openAuthDialog("signup")} disabled={isLoading}>
                        Sign up
                      </Button>
                    </>
                  )}
                </Flex>
              </Flex>

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
                      <UserDashboard key={`dashboard:${userScopedKey}`} onRequestActivation={openActivationModal} />
                    ) : activeTab === "smoke" && user && canUseSmokeTests ? (
                      <SmokeTestLab
                        key={`smoke:${userScopedKey}`}
                        onSmokeTestComplete={handleSmokeTestComplete}
                        onSmokeTestCleared={handleSmokeTestCleanup}
                      />
                    ) : activeTab === "map" && user ? (
                      <MapPage
                        key={`map:${userScopedKey}`}
                        pendingSmokeResult={pendingSmokeResult}
                        onSmokeResultConsumed={() => setPendingSmokeResult(null)}
                        pendingCleanupDetail={pendingSmokeCleanup}
                        onCleanupDetailConsumed={() => setPendingSmokeCleanup(null)}
                      />
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
        </Flex>
      </Box>
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
};

function ActivationModal({ open, onOpenChange }: ActivationModalProps) {
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
          <ActivationPage layout="dialog" />
        </Suspense>
      </Dialog.Content>
    </Dialog.Root>
  );
}
