import { useState } from "react";
import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Separator,
  Text,
} from "@radix-ui/themes";
import {
  ChevronDownIcon,
  InfoCircledIcon,
} from "@radix-ui/react-icons";

type PairingInfoPageProps = {
  onOpenActivation?: () => void;
};

/* ------------------------------------------------------------------ */
/*  Inline SVG flow diagram                                           */
/* ------------------------------------------------------------------ */

function FlowDiagram() {
  return (
    <Box style={{ width: "100%", overflowX: "auto" }}>
      <svg
        viewBox="0 0 720 310"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ width: "100%", maxWidth: 720, display: "block", margin: "0 auto" }}
        role="img"
        aria-label="Pairing flow diagram showing the interaction between a sensor node, the CrowdPM server, and your browser"
      >
        {/* --- background --- */}
        <rect rx="16" width="720" height="310" fill="var(--gray-a3)" />

        {/* --- actor boxes --- */}
        {/* Sensor Node */}
        <rect x="30" y="20" rx="12" width="160" height="56" fill="var(--accent-a4)" stroke="var(--accent-8)" strokeWidth="1.5" />
        <text x="110" y="46" textAnchor="middle" fill="var(--accent-11)" fontSize="13" fontWeight="600">Sensor Node</text>
        <text x="110" y="62" textAnchor="middle" fill="var(--gray-11)" fontSize="10">(your hardware)</text>

        {/* CrowdPM Server */}
        <rect x="280" y="20" rx="12" width="160" height="56" fill="var(--gray-a4)" stroke="var(--gray-8)" strokeWidth="1.5" />
        <text x="360" y="46" textAnchor="middle" fill="var(--gray-12)" fontSize="13" fontWeight="600">CrowdPM Server</text>
        <text x="360" y="62" textAnchor="middle" fill="var(--gray-11)" fontSize="10">(cloud backend)</text>

        {/* Your Browser */}
        <rect x="530" y="20" rx="12" width="160" height="56" fill="var(--accent-a4)" stroke="var(--accent-8)" strokeWidth="1.5" />
        <text x="610" y="46" textAnchor="middle" fill="var(--accent-11)" fontSize="13" fontWeight="600">Your Browser</text>
        <text x="610" y="62" textAnchor="middle" fill="var(--gray-11)" fontSize="10">(activation page)</text>

        {/* --- step 1: node → server --- */}
        <line x1="190" y1="105" x2="270" y2="105" stroke="var(--accent-9)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="30" cy="105" r="12" fill="var(--accent-9)" />
        <text x="30" y="109" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">1</text>
        <text x="50" y="100" fill="var(--gray-12)" fontSize="11" fontWeight="500">Node requests</text>
        <text x="50" y="114" fill="var(--gray-11)" fontSize="10">pairing session</text>

        {/* --- step 2: server → node (user code) --- */}
        <line x1="270" y1="155" x2="190" y2="155" stroke="var(--accent-9)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="300" cy="155" r="12" fill="var(--accent-9)" />
        <text x="300" y="159" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">2</text>
        <text x="320" y="150" fill="var(--gray-12)" fontSize="11" fontWeight="500">Server returns</text>
        <text x="320" y="164" fill="var(--gray-11)" fontSize="10">user code (e.g. ABCD-EFGH-J)</text>

        {/* --- step 3: you enter code in browser --- */}
        <line x1="440" y1="105" x2="520" y2="105" stroke="var(--accent-9)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="480" cy="105" r="12" fill="var(--accent-9)" />
        <text x="480" y="109" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">3</text>
        <text x="540" y="100" fill="var(--gray-12)" fontSize="11" fontWeight="500">You enter code</text>
        <text x="540" y="114" fill="var(--gray-11)" fontSize="10">&amp; approve device</text>

        {/* --- step 4: browser → server (authorize) --- */}
        <line x1="520" y1="205" x2="440" y2="205" stroke="var(--accent-9)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="560" cy="205" r="12" fill="var(--accent-9)" />
        <text x="560" y="209" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">4</text>
        <text x="580" y="200" fill="var(--gray-12)" fontSize="11" fontWeight="500">Authorization</text>
        <text x="580" y="214" fill="var(--gray-11)" fontSize="10">sent to server</text>

        {/* --- step 5: node polls & gets token --- */}
        <line x1="270" y1="255" x2="190" y2="255" stroke="var(--accent-9)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="300" cy="255" r="12" fill="var(--accent-9)" />
        <text x="300" y="259" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">5</text>
        <text x="320" y="250" fill="var(--gray-12)" fontSize="11" fontWeight="500">Node receives token</text>
        <text x="320" y="264" fill="var(--gray-11)" fontSize="10">&amp; registers with server</text>

        {/* --- step 6: node streams data --- */}
        <line x1="190" y1="290" x2="270" y2="290" stroke="var(--accent-9)" strokeWidth="1.5" markerEnd="url(#arrow)" />
        <circle cx="110" cy="290" r="12" fill="var(--accent-9)" />
        <text x="110" y="294" textAnchor="middle" fill="white" fontSize="10" fontWeight="700">6</text>
        <text x="134" y="294" fill="var(--gray-12)" fontSize="11" fontWeight="500">Node streams air-quality data ✓</text>

        {/* arrowhead marker */}
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-9)" />
          </marker>
        </defs>
      </svg>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Step card helper                                                  */
