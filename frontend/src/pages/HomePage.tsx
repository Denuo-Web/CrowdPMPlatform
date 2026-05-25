import { Box, Button, Card, Flex, Heading, Separator, Text } from "@radix-ui/themes";
import { ExternalLink } from "../components/ExternalLink";
import { PROJECT_LINKS } from "../lib/projectLinks";

type HomePageProps = {
  isSignedIn: boolean;
  onExploreMap: () => void;
  onOpenDashboard: () => void;
  onOpenActivation: () => void;
  onOpenAbout: () => void;
  onOpenProducts: () => void;
  onOpenAuth: (mode: "login" | "signup") => void;
};

const HIGHLIGHTS = [
  {
    title: "Public 3D map",
    description: "Browse shared PM2.5 measurements from the dedicated live map experience.",
  },
  {
    title: "Conditional node launch",
    description: "Reserve first-run hardware or support FCC testing without implying immediate shipment.",
  },
  {
    title: "Batch exports",
    description: "Review historical runs, select measurement timelines, and render flythrough videos when you need them.",
  },
  {
    title: "Open source stack",
    description: "React, Firebase, and ESP32-based hardware with public source, license, and contributor attribution.",
  },
] as const;

const WORKFLOW_STEPS = [
  {
    title: "Collect local data",
    description: "Deploy a compatible node to sample PM2.5, GPS, and supporting environmental telemetry in the places you actually care about.",
  },
  {
    title: "Review and publish",
    description: "Inspect device batches in your dashboard, keep sensitive runs private, and choose which measurements should appear publicly.",
  },
  {
    title: "Share context",
    description: "Open the live map, compare public batches, and export movement traces that are easier to explain than raw coordinates alone.",
  },
] as const;

export default function HomePage({
  isSignedIn,
  onExploreMap,
  onOpenDashboard,
  onOpenActivation,
  onOpenAbout,
  onOpenProducts,
  onOpenAuth,
}: HomePageProps) {
  return (
    <Flex direction="column" gap="6">
      <Card
        style={{
          overflow: "hidden",
          background:
            "radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--accent-9) 22%, transparent), transparent 52%), "
            + "radial-gradient(90% 120% at 100% 0%, color-mix(in srgb, var(--gray-8) 18%, transparent), transparent 60%), "
            + "linear-gradient(180deg, color-mix(in srgb, var(--color-panel-solid) 98%, transparent), color-mix(in srgb, var(--color-panel-solid) 94%, var(--gray-2)))",
          border: "1px solid var(--gray-a5)",
        }}
      >
        <Flex direction="column" gap="5" style={{ padding: "var(--space-6)" }}>
          <Flex direction="column" gap="3" style={{ maxWidth: 760 }}>
            <Text
              size="1"
              weight="bold"
              style={{
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--accent-11)",
              }}
            >
              Community air quality intelligence
            </Text>
            <Heading as="h1" size="8" style={{ lineHeight: 1.02, maxWidth: 720 }}>
              Hyper-local PM2.5 mapping, now funding the first authorized node run.
            </Heading>
            <Text size="3" color="gray" as="p" style={{ maxWidth: 680 }}>
              CrowdPM combines open hardware, account-scoped activation, public measurement publishing,
              and a 3D map for community air quality data. Expo payments are structured as certification
              support or conditional reservations that ship only after FCC authorization.
            </Text>
          </Flex>

          <Flex gap="3" wrap="wrap">
            <Button size="4" onClick={onExploreMap}>
              Explore live map
            </Button>
            {isSignedIn ? (
              <>
                <Button size="4" variant="soft" onClick={onOpenDashboard}>
                  Open dashboard
                </Button>
                <Button size="4" variant="outline" onClick={onOpenActivation}>
                  Activate a node
                </Button>
              </>
            ) : (
              <>
                <Button size="4" variant="soft" onClick={() => onOpenAuth("signup")}>
                  Create account
                </Button>
                <Button size="4" variant="outline" onClick={() => onOpenAuth("login")}>
                  Log in
                </Button>
              </>
            )}
          </Flex>

          <Flex gap="3" wrap="wrap">
            <Button variant="ghost" onClick={onOpenProducts}>
              Reserve or support
            </Button>
            <Button variant="ghost" onClick={onOpenAbout}>
              Learn about the project
            </Button>
            <Text size="2" color="gray" as="p">
              Source on{" "}
              <ExternalLink href={PROJECT_LINKS.repository} color="iris" highContrast>
                GitHub
              </ExternalLink>
              {" "}and community support on{" "}
              <ExternalLink href={PROJECT_LINKS.discord} color="iris" highContrast>
                Discord
              </ExternalLink>
              .
            </Text>
          </Flex>
        </Flex>
      </Card>

      <Flex gap="4" wrap="wrap">
        {HIGHLIGHTS.map((highlight) => (
          <Card key={highlight.title} style={{ flex: "1 1 240px", minWidth: 0 }}>
            <Flex direction="column" gap="2">
              <Heading as="h2" size="4">{highlight.title}</Heading>
              <Text size="2" color="gray" as="p">{highlight.description}</Text>
            </Flex>
          </Card>
        ))}
      </Flex>

      <Separator size="4" />

      <Box>
        <Heading as="h2" size="5" mb="3">How CrowdPM works</Heading>
        <Flex gap="4" wrap="wrap">
          {WORKFLOW_STEPS.map((step, index) => (
            <Card key={step.title} style={{ flex: "1 1 280px", minWidth: 0 }}>
              <Flex direction="column" gap="3">
                <Text
                  size="1"
                  weight="bold"
                  style={{
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--accent-11)",
                  }}
                >
                  Step {index + 1}
                </Text>
                <Heading as="h3" size="4">{step.title}</Heading>
                <Text size="2" color="gray" as="p">{step.description}</Text>
              </Flex>
            </Card>
          ))}
        </Flex>
      </Box>

      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Explore the platform</Heading>
          <Text size="2" color="gray" as="p">
            Start with project context, hardware guidance, and account entry points here, then open the live map when
            you want to explore measurements directly.
          </Text>
          <Text size="2" color="gray" as="p">
            The full 3D map, dashboard, activation flow, and hardware documentation remain available from the routes above.
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
}
