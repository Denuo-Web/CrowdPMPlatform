import {
  Box,
  Card,
  Flex,
  Heading,
  Separator,
  Text,
} from "@radix-ui/themes";

export default function NodePage() {
  return (
    <Flex direction="column" gap="5">
      {/* ---- Hero ---- */}
      <Box>
        <Heading as="h1" size="5">Node Hardware</Heading>
        <Text size="3" color="gray" mt="2" as="p">
          Everything you need to know about building, configuring, and deploying a
          CrowdPM sensor node.
        </Text>
      </Box>

      <Separator size="4" />

      {/* ---- Overview ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Overview</Heading>
          <Text size="2" color="gray" as="p">
            Details about the CrowdPM sensor node hardware will be added here by the hardware team.
          </Text>
        </Flex>
      </Card>

      {/* ---- Components ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Components</Heading>
          <Text size="2" color="gray" as="p">
            A bill of materials and component specifications will be listed here.
          </Text>
        </Flex>
      </Card>

      {/* ---- Assembly ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Assembly</Heading>
          <Text size="2" color="gray" as="p">
            Step-by-step assembly instructions will be documented here.
          </Text>
        </Flex>
      </Card>

      {/* ---- Firmware ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Firmware</Heading>
          <Text size="2" color="gray" as="p">
            Firmware flashing and configuration instructions will be provided here.
          </Text>
        </Flex>
      </Card>

      {/* ---- Troubleshooting ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Troubleshooting</Heading>
          <Text size="2" color="gray" as="p">
            Common hardware issues and their solutions will be documented here.
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
}
