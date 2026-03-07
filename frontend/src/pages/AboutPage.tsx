import {
  Box,
  Flex,
  Heading,
  Text,
  Separator,
  Card,
  Link,
} from "@radix-ui/themes";

export default function AboutPage() {
  return (
    <Flex direction="column" gap="5">
      {/* ---- Hero ---- */}
      <Box>
        <Heading as="h1" size="5">About CrowdPM</Heading>
        <Text size="3" color="gray" mt="2" as="p">
          CrowdPM is an open-source, crowd-sourced air quality monitoring platform
          that visualizes real-time PM2.5 data on an interactive 3D map.
        </Text>
      </Box>

      <Separator size="4" />

      {/* ---- Mission ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Our Mission</Heading>
          <Text size="2" as="p">
            Air quality affects everyone, but monitoring data is often sparse, expensive to access,
            or locked behind proprietary systems. CrowdPM aims to democratize air quality awareness
            by making it easy for anyone with a low-cost sensor node to contribute measurements to
            a shared, publicly accessible dataset.
          </Text>
          <Text size="2" as="p">
            By combining crowd-sourced hardware with modern web visualization, we provide
            communities with the granular, real-time data they need to make informed decisions
            about the air they breathe.
          </Text>
        </Flex>
      </Card>

      {/* ---- How It Works ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">How It Works</Heading>
          <Flex direction="column" gap="2" pl="2">
            <Text size="2" as="p">
              <strong>1. Pair a sensor node</strong>&ensp;— Connect a CrowdPM-compatible air quality
              sensor to your account using our secure device pairing flow.
            </Text>
            <Text size="2" as="p">
              <strong>2. Stream measurements</strong>&ensp;— Your node automatically collects PM2.5
              readings along with GPS coordinates and streams them to the CrowdPM backend.
            </Text>
            <Text size="2" as="p">
              <strong>3. Visualize on the map</strong>&ensp;— All public measurements appear on the
              interactive 3D map in near real-time, color-coded by air quality level.
            </Text>
            <Text size="2" as="p">
              <strong>4. Export &amp; share</strong>&ensp;— Render flythrough videos of batch data or
              browse historical measurements from the dashboard.
            </Text>
          </Flex>
        </Flex>
      </Card>

      {/* ---- Technology ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Technology</Heading>
          <Text size="2" as="p">
            CrowdPM is built with a modern, open-source stack:
          </Text>
          <Flex direction="column" gap="1" pl="2">
            <Text size="2" as="p">• <strong>Frontend</strong> — React, Vite, Radix UI, deck.gl with Google Maps</Text>
            <Text size="2" as="p">• <strong>Backend</strong> — Firebase Cloud Functions (Node.js / TypeScript)</Text>
            <Text size="2" as="p">• <strong>Database</strong> — Cloud Firestore</Text>
            <Text size="2" as="p">• <strong>Auth</strong> — Firebase Authentication + OAuth 2.0 Device Authorization Grant with DPoP</Text>
            <Text size="2" as="p">• <strong>Hardware</strong> — ESP32-based sensor nodes with PM2.5 sensors and GPS modules</Text>
          </Flex>
        </Flex>
      </Card>

      {/* ---- Origin ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Origin</Heading>
          <Text size="2" as="p">
            CrowdPM began as an{" "}
            <Link
              href="https://eecs.engineering.oregonstate.edu/capstone/submission/pages/viewSingleProject.php?id=WHBsGlAFvH7HrCiH"
              target="_blank"
              rel="noreferrer"
              color="iris"
              highContrast
            >
              Oregon State University EECS Capstone
            </Link>{" "}
            project. The platform is actively developed and maintained as an open-source effort.
          </Text>
          <Text size="2" as="p">
            The source code is available on{" "}
            <Link
              href="https://github.com/Denuo-Web/CrowdPMPlatform/"
              target="_blank"
              rel="noreferrer"
              color="iris"
              highContrast
            >
              GitHub
            </Link>.
          </Text>
        </Flex>
      </Card>

      <Separator size="4" />

      {/* ---- Contact ---- */}
      <Box mb="4">
        <Heading as="h2" size="4" mb="2">Get Involved</Heading>
        <Text size="2" color="gray" as="p">
          Interested in contributing, deploying your own node, or just learning more? Join the{" "}
          <Link
            href="https://discord.gg/cEbGw8HAUQ"
            target="_blank"
            rel="noreferrer"
            color="iris"
            highContrast
          >
            CrowdPM Discord
          </Link>{" "}
          or check out the project on{" "}
          <Link
            href="https://github.com/Denuo-Web/CrowdPMPlatform/"
            target="_blank"
            rel="noreferrer"
            color="iris"
            highContrast
          >
            GitHub
          </Link>.
        </Text>
      </Box>
    </Flex>
  );
}
