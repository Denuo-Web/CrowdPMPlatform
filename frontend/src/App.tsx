import { useEffect, useState } from "react";
import MapPage from "./pages/MapPage";
import UserDashboard from "./pages/UserDashboard";
import SmokeTestLab from "./pages/SmokeTestLab";
import { AuthDialog, type AuthMode } from "./components/AuthDialog";
import { useAuth } from "./providers/AuthProvider";
import { ActivationPage } from "./pages/ActivationPage";
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
import { GitHubLogoIcon, LinkedInLogoIcon } from "@radix-ui/react-icons";

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

export default function App() {
  const { user, isLoading, signOut } = useAuth();
  const userScopedKey = user?.uid ?? "anon";
  const [tab, setTab] = useState<"map" | "dashboard" | "smoke">("map");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthDialogOpen, setAuthDialogOpen] = useState(false);
  const initialActivationPath = typeof window !== "undefined" && window.location.pathname.toLowerCase().startsWith("/activate");
  const [isActivationModalOpen, setActivationModalOpen] = useState(initialActivationPath);

  const isSignedIn = Boolean(user);
  const activeTab = !isSignedIn && tab !== "map" ? "map" : tab;

  const openAuthDialog = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthDialogOpen(true);
  };

  const handleProtectedTabClick = (target: "dashboard" | "smoke") => {
    if (user) {
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
    const handler = () => setTab("map");
    window.addEventListener("ingest-smoke-test:completed", handler);
    return () => window.removeEventListener("ingest-smoke-test:completed", handler);
  }, []);

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

  return (
    <Theme appearance="light" accentColor="iris" radius="full" scaling="100%">
      <ThemePanel defaultOpen={false} />
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
            <Card size="4" style={{ flexBasis: "320px", flexShrink: 0 }}>
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
                      <Button
                        variant={activeTab === "smoke" ? "solid" : "soft"}
                        onClick={() => handleProtectedTabClick("smoke")}
                        disabled={isLoading}
                      >
                        Smoke Test
                      </Button>
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
                  {activeTab === "dashboard" && user ? (
                    <UserDashboard key={`dashboard:${userScopedKey}`} onRequestActivation={openActivationModal} />
                  ) : activeTab === "smoke" && user ? (
                    <SmokeTestLab key={`smoke:${userScopedKey}`} />
                  ) : activeTab === "map" && user ? (
                    <MapPage key={`map:${userScopedKey}`} />
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
        <ActivationPage layout="dialog" />
      </Dialog.Content>
    </Dialog.Root>
  );
}