/* ------------------------------------------------------------------ */

function StepCard({ step, title, description }: { step: number; title: string; description: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 200 }}>
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <Flex
            align="center"
            justify="center"
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              backgroundColor: "var(--accent-9)",
              color: "white",
              fontSize: "var(--font-size-2)",
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {step}
          </Flex>
          <Heading as="h3" size="3">{title}</Heading>
        </Flex>
        <Text size="2" color="gray">{description}</Text>
      </Flex>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                         */
/* ------------------------------------------------------------------ */

export default function PairingInfoPage({ onOpenActivation }: PairingInfoPageProps) {
  const [showTechnical, setShowTechnical] = useState(false);

  return (
    <Flex
      direction="column"
      gap="5"
      style={{ maxWidth: 780, margin: "0 auto" }}
    >
      {/* ---- Hero ---- */}
      <Box>
        <Heading as="h1" size="7">How to Pair a Node</Heading>
        <Text size="3" color="gray" mt="2" as="p">
          Pairing connects your air-quality sensor to your CrowdPM account so it can
          securely stream measurements to the platform. The process takes about two
          minutes and only needs to be done once per device.
        </Text>
      </Box>

      <Separator size="4" />

      {/* ---- What you need ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">What you&apos;ll need</Heading>
          <Flex direction="column" gap="2" pl="2">
            <Text size="2" as="p">
              <strong>1.</strong>&ensp;A CrowdPM-compatible sensor node, powered on and connected to the internet.
            </Text>
            <Text size="2" as="p">
              <strong>2.</strong>&ensp;A CrowdPM account&nbsp;— sign up or log in from the top bar if you haven&apos;t already.
            </Text>
            <Text size="2" as="p">
              <strong>3.</strong>&ensp;A web browser on any device (phone, laptop, tablet).
            </Text>
          </Flex>
        </Flex>
      </Card>

      {/* ---- Step-by-step ---- */}
      <Box>
        <Heading as="h2" size="5" mb="3">Step-by-step</Heading>
        <Flex direction="column" gap="3">
          <Flex gap="3" wrap="wrap">
            <StepCard
              step={1}
              title="Power on your node"
              description="Plug in the sensor and let it boot. It will automatically connect to Wi-Fi and contact the CrowdPM server to start a pairing session."
            />
            <StepCard
              step={2}
              title="Read the pairing code"
              description="The node's display (or serial output) shows a short user code, for example ABCD-EFGH-J. This code is valid for 15 minutes."
            />
          </Flex>
          <Flex gap="3" wrap="wrap">
            <StepCard
              step={3}
              title="Enter the code on CrowdPM"
              description="Open the Activation page, sign in, and type the code. You'll see the device's model, firmware version, and a unique fingerprint."
            />
            <StepCard
              step={4}
              title="Approve the device"
              description="Verify the details match your hardware and click 'Authorize device.' The node detects approval within seconds and begins streaming data."
            />
          </Flex>
        </Flex>
      </Box>

      <Separator size="4" />

      {/* ---- Flow diagram ---- */}
      <Box>
        <Heading as="h2" size="5" mb="3">How it works</Heading>
        <Text size="2" color="gray" mb="3" as="p">
          The diagram below shows the message flow between your sensor node, the CrowdPM
          server, and your browser during the pairing process.
        </Text>
        <FlowDiagram />
      </Box>

      <Separator size="4" />

      {/* ---- Troubleshooting ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Heading as="h2" size="4">Troubleshooting</Heading>
          <Flex direction="column" gap="2" pl="2">
            <Text size="2" as="p">
              <strong>Code expired?</strong>&ensp;Power-cycle the node to generate a fresh pairing code. Sessions last 15 minutes.
            </Text>
            <Text size="2" as="p">
              <strong>Code not appearing?</strong>&ensp;Make sure the node has internet access and the LED / display is functioning.
            </Text>
            <Text size="2" as="p">
              <strong>&quot;Session not found&quot;?</strong>&ensp;Double-check for typos. The code uses capital letters and a dash (e.g.&nbsp;<code style={{ fontFamily: "var(--code-font-family)" }}>ABCD-EFGH-J</code>).
            </Text>
            <Text size="2" as="p">
              <strong>Still stuck?</strong>&ensp;Reach out on the{" "}
              <a href="https://discord.gg/cEbGw8HAUQ" target="_blank" rel="noreferrer" style={{ color: "var(--accent-11)" }}>
                CrowdPM Discord
              </a>.
            </Text>
          </Flex>
        </Flex>
      </Card>

      {/* ---- Technical details (expandable) ---- */}
      <Card>
        <Flex direction="column" gap="3">
          <Flex
            align="center"
            justify="between"
            style={{ cursor: "pointer", userSelect: "none" }}
            onClick={() => setShowTechnical((prev) => !prev)}
            role="button"
            tabIndex={0}
            aria-expanded={showTechnical}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setShowTechnical((prev) => !prev);
              }
            }}
          >
            <Heading as="h2" size="4">Technical details</Heading>
            <ChevronDownIcon
              width={20}
              height={20}
              style={{
                transition: "transform 200ms ease",
                transform: showTechnical ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </Flex>

          {showTechnical ? (
            <Flex direction="column" gap="3">
              <Text size="2" as="p" color="gray">
                Under the hood, CrowdPM pairing follows a variant of the{" "}
                <strong>OAuth 2.0 Device Authorization Grant</strong> (RFC 8628) extended with{" "}
                <strong>DPoP</strong> (Demonstration of Proof-of-Possession) for hardware-bound tokens.
              </Text>

              <Callout.Root color="gray" variant="surface">
                <Callout.Icon>
                  <InfoCircledIcon />
                </Callout.Icon>
                <Callout.Text size="2">
                  You don&apos;t need to understand these details to pair a node — they&apos;re included
                  for transparency and for developers integrating custom hardware.
                </Callout.Text>
              </Callout.Root>

              <Box pl="2">
                <Heading as="h3" size="3" mb="2">Full lifecycle</Heading>
                <Flex direction="column" gap="2">
                  <Text size="2" as="p">
                    <strong>1. Key generation</strong>&ensp;— The node boots with an Ed25519 key pair. A
                    short <em>fingerprint</em> derived from the public key is shown on the display for visual verification.
                  </Text>
                  <Text size="2" as="p">
                    <strong>2. Session creation</strong>&ensp;— The node calls <code style={{ fontFamily: "var(--code-font-family)" }}>POST /v1/device-pairing/start</code> with
                    its model, firmware version, and DPoP proof. The server returns a <em>user code</em>, a <em>device code</em>,
                    and a 15-minute TTL.
                  </Text>
                  <Text size="2" as="p">
                    <strong>3. Human approval</strong>&ensp;— The device owner enters the user code on the
                    Activation page. The server shows the device metadata so the owner can confirm the fingerprint matches.
                  </Text>
                  <Text size="2" as="p">
                    <strong>4. Polling</strong>&ensp;— The node polls <code style={{ fontFamily: "var(--code-font-family)" }}>POST /v1/device-pairing/poll</code> with
                    its device code and a fresh DPoP proof. Once the owner approves, the server responds with
                    a short-lived <em>registration token</em>.
                  </Text>
                  <Text size="2" as="p">
                    <strong>5. Hardware registration</strong>&ensp;— The node calls <code style={{ fontFamily: "var(--code-font-family)" }}>POST /v1/device-pairing/register</code> with
                    the registration token and its long-term public key. The server returns a
                    permanent <em>device ID</em>.
                  </Text>
                  <Text size="2" as="p">
                    <strong>6. Token minting</strong>&ensp;— For every subsequent session the node
                    calls <code style={{ fontFamily: "var(--code-font-family)" }}>POST /v1/device-pairing/token</code> to
                    obtain 10-minute DPoP-bound access tokens.
                  </Text>
                  <Text size="2" as="p">
                    <strong>7. Data streaming</strong>&ensp;— The node submits air-quality readings
                    to the HTTPS ingest gateway using its access token.
                  </Text>
                </Flex>
              </Box>

              <Box pl="2" mt="2">
                <Heading as="h3" size="3" mb="2">Security properties</Heading>
                <Flex direction="column" gap="1">
                  <Text size="2" as="p">
                    • Tokens are <strong>DPoP-bound</strong> — stolen tokens are useless without the private key on the device.
                  </Text>
                  <Text size="2" as="p">
                    • The <strong>fingerprint</strong> lets you visually verify the device&apos;s identity before approving.
                  </Text>
                  <Text size="2" as="p">
                    • Pairing sessions expire after <strong>15 minutes</strong> and can only be redeemed once.
                  </Text>
                  <Text size="2" as="p">
                    • Rate limiting is applied per-IP, per-ASN, per-model, and globally to prevent abuse.
                  </Text>
                </Flex>
              </Box>
            </Flex>
          ) : null}
        </Flex>
      </Card>

      {/* ---- CTA ---- */}
      {onOpenActivation ? (
        <Flex justify="center" gap="3" mt="2" mb="4">
          <Button size="3" onClick={onOpenActivation}>
            Open activation page
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
}
