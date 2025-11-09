import { useEffect, useState } from "react";
import MapPage from "./pages/MapPage";
import UserDashboard from "./pages/UserDashboard";
import { AuthDialog, type AuthMode } from "./components/AuthDialog";
import { useAuth } from "./providers/AuthProvider";
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
} from "@radix-ui/themes";
import { GitHubLogoIcon, LinkedInLogoIcon } from "@radix-ui/react-icons";

const TEAM_MEMBERS: Array<{
  name: string;
  role: string;
  github: string;
  linkedin: string;
}> = [
  {
    name: "Jaron Rosenau",
    role: "Team Lead",
    github: "https://github.com/denuoweb",
    linkedin: "https://www.linkedin.com/in/jaronrosenau/",
  },
  {
    name: "Jack Armstrong",
    role: "Team Manager",
    github: "https://github.com/JackArmstrong22",
    linkedin: "https://www.linkedin.com/in/jack-t-armstrong/",
  },
  {
    name: "Skylar Soon",
    role: "Developer",
    github: "https://github.com/skylarsoon",
    linkedin: "https://www.linkedin.com/in/skylar-soon/",
  },
  {
    name: "Mark Sparhawk",
    role: "Developer",
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
    label: "Monorepo",
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
];

export default function App() {
  const { user, isLoading, signOut } = useAuth();
  const userScopedKey = user?.uid ?? "anon";
  const [tab, setTab] = useState<"map" | "dashboard">("map");
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [isAuthDialogOpen, setAuthDialogOpen] = useState(false);

  const activeTab = tab === "dashboard" && !user ? "map" : tab;

  const openAuthDialog = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthDialogOpen(true);
  };

  const handleDashboardClick = () => {
    if (user) {
      setTab("dashboard");
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

  return (
    <Theme appearance="light" accentColor="iris" radius="full" scaling="100%">
      <ThemePanel defaultOpen={false} />
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
                        {member.name}
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
                  <Button variant={activeTab === "dashboard" ? "solid" : "soft"} onClick={handleDashboardClick} disabled={isLoading}>
                    User Dashboard
                  </Button>
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
                    <UserDashboard key={userScopedKey} />
                  ) : (
                    <MapPage key={userScopedKey} />
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
