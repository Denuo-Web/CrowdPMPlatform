import { useState } from "react";
import {
  Box,
  Flex,
  Heading,
  Text,
  Separator,
  Card,
  Link,
} from "@radix-ui/themes";
import {
  LegalDocumentDialog,
  LegalDocumentLink,
  type LegalDocumentId,
} from "../components/LegalDocumentDialog";
import { ExternalLink } from "../components/ExternalLink";
import { APP_ROUTES } from "../lib/appRoutes";
import { PROJECT_LINKS } from "../lib/projectLinks";

type AboutPageProps = {
  onOpenTeamModal: () => void;
};

const HOW_IT_WORKS_STEPS = [
  {
    title: "1. Pair a sensor node",
    description: "Connect a CrowdPM-compatible air quality sensor to your account using our secure device pairing flow.",
  },
  {
    title: "2. Stream measurements",
    description: "Your node automatically collects PM2.5 readings along with GPS coordinates and streams them to the CrowdPM backend.",
  },
  {
    title: "3. Visualize on the map",
    description: "All public measurements appear on the interactive 3D map, color-coded by air quality level.",
  },
  {
    title: "4. Export & share",
    description: "Render flythrough videos of batch data or browse historical measurements from the dashboard.",
  },
] as const;

const TECHNOLOGY_STACK = [
  { label: "Frontend", value: "React, Vite, Radix UI, deck.gl with Google Maps" },
  { label: "Backend", value: "Firebase Cloud Functions (Node.js / TypeScript)" },
  { label: "Database", value: "Cloud Firestore" },
  { label: "Auth", value: "Firebase Authentication + OAuth 2.0 Device Authorization Grant with DPoP" },
  { label: "Hardware", value: "ESP32-based sensor nodes with PM2.5 sensors and GPS modules" },
] as const;

const LEGAL_DOCUMENT_LINKS = [
  { documentId: "terms", label: "Terms of Service" },
  { documentId: "license", label: "License" },
  { documentId: "privacy", label: "Privacy Policy" },
] as const satisfies readonly { documentId: LegalDocumentId; label: string }[];

const SOURCE_NOTICE_LINKS = [
  { href: PROJECT_LINKS.repository, label: "Source code" },
  { href: PROJECT_LINKS.licenseFile, label: "License" },
  { href: PROJECT_LINKS.authorsFile, label: "Authors" },
  { href: PROJECT_LINKS.noticeFile, label: "Notice" },
] as const;

export default function AboutPage({ onOpenTeamModal }: AboutPageProps) {
  const [openLegalDocument, setOpenLegalDocument] = useState<LegalDocumentId | null>(null);

  return (
    <>
      <Flex direction="column" gap="5">
        {/* ---- Hero ---- */}
        <Box>
          <Heading as="h1" size="5">About CrowdPM</Heading>
          <Text size="3" color="gray" mt="2" as="p">
            CrowdPM is an open-source, crowd-sourced air quality monitoring platform
            that visualizes hyper-local particulate matter data on an interactive 3D map.
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
              communities with the granular, hyper-local data they need to make informed decisions
              about the air they breathe.
            </Text>
          </Flex>
        </Card>

        {/* ---- How It Works ---- */}
        <Card>
          <Flex direction="column" gap="3">
            <Heading as="h2" size="4">How It Works</Heading>
            <Flex direction="column" gap="2" pl="2">
              {HOW_IT_WORKS_STEPS.map((step) => (
                <Text key={step.title} size="2" as="p">
                  <strong>{step.title}</strong>&ensp;— {step.description}
                </Text>
              ))}
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
              {TECHNOLOGY_STACK.map((item) => (
                <Text key={item.label} size="2" as="p">
                  • <strong>{item.label}</strong> — {item.value}
                </Text>
              ))}
            </Flex>
          </Flex>
        </Card>

        {/* ---- Origin ---- */}
        <Card>
          <Flex direction="column" gap="3">
            <Heading as="h2" size="4">Origin</Heading>
            <Text size="2" as="p">
              CrowdPM began as an{" "}
              <ExternalLink href={PROJECT_LINKS.capstonePortal} color="iris" highContrast>
                Oregon State University EECS Capstone
              </ExternalLink>{" "}
              project proposed by Jaron Rosenau / Denuo Web LLC. The platform is now maintained
              and operated by Denuo Web LLC and includes contributions from project contributors.
            </Text>
            <Text size="2" as="p">
              The source code is available on{" "}
              <ExternalLink href={PROJECT_LINKS.repository} color="iris" highContrast>
                GitHub
              </ExternalLink>.
            </Text>
            <Text size="2" as="p">
              Meet the people behind the project in the{" "}
              <Link
                href="#team"
                color="iris"
                highContrast
                onClick={(event) => {
                  event.preventDefault();
                  onOpenTeamModal();
                }}
              >
                team overview
              </Link>.
            </Text>
          </Flex>
        </Card>

        {/* ---- Legal ---- */}
        <Card>
          <Flex direction="column" gap="3">
            <Heading as="h2" size="4">Legal</Heading>
            <Text size="2" as="p">
              CrowdPM Platform is open-source software maintained by Denuo Web LLC and contributors.
              Source code is available under GNU AGPLv3-or-later.
            </Text>
            <Flex gap="3" wrap="wrap">
              {SOURCE_NOTICE_LINKS.map((link) => (
                <ExternalLink key={link.href} href={link.href} color="iris" highContrast>
                  {link.label}
                </ExternalLink>
              ))}
            </Flex>
            <Text size="2" as="p">
              Review the hosted service terms, project license summary, and data practices:
            </Text>
            <Flex gap="3" wrap="wrap">
              {LEGAL_DOCUMENT_LINKS.map((document) => (
                <LegalDocumentLink
                  key={document.documentId}
                  documentId={document.documentId}
                  onOpen={setOpenLegalDocument}
                >
                  {document.label}
                </LegalDocumentLink>
              ))}
            </Flex>
          </Flex>
        </Card>

        <Separator size="4" />

        {/* ---- Contact ---- */}
        <Box mb="4">
          <Heading as="h2" size="4" mb="2">Get Involved</Heading>
          <Text size="2" color="gray" as="p">
            Interested in contributing, deploying your own node, or just learning more? Join the{" "}
            <ExternalLink href={PROJECT_LINKS.discord} color="iris" highContrast>
              CrowdPM Discord
            </ExternalLink>{" "}
            or check out the project on{" "}
            <ExternalLink href={PROJECT_LINKS.repository} color="iris" highContrast>
              GitHub
            </ExternalLink>.
          </Text>
          <Text size="2" color="gray" as="p" mt="3">
            The live REST contract is available in the{" "}
            <Link href={APP_ROUTES.apiDocs} color="iris" highContrast>
              Swagger API reference
            </Link>.
          </Text>
        </Box>
      </Flex>
      <LegalDocumentDialog
        documentId={openLegalDocument}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setOpenLegalDocument(null);
        }}
      />
    </>
  );
}
