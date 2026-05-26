import { useState, type ReactNode } from "react";
import {
  Box,
  Badge,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
  Select,
  Separator,
  Tabs,
  Text,
} from "@radix-ui/themes";
import { ExternalLink } from "../components/ExternalLink";
import { InternalNewTabAnchor } from "../components/InternalLink";
import {
  LegalDocumentDialog,
  LegalDocumentLink,
  type LegalDocumentId,
} from "../components/LegalDocumentDialog";
import { APP_ROUTES } from "../lib/appRoutes";
import { createNodeCampaignCheckoutSession, type NodeCampaignTierId } from "../lib/api";
import { useBrowserLocation } from "../lib/locationStore";

type SectionProps = {
  title: string;
  children: ReactNode;
};

type TableProps = {
  headers: string[];
  rows: ReactNode[][];
};

const BASE_NODE_PRICE_CENTS = 37_500;
const CERTIFICATION_SUPPORT_UNIT_CENTS = 2_500;
const NODE_QUANTITY_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);
const SUPPORT_QUANTITY_OPTIONS = Array.from({ length: 10 }, (_, index) => index + 1);
const FCC_REFUND_CHECKPOINT_LABEL = "December 31, 2026";

const ZERO_2_W_URL = "https://www.amazon.com/Raspberry-Heatsink-Adapter-Quad-core-Bluetooth/dp/B0DRRDJKDV?crid=3VRASN6F43J3I&dib=eyJ2IjoiMSJ9.t-BTW30Tluhki6lWlHIi2rulYzLQMAGFk2OvRz-XBQTYgqnJ_G_aL00we8CvIVnKwG2Qc75itVV_M0bpyBUc5YG3r7ovACXMTrtlMTUUnZBffQIiEHNn3Yqk-Chei1tyWsoAB2tTea-NTY83Z_QJUq5-3JfgkUiz0PjutePcLmnkuMuu_IWzavyrhKUNrUjTEI8BgTUNhwVf1epqDu2ahFmxjLDI5xaFLi5SgdjHoeg.dYFNm35Nc1V43vvTuZ8pC5dQ-abvmafEYOYXJh8E5Ss&dib_tag=se&keywords=raspberry%2Bpi%2Bzero%2B2%2Bw&qid=1778398787&sprefix=Raspberry%2BPi%2BZero%2B2%2BW%2Caps%2C178&sr=8-2-spons&sp_csd=d2lkZ2V0TmFtZT1zcF9hdGY&th=1&linkCode=ll2&tag=lipbalm01-20&linkId=35363b709757db3d01baa6b973c52a01&language=en_US&ref_=as_li_ss_tl";
const PMS5003_URL = "https://www.amazon.com/BestParts-Digital-Particle-Concentration-PMS5003/dp/B0B1DQKV4N?crid=2CSK1VIYBL9LN&dib=eyJ2IjoiMSJ9.98U0BdlWh4vmYk-feCR0PmZpSTwOza-Io1F0J5aEYxt-Atifz_ulAtN2MSfswsFSwZAY5G94uyuiJwZQ1pJEgEFX1HBloSTDsFit2N07xKk13LTq4uwQ5LAGvFMMuUeWH2nLcVwe2SqFNb96Kn75VRFoIWku34vnGX3ryzbO4xgpcNSnNDH7QmqgRqu-KYCsnv1gNizUAnlnmoc22RpGTvxNFB4H45LOk2Hf_kqlcO8.l0Rt1mD9IbbwGvgp5ZFUzZgF46xGdPN76S6jbwz8CLE&dib_tag=se&keywords=Plantower+PMS5003&qid=1778398886&sprefix=plantower+pms5003%2Caps%2C225&sr=8-4&linkCode=ll2&tag=lipbalm01-20&linkId=7eb62de9f07d2cf0f66b47bb7349e0db&language=en_US&ref_=as_li_ss_tl";
const DHT22_URL = "https://www.amazon.com/dp/B0DSW7D3S9?th=1&linkCode=ll2&tag=lipbalm01-20&linkId=8a2b4c580bdeb37c7affe8f834a72a28&language=en_US&ref_=as_li_ss_tl";
const GPS_BREAKOUT_URL = "https://www.adafruit.com/product/5440";
const SD_CARD_URL = "https://www.amazon.com/SanDisk-Ultra-microSDHC-Memory-Adapter/dp/B08GY9NYRM?crid=2KSLXNGFQ6QTU&dib=eyJ2IjoiMSJ9.cC5cEhilIJZ8uIFkRCnkltIEzWQtFgQq-85a7sC5zOBuxlNn7kV6Acl2AEPksDanzwUdhsAYtVHVcpBMsxrySYzrIn8iKKPReGo-n6Sm25xY5h_s3gxOBvxB6biVeYvbSVMpdqq0V04ys73DryoywF8MfCrJ0bFo5CPk8JW5oaqJQVcZYqtWJvDbeCPKeUUgPqh7fX4boOjRY1ycBDPa5Q.mpsFJuv4tSWFqRD0s4gHz8UtruEG4l92pbms5TJAAjU&dib_tag=se&keywords=sandisk%2Bextreme%2B32%2Bsd&qid=1778531180&sprefix=sandisk%2Bextreme%2B%2Bsd%2Caps%2C491&xpid=Z4LCntxaYnMES&th=1&linkCode=ll2&tag=lipbalm01-20&linkId=ecb68eedf02441ad989f4b465c8037ba&language=en_US&ref_=as_li_ss_tl";
const USB_TO_TTL_URL = "https://www.amazon.com/dp/B0G61569JG?th=1&linkCode=ll2&tag=lipbalm01-20&linkId=5e49b7bc297b33e721e671312e45f1a1&language=en_US&ref_=as_li_ss_tl";
const OTG_ADAPTER_URL = "https://www.amazon.com/dp/B015GZLG8I?th=1&linkCode=ll2&tag=lipbalm01-20&linkId=d31fc458d54c90c0e3a7ef69edccad08&language=en_US&ref_=as_li_ss_tl";
const LINE_CABLES_URL = "https://www.amazon.com/dp/B08YRGVYPV?th=1&linkCode=ll2&tag=lipbalm01-20&linkId=0e64e274f6524982c4806f74982744e0&language=en_US&ref_=as_li_ss_tl";
const NODE_PRODUCT_LABEL = "Founding node reservation";
const NODE_PRODUCT_SUMMARY = "Conditional reservation for the standard PM2.5 node with PMS5003, GPS, temperature/humidity, local storage, and USB micro power input.";

const USD_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatUsd(cents: number): string {
  return USD_FORMATTER.format(cents / 100);
}

function Section({ title, children }: SectionProps) {
  return (
    <Card>
      <Flex direction="column" gap="3">
        <Heading as="h2" size="4">
          {title}
        </Heading>
        {children}
      </Flex>
    </Card>
  );
}

function Subsection({ title, children }: SectionProps) {
  return (
    <Box>
      <Heading as="h3" size="3" mb="2">
        {title}
      </Heading>
      <Flex direction="column" gap="2">
        {children}
      </Flex>
    </Box>
  );
}

function BulletList({ children }: { children: ReactNode }) {
  return (
    <Box
      asChild
      style={{
        margin: 0,
        paddingLeft: "1.25rem",
      }}
    >
      <ul>{children}</ul>
    </Box>
  );
}

function ListItem({ children }: { children: ReactNode }) {
  return (
    <li>
      <Text size="2" color="gray" as="span">
        {children}
      </Text>
    </li>
  );
}

function PartLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <ExternalLink href={href} color="iris" highContrast>
      {children}
    </ExternalLink>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  return (
    <Box
      asChild
      style={{
        overflowX: "auto",
        borderRadius: "8px",
        padding: "0.875rem",
        background: "var(--gray-3)",
      }}
    >
      <pre>
        <code
          style={{
            whiteSpace: "pre",
            fontSize: "var(--font-size-1)",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          {children}
        </code>
      </pre>
    </Box>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code
      style={{
        borderRadius: "4px",
        padding: "0.1rem 0.3rem",
        background: "var(--gray-3)",
        fontSize: "var(--font-size-1)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    >
      {children}
    </code>
  );
}

function InfoTable({ headers, rows }: TableProps) {
  return (
    <Box style={{ overflowX: "auto" }}>
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "0.875rem",
        }}
      >
        <thead>
          <tr>
            {headers.map((header) => (
              <th
                key={header}
                style={{
                  textAlign: "left",
                  padding: "0.625rem",
                  borderBottom: "1px solid var(--gray-6)",
                  color: "var(--gray-12)",
                }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{
                    verticalAlign: "top",
                    padding: "0.625rem",
                    borderBottom: "1px solid var(--gray-5)",
                    color: "var(--gray-11)",
                  }}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}

function ProductGallery() {
  const photos = ["Front", "Ports", "Mounted", "Kit"];
  return (
    <Flex direction="column" gap="3" style={{ minWidth: 0 }}>
      <Box
        style={{
          aspectRatio: "4 / 3",
          border: "1px solid var(--gray-a6)",
          borderRadius: "8px",
          background:
            "linear-gradient(135deg, var(--gray-2), var(--gray-4) 58%, var(--accent-a3))",
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            width: "48%",
            maxWidth: "18rem",
            aspectRatio: "1 / 1",
            border: "1px solid var(--gray-a7)",
            borderRadius: "8px",
            background: "var(--color-panel-solid)",
            boxShadow: "0 18px 45px var(--gray-a5)",
            position: "relative",
          }}
        >
          <Box
            style={{
              position: "absolute",
              inset: "18%",
              borderRadius: "6px",
              border: "1px solid var(--gray-a6)",
              background: "var(--gray-2)",
            }}
          />
          <Box
            style={{
              position: "absolute",
              right: "14%",
              bottom: "14%",
              width: "22%",
              aspectRatio: "1 / 1",
              borderRadius: "999px",
              background: "var(--green-9)",
            }}
          />
        </Box>
      </Box>
      <Flex gap="2" wrap="wrap">
        {photos.map((label, index) => (
          <Box
            key={label}
            style={{
              flex: "1 1 5.5rem",
              minWidth: "5.5rem",
              aspectRatio: "1 / 1",
              border: index === 0 ? "2px solid var(--accent-8)" : "1px solid var(--gray-a6)",
              borderRadius: "8px",
              background: "var(--gray-3)",
              display: "grid",
              placeItems: "center",
            }}
          >
            <Text size="1" color="gray">{label}</Text>
          </Box>
        ))}
      </Flex>
    </Flex>
  );
}

type CheckoutNotice = "success" | "cancelled" | null;

function readCheckoutNotice(search: string): CheckoutNotice {
  const status = new URLSearchParams(search).get("checkout");
  return status === "success" || status === "cancelled" ? status : null;
}

export default function NodePage() {
  const location = useBrowserLocation();
  const [activeCheckoutTier, setActiveCheckoutTier] = useState<NodeCampaignTierId | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const checkoutNotice = readCheckoutNotice(location.search);
  const [openLegalDocument, setOpenLegalDocument] = useState<LegalDocumentId | null>(null);
  const [reservationQuantity, setReservationQuantity] = useState(1);
  const [supportUnits, setSupportUnits] = useState(1);
  const reservationSubtotalCents = BASE_NODE_PRICE_CENTS * reservationQuantity;
  const supportSubtotalCents = CERTIFICATION_SUPPORT_UNIT_CENTS * supportUnits;

  const handleCampaignCheckout = async (tierId: NodeCampaignTierId) => {
    setCheckoutError("");
    setActiveCheckoutTier(tierId);
    try {
      const quantity = tierId === "certification_support" ? supportUnits : reservationQuantity;
      const session = await createNodeCampaignCheckoutSession(tierId, quantity);
      window.location.assign(session.url);
      return;
    }
    catch (err) {
      const message = err instanceof Error && err.message.trim().length > 0
        ? err.message
        : "Unable to open checkout right now.";
      setCheckoutError(message);
      setActiveCheckoutTier(null);
    }
  };

  return (
    <>
      <Flex direction="column" gap="5">
      <Box>
        <Flex direction={{ initial: "column", md: "row" }} align="start" gap="5">
          <Box style={{ flex: "1 1 34rem", minWidth: 0 }}>
            <Flex direction="column" gap="3">
              <Badge color="amber" variant="soft" style={{ alignSelf: "start" }}>
                FCC authorization pending
              </Badge>
              <Heading as="h1" size="6">
                Reserve a founding CrowdPM node, shipping only after authorization.
              </Heading>
              <Text size="3" color="gray" as="p">
                CrowdPM is collecting conditional reservations and certification support for the expo launch.
                Node hardware is not available for immediate delivery; reservations convert to shipment only after
                FCC equipment authorization is complete.
              </Text>
              <Text size="2" color="gray" as="p">
                The base model is the only planned first-run configuration. It measures PM2.5, GPS,
                temperature/humidity, and local storage telemetry, then uploads to CrowdPM when internet is available.
              </Text>
            </Flex>
            <Box mt="4">
              <ProductGallery />
            </Box>
          </Box>

          <Flex direction="column" gap="4" style={{ width: "100%", maxWidth: "30rem", minWidth: 0 }}>
            <Card>
              <Flex direction="column" gap="4">
                <Box>
                  <Text size="1" color="gray" as="div" style={{ textTransform: "uppercase", fontWeight: 600 }}>
                    Conditional preorder
                  </Text>
                  <Heading as="h2" size="4" mt="1">
                    Founding node reservation
                  </Heading>
                  <Flex align="baseline" gap="2" mt="2" wrap="wrap">
                    <Text as="div" size="6" weight="bold">
                      {formatUsd(BASE_NODE_PRICE_CENTS)}
                    </Text>
                    <Text size="2" color="gray">per reserved device</Text>
                  </Flex>
                  <Text size="2" color="gray" as="p" mt="2">
                    {NODE_PRODUCT_SUMMARY}
                  </Text>
                </Box>

                <Callout.Root color="amber" variant="surface">
                  <Callout.Text>
                    No node will be shipped, delivered, or released to an end user before FCC equipment authorization is complete.
                  </Callout.Text>
                </Callout.Root>

                <Box>
                  <Text size="2" weight="bold" as="div" mb="2">
                    Reservation terms
                  </Text>
                  <BulletList>
                    <ListItem>US shipping is included after authorization; sales tax is calculated at checkout.</ListItem>
                    <ListItem>Power source and USB-A-to-micro-USB cable are supplied by the customer.</ListItem>
                    <ListItem>If authorization is not complete by {FCC_REFUND_CHECKPOINT_LABEL}, reservation holders can request a refund or continue waiting.</ListItem>
                  </BulletList>
                </Box>

                <Flex align="center" justify="between" gap="3">
                  <Box>
                    <Text size="2" weight="bold" as="div">
                      Reserved quantity
                    </Text>
                    <Text size="1" color="gray">Up to 10 devices per checkout</Text>
                  </Box>
                  <Box style={{ width: "7rem" }}>
                    <Select.Root
                      value={String(reservationQuantity)}
                      onValueChange={(value) => setReservationQuantity(Number(value))}
                    >
                      <Select.Trigger aria-label="Reserved quantity" />
                      <Select.Content>
                        {NODE_QUANTITY_OPTIONS.map((option) => (
                          <Select.Item key={option} value={String(option)}>
                            {option}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </Box>
                </Flex>

                <Box
                  style={{
                    borderTop: "1px solid var(--gray-a5)",
                    paddingTop: "var(--space-3)",
                  }}
                >
                  <Flex justify="between" gap="3">
                    <Text size="2" color="gray">Reservation</Text>
                    <Text size="2">{formatUsd(BASE_NODE_PRICE_CENTS)}</Text>
                  </Flex>
                  <Flex justify="between" gap="3" mt="1">
                    <Text size="2" color="gray">Tier</Text>
                    <Text size="2">{NODE_PRODUCT_LABEL}</Text>
                  </Flex>
                  <Flex justify="between" gap="3" mt="1">
                    <Text size="2" color="gray">Quantity</Text>
                    <Text size="2">x {reservationQuantity}</Text>
                  </Flex>
                  <Separator size="4" my="3" />
                  <Flex justify="between" align="center" gap="3">
                    <Text size="3" weight="bold">Subtotal</Text>
                    <Text as="div" size="5" weight="bold">{formatUsd(reservationSubtotalCents)}</Text>
                  </Flex>
                  <Text size="1" color="gray" as="p" mt="1">
                    Applicable tax is calculated in Stripe Checkout.
                  </Text>
                </Box>

                <Button
                  size="3"
                  onClick={() => { void handleCampaignCheckout("founding_node_reservation"); }}
                  disabled={Boolean(activeCheckoutTier)}
                >
                  {activeCheckoutTier === "founding_node_reservation"
                    ? "Opening Checkout..."
                    : `Reserve - ${formatUsd(reservationSubtotalCents)}`}
                </Button>
              </Flex>
            </Card>

            <Card>
              <Flex direction="column" gap="4">
                <Box>
                  <Text size="1" color="gray" as="div" style={{ textTransform: "uppercase", fontWeight: 600 }}>
                    No hardware reward
                  </Text>
                  <Heading as="h2" size="4" mt="1">
                    Certification support
                  </Heading>
                  <Flex align="baseline" gap="2" mt="2" wrap="wrap">
                    <Text as="div" size="6" weight="bold">
                      {formatUsd(CERTIFICATION_SUPPORT_UNIT_CENTS)}
                    </Text>
                    <Text size="2" color="gray">per support unit</Text>
                  </Flex>
                  <Text size="2" color="gray" as="p" mt="2">
                    Helps fund FCC testing and launch costs. This tier does not reserve hardware, equity,
                    charitable tax treatment, or service access.
                  </Text>
                </Box>

                <Flex align="center" justify="between" gap="3">
                  <Box>
                    <Text size="2" weight="bold" as="div">
                      Support units
                    </Text>
                    <Text size="1" color="gray">Choose 1 to 10 units</Text>
                  </Box>
                  <Box style={{ width: "7rem" }}>
                    <Select.Root
                      value={String(supportUnits)}
                      onValueChange={(value) => setSupportUnits(Number(value))}
                    >
                      <Select.Trigger aria-label="Support units" />
                      <Select.Content>
                        {SUPPORT_QUANTITY_OPTIONS.map((option) => (
                          <Select.Item key={option} value={String(option)}>
                            {option}
                          </Select.Item>
                        ))}
                      </Select.Content>
                    </Select.Root>
                  </Box>
                </Flex>

                <Flex justify="between" align="center" gap="3">
                  <Text size="3" weight="bold">Support total</Text>
                  <Text as="div" size="5" weight="bold">{formatUsd(supportSubtotalCents)}</Text>
                </Flex>

                <Button
                  size="3"
                  variant="soft"
                  onClick={() => { void handleCampaignCheckout("certification_support"); }}
                  disabled={Boolean(activeCheckoutTier)}
                >
                  {activeCheckoutTier === "certification_support"
                    ? "Opening Checkout..."
                    : `Support certification - ${formatUsd(supportSubtotalCents)}`}
                </Button>
              </Flex>
            </Card>

            <Text size="1" color="gray" as="p">
              Campaign payments are processed by Stripe for Denuo Web LLC and are subject to the{" "}
              <LegalDocumentLink documentId="terms" onOpen={setOpenLegalDocument}>
                Terms
              </LegalDocumentLink>
              ,{" "}
              <LegalDocumentLink documentId="license" onOpen={setOpenLegalDocument}>
                License
              </LegalDocumentLink>
              , and{" "}
              <LegalDocumentLink documentId="privacy" onOpen={setOpenLegalDocument}>
                Privacy Policy
              </LegalDocumentLink>
              .
            </Text>
          </Flex>
        </Flex>

        {checkoutNotice === "success" ? (
          <Callout.Root color="green" variant="surface" mt="4">
            <Callout.Text>
              Checkout completed. Stripe will email a receipt. Signed-in campaign payments also appear in the dashboard.
            </Callout.Text>
          </Callout.Root>
        ) : null}

        {checkoutNotice === "cancelled" ? (
          <Callout.Root color="amber" variant="surface" mt="4">
            <Callout.Text>
              Checkout was cancelled before payment completed.
            </Callout.Text>
          </Callout.Root>
        ) : null}

        {checkoutError ? (
          <Callout.Root color="tomato" variant="surface" mt="4">
            <Callout.Text>{checkoutError}</Callout.Text>
          </Callout.Root>
        ) : null}
      </Box>

      <Separator size="4" />

      <Section title="Campaign Options">
        <Text size="2" color="gray" as="p">
          Expo payments are either conditional reservations for the first standard node build
          or support-only contributions toward certification costs.
        </Text>

        <InfoTable
          headers={["Option", "What it includes", "Price"]}
          rows={[
            [NODE_PRODUCT_LABEL, "Conditional reservation for PM2.5 sensing, GPS, temperature/humidity, local storage, USB micro power input, US shipping after authorization, and setup documentation", formatUsd(BASE_NODE_PRICE_CENTS)],
            ["Certification support", "Support-only contribution toward FCC testing and launch costs; no hardware reward or service entitlement", `${formatUsd(CERTIFICATION_SUPPORT_UNIT_CENTS)} units`],
            ["Refund checkpoint", `Reservation holders may request a refund or keep waiting if FCC authorization is not complete by ${FCC_REFUND_CHECKPOINT_LABEL}`, "Applies to reservations"],
          ]}
        />
      </Section>

      <Tabs.Root defaultValue="setup">
        <Tabs.List size="2">
          <Tabs.Trigger value="setup">Setup Your Node</Tabs.Trigger>
          <Tabs.Trigger value="build">Build a Node</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="setup">
          <Flex direction="column" gap="5" style={{ paddingTop: "var(--space-4)" }}>
            <Section title="Setup Your Node">
              <Text size="2" color="gray" as="p">
                These are the first-time setup steps for an authorized shipped node or compatible self-built node.
                Start near the Wi-Fi network you want the node to use most often.
                Once setup is complete, the node should reconnect to that saved
                network automatically on future startups.
              </Text>

              <Callout.Root color="blue" variant="surface">
                <Callout.Text>
                  You only need the setup Wi-Fi when the node is new, when your
                  Wi-Fi credentials change, or after a factory reset.
                </Callout.Text>
              </Callout.Root>
            </Section>

            <Section title="First-Time Setup">
              <InfoTable
                headers={["Step", "What you do", "What the node does"]}
                rows={[
                  [
                    "1. Power it on",
                    "Move the node near your Wi-Fi router, connect a customer-supplied USB-A power source to the node's micro-USB power input, and let it finish booting.",
                    "The node boots its local software and, if it does not already have saved Wi-Fi credentials, starts setup mode.",
                  ],
                  [
                    "2. Join the setup Wi-Fi",
                    <>On your phone or laptop, connect to <InlineCode>CrowdPM-Setup-ABCD</InlineCode>.</>,
                    "The node exposes a temporary local network so you can configure it without SSH or a mobile app.",
                  ],
                  [
                    "3. Open the local setup page",
                    <>Open <InlineCode>http://192.168.4.1</InlineCode> in a browser.</>,
                    "The node serves its local setup portal directly from the device.",
                  ],
                  [
                    "4. Enter your Wi-Fi credentials",
                    "Select or type your home or office Wi-Fi network name, enter the password, and save.",
                    "The node stores the credentials, disconnects from setup mode, and joins your configured Wi-Fi network.",
                  ],
                  [
                    "5. Approve the device in CrowdPM",
                    <>When the node shows a CrowdPM <InlineCode>user_code</InlineCode>, open the{" "}
                      <InternalNewTabAnchor href={APP_ROUTES.activation} style={{ color: "var(--accent-11)" }}>
                        Activation page
                      </InternalNewTabAnchor>{" "}
                      and authorize the node to your account.</>,
                    "After approval, the node finishes registration and begins normal measurement and upload behavior.",
                  ],
                ]}
              />

              <Text size="2" color="gray" as="p">
                If the setup network does not appear immediately, keep the node
                powered on and give it more time to finish booting before trying again.
              </Text>
            </Section>

            <Section title="What Happens After Setup">
              <BulletList>
                <ListItem>
                  When the node is powered on, it continues taking PM2.5
                  measurements until external USB power is removed.
                </ListItem>
                <ListItem>
                  When it can reach your configured Wi-Fi, it uploads readings to
                  CrowdPM over that saved network connection.
                </ListItem>
                <ListItem>
                  If it leaves Wi-Fi range, it keeps measuring and stores readings
                  locally first instead of stopping.
                </ListItem>
                <ListItem>
                  When it comes back within range of a saved Wi-Fi network, it
                  automatically uploads the backlog it recorded while offline.
                </ListItem>
                <ListItem>
                  Turning the node off stops both measurement and upload until it
                  is powered on again.
                </ListItem>
              </BulletList>

              <Text size="2" color="gray" as="p">
                If you later change your Wi-Fi name or password, repeat the same
                setup-portal flow so the node can save the new network details.
              </Text>
            </Section>
          </Flex>
        </Tabs.Content>

        <Tabs.Content value="build">
          <Flex direction="column" gap="5" style={{ paddingTop: "var(--space-4)" }}>
      {/* ---- Recommended Prototype ---- */}
      <Section title="Build a Node">
        <Text size="2" color="gray" as="p">
          This page focuses on the standard CrowdPM mobile node prototype: a
          Raspberry Pi Zero 2 W, PM2.5 sensor, GPS, temperature/humidity sensor,
          local setup controls, and USB micro power input.
        </Text>
        <Text size="1" color="gray" as="p">
          As an Amazon Associate I earn from qualifying purchases. Hardware part
          links are paid links. Equivalent parts can be used when they match the
          electrical and mechanical requirements.
        </Text>

        <InfoTable
          headers={["Part", "Purpose"]}
          rows={[
            [
              <PartLink key="zero-2-w" href={ZERO_2_W_URL}>Raspberry Pi Zero 2 W</PartLink>,
              "Main computer",
            ],
            [
              <PartLink key="pms5003" href={PMS5003_URL}>Plantower PMS5003</PartLink>,
              "PM1.0, PM2.5, and PM10 particulate sensor",
            ],
            [
              <PartLink key="dht22" href={DHT22_URL}>DHT22</PartLink>,
              "Temperature and humidity sensor",
            ],
            [
              <PartLink key="gps-breakout" href={GPS_BREAKOUT_URL}>Adafruit Ultimate GPS Breakout with GLONASS + GPS (#5440)</PartLink>,
              "Latitude, longitude, time, and optional PPS signal",
            ],
            [
              <PartLink key="sd-card" href={SD_CARD_URL}>SanDisk Ultra microSDHC memory card</PartLink>,
              "MicroSD storage for Raspberry Pi OS, local readings, and offline buffering",
            ],
            [
              <PartLink key="usb-to-ttl" href={USB_TO_TTL_URL}>USB-to-TTL serial adapter</PartLink>,
              "Gives the PMS5003 its own UART serial port",
            ],
            [
              <PartLink key="otg-adapter" href={OTG_ADAPTER_URL}>Micro USB OTG adapter</PartLink>,
              "Lets the Pi Zero 2 W use the USB serial adapter",
            ],
            [
              <PartLink key="line-cables" href={LINE_CABLES_URL}>Line cables kit</PartLink>,
              "Jumper wiring for sensor and setup connections",
            ],
            [
              "Button and status LED",
              "Recommended for setup mode, reset, and field diagnostics",
            ],
          ]}
        />
      </Section>

      {/* ---- Standard Node Model ---- */}
      <Section title="Standard Mobile Node">
        <Text size="2" color="gray" as="p">
          CrowdPM uses one universal mobile node design. The node records PM2.5
          wherever it is deployed, saves readings locally first, and uploads
          when it reaches known Wi-Fi.
        </Text>

        <BulletList>
          <ListItem>Runs from a customer-supplied 5 V USB-A power source through the node&apos;s micro-USB power input.</ListItem>
          <ListItem>Uses GPS for each mobile reading.</ListItem>
          <ListItem>Writes every reading locally before upload.</ListItem>
          <ListItem>Does not require Wi-Fi or a phone hotspot while measuring.</ListItem>
          <ListItem>Uploads later when the node reconnects to known Wi-Fi.</ListItem>
          <ListItem>
            Good default sample interval: 5–15 seconds for detailed mapping,
            30–60 seconds for lighter storage and upload volume.
          </ListItem>
        </BulletList>
      </Section>

      {/* ---- Wiring ---- */}
      <Section title="Wiring">
        <Subsection title="Important UART Constraint">
          <Text size="2" color="gray" as="p">
            Both the GPS breakout and the PMS5003 use UART serial. The
            Raspberry Pi Zero 2 W has one convenient primary UART exposed on
            GPIO14/GPIO15. The cleanest design is to put the GPS breakout on
            the Pi UART and the PMS5003 on a USB-to-TTL serial adapter.
          </Text>

          <CodeBlock>{`GPS breakout:
  Use Raspberry Pi UART on GPIO14/GPIO15.

PMS5003:
  Use USB-to-TTL serial adapter.

DHT22:
  Use normal GPIO, such as GPIO17.`}</CodeBlock>
        </Subsection>

        <Subsection title="GPS Breakout (#5440)">
          <Text size="2" color="gray" as="p">
            Wire the Adafruit Ultimate GPS breakout (#5440) to the Raspberry Pi
            Zero 2 W UART pins. Keep the GPS board and antenna oriented toward
            open sky when possible.
          </Text>

          <InfoTable
            headers={["GPS Breakout Pin", "Raspberry Pi Connection", "Physical Pin"]}
            rows={[
              ["VIN", "5 V", "Pin 2 or 4"],
              ["GND", "GND", "Pin 6 or 9"],
              ["TX", "GPIO15 / Pi RXD", "Pin 10"],
              ["RX", "GPIO14 / Pi TXD", "Pin 8"],
              ["PPS, if enabled", "GPIO4", "Pin 7"],
            ]}
          />

          <Text size="2" color="gray" as="p">
            Avoid using GPIO4 for other sensors if PPS is enabled.
          </Text>
        </Subsection>

        <Subsection title="PMS5003 via USB Serial Adapter">
          <Text size="2" color="gray" as="p">
            Power the PMS5003 from 5 V. Read its serial data through a USB-to-TTL
            serial adapter. The PMS5003 transmits readings automatically, so the
            node usually only needs to listen to its TX pin.
          </Text>

          <InfoTable
            headers={["PMS5003 Pin", "Connect To"]}
            rows={[
              ["VCC / 5V", "Raspberry Pi 5V, physical pin 2 or 4"],
              ["GND", "Raspberry Pi GND"],
              ["TX", "USB-to-TTL adapter RX"],
              ["RX", "Leave disconnected for passive reading"],
              ["SET", "Leave disconnected"],
              ["RESET", "Leave disconnected"],
            ]}
          />
        </Subsection>

        <Subsection title="DHT22">
          <Text size="2" color="gray" as="p">
            Use 3.3 V for the temperature/humidity sensor so the data line is
            safe for the Raspberry Pi GPIO.
          </Text>

          <InfoTable
            headers={["Sensor Pin", "Raspberry Pi Connection"]}
            rows={[
              ["VCC / +", "3.3 V, physical pin 1"],
              ["DATA / OUT", "GPIO17, physical pin 11"],
              ["GND / -", "GND, physical pin 6 or 9"],
            ]}
          />

          <Text size="2" color="gray" as="p">
            A bare 4-pin DHT22 usually needs a pull-up resistor:
          </Text>

          <CodeBlock>{`DATA → 4.7 kΩ resistor → 3.3 V`}</CodeBlock>

          <Text size="2" color="gray" as="p">
            A 3-pin DHT22 module often already has this resistor on the board
            as a tiny rectangular surface-mount part. If the module works
            without an external resistor, do not add another one. If reads fail
            repeatedly, add a 4.7 kΩ resistor between DATA and 3.3 V.
          </Text>

          <InfoTable
            headers={["Value", "Meaning", "Use"]}
            rows={[
              ["4.7 kΩ", "4,700 ohms", "Correct pull-up value"],
              ["4.7 Ω", "4.7 ohms", "Incorrect; far too low"],
            ]}
          />
        </Subsection>

      </Section>

      {/* ---- Pi Setup ---- */}
      <Section title="Raspberry Pi Setup">
        <Subsection title="Enable UART for GPS">
          <Text size="2" color="gray" as="p">
            Enable serial hardware and disable the serial login console so the
            GPS breakout can use the Raspberry Pi UART.
          </Text>

          <CodeBlock>{`sudo apt update
sudo apt install -y curl python3-venv python3-pip python3-dev libgpiod2

sudo raspi-config nonint do_serial_cons 1
sudo raspi-config nonint do_serial_hw 0

sudo systemctl disable --now hciuart || true

CONFIG_FILE="/boot/firmware/config.txt"
if [ ! -f "$CONFIG_FILE" ]; then
  CONFIG_FILE="/boot/config.txt"
fi

grep -q '^enable_uart=1' "$CONFIG_FILE" || echo 'enable_uart=1' | sudo tee -a "$CONFIG_FILE"
grep -q '^dtoverlay=disable-bt' "$CONFIG_FILE" || echo 'dtoverlay=disable-bt' | sudo tee -a "$CONFIG_FILE"

sudo reboot`}</CodeBlock>

          <Text size="2" color="gray" as="p">
            After reboot, verify GPS serial output:
          </Text>

          <CodeBlock>{`ls -l /dev/serial0
timeout 10 cat /dev/serial0`}</CodeBlock>

          <Text size="2" color="gray" as="p">
            Good output contains NMEA lines such as{" "}
            <InlineCode>$GNGGA</InlineCode>, <InlineCode>$GNRMC</InlineCode>,{" "}
            <InlineCode>$GPGGA</InlineCode>, or <InlineCode>$GPRMC</InlineCode>.
          </Text>
        </Subsection>

        <Subsection title="Find the PMS5003 USB Serial Port">
          <Text size="2" color="gray" as="p">
            Plug the USB-to-TTL adapter into the Pi Zero 2 W USB data port using
            a micro USB OTG adapter. Do not plug it into the power-only port.
          </Text>

          <CodeBlock>{`ls -l /dev/serial/by-id/`}</CodeBlock>

          <Text size="2" color="gray" as="p">
            Prefer the stable <InlineCode>/dev/serial/by-id/...</InlineCode>{" "}
            path instead of <InlineCode>/dev/ttyUSB0</InlineCode>.
          </Text>

          <CodeBlock>{`sudo usermod -aG dialout,gpio "$USER"`}</CodeBlock>

          <Text size="2" color="gray" as="p">
            Log out and back in, or reboot, after changing groups.
          </Text>
        </Subsection>
      </Section>

      {/* ---- Software Installation ---- */}
      <Section title="Software Installation">
        <Subsection title="Install Node.js 24.15.0 and Download the Registration Helper">
          <CodeBlock>{`cd ~

curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"

nvm install 24.15.0
nvm use 24.15.0

mkdir -p ~/crowdpm-node
cd ~/crowdpm-node

curl -fsSLo deployed-device-registration.sh \\
  https://raw.githubusercontent.com/Denuo-Web/CrowdPMPlatform/main/scripts/deployed-device-registration.sh

chmod +x deployed-device-registration.sh`}</CodeBlock>
        </Subsection>

        <Subsection title="Register the Device">
          <CodeBlock>{`cd ~/crowdpm-node

./deployed-device-registration.sh`}</CodeBlock>

          <Text size="2" color="gray" as="p">
            The script prints a user code and activation URL. Open the URL in a
            browser, sign in, and approve the device. The Pi script will keep
            polling until approval completes or the pairing session expires.
          </Text>
        </Subsection>

        <Subsection title="Install Python Sensor Dependencies">
          <CodeBlock>{`mkdir -p ~/crowdpm-pi
cd ~/crowdpm-pi

python3 -m venv --system-site-packages .venv
source .venv/bin/activate

pip install --upgrade pip
pip install pyserial pynmea2 adafruit-blinka adafruit-circuitpython-dht`}</CodeBlock>
        </Subsection>
      </Section>

      {/* ---- Mobile Build ---- */}
      <Section title="Mobile Node Design">
        <Text size="2" color="gray" as="p">
          Assume there is no Wi-Fi during measurement. The node should use GPS,
          store readings locally, and upload later when known Wi-Fi is available.
        </Text>

        <CodeBlock>{`During field use:
  - Run from a customer-supplied 5 V USB-A power source.
  - Read PMS5003.
  - Read GPS.
  - Read DHT22.
  - Save every reading locally.
  - Do not require Wi-Fi.

After field use:
  - Reconnect to known home Wi-Fi.
  - Upload pending batches.
  - Mark uploaded rows as synced.`}</CodeBlock>

        <InfoTable
          headers={["Use Case", "Sample Interval"]}
          rows={[
            ["Detailed route mapping", "5–15 seconds"],
            ["Normal field logging", "10–30 seconds"],
            ["Lower-volume logging", "30–60 seconds"],
          ]}
        />

        <Text size="2" color="gray" as="p">
          At a 10-second sample interval, the node records about 360 readings per
          hour, or about 2,880 readings over an 8-hour field session. That is
          small for SQLite and reasonable for delayed batch upload.
        </Text>
      </Section>

      {/* ---- Power ---- */}
      <Section title="USB Power">
        <Text size="2" color="gray" as="p">
          CrowdPM nodes ship without an included power source. Power the node
          from a customer-supplied 5 V USB-A source connected to the node&apos;s
          micro-USB power input.
        </Text>

        <InfoTable
          headers={["Item", "Use"]}
          rows={[
            ["Customer-supplied USB-A power source", "Powers the node during setup, measurement, and upload"],
            ["USB-A-to-micro-USB cable", "Connects the external power source to the node power input"],
            ["5 V / 3 A output", "Recommended power rating for stable Pi Zero 2 W operation with sensors attached"],
          ]}
        />

        <Text size="2" color="gray" as="p">
          Recommended setup:
        </Text>

        <CodeBlock>{`Customer-supplied USB-A power source
USB-A-to-micro-USB cable
Power budget tested with PMS5003, GPS, DHT22, and USB serial attached`}</CodeBlock>

        <Text size="2" color="gray" as="p">
          Validate runtime with the final enclosure, sample interval, Wi-Fi
          behavior, GPS placement, and the exact power source used in the field.
        </Text>
      </Section>

      {/* ---- Physical Layout ---- */}
      <Section title="Physical Layout">
        <CodeBlock>{`Main enclosure:
  - Raspberry Pi Zero 2 W
  - USB serial adapter
  - wiring strain relief

Ventilated air path:
  - PMS5003 air inlet/outlet
  - protected from rain and road debris

Sky-facing or upper-frame area:
  - GPS breakout with less body or metal obstruction

Shielded airflow area:
  - DHT22
  - away from Pi heat, direct sun, and rain`}</CodeBlock>

        <Text size="2" color="gray" as="p">
          Do not seal the PMS5003 inside an airtight box. It needs airflow. The
          enclosure should protect from splash and debris while still allowing
          air to reach the sensor.
        </Text>
      </Section>

      {/* ---- Wi-Fi Setup ---- */}
      <Section title="Wi-Fi Setup for Shipped Nodes">
        <Text size="2" color="gray" as="p">
          A sold node must connect to the buyer&apos;s Wi-Fi, but the Raspberry
          Pi is usually headless. The best first product goal is a local setup
          portal, not a native mobile app.
        </Text>

        <CodeBlock>{`First boot:
  CrowdPM node has no Wi-Fi credentials
      ↓
  Node creates temporary Wi-Fi network:
  CrowdPM-Setup-ABCD
      ↓
  User connects phone or laptop to that network
      ↓
  User opens:
  http://192.168.4.1
      ↓
  Local page asks for Wi-Fi name and password
      ↓
  Node saves credentials and connects to home Wi-Fi
      ↓
  Node starts CrowdPM registration
      ↓
  Local page shows the CrowdPM user_code
      ↓
  User approves device at CrowdPM activation page`}</CodeBlock>

        <Text size="2" color="gray" as="p">
          This works with iPhone, Android, Mac, Windows, and Linux without an app
          store. Bluetooth Low Energy setup can be added later, but the local
          Wi-Fi setup portal should remain as the universal fallback.
        </Text>
      </Section>

      {/* ---- Runtime Architecture ---- */}
      <Section title="Recommended Runtime Architecture">
        <Text size="2" color="gray" as="p">
          Prototype code may start as one script, but a product node should be
          split into small services with clear responsibilities.
        </Text>

        <CodeBlock>{`crowdpm-sensor.service
  Reads sensors and writes SQLite.

crowdpm-uploader.service
  Uploads pending SQLite rows when internet exists.

crowdpm-setup.service
  Serves local setup portal and/or BLE provisioning.

crowdpm-watchdog.service
  Checks health and restarts failed services.`}</CodeBlock>

        <Text size="2" color="gray" as="p">
          Suggested filesystem layout:
        </Text>

        <CodeBlock>{`/opt/crowdpm/
  crowdpm_sensor.py
  crowdpm_uploader.py
  crowdpm_setup_api.py
  crowdpm_ble.py
  crowdpm.db

/etc/crowdpm/
  config.json
  device-key.json
  device-id
  wifi.json`}</CodeBlock>
      </Section>

      {/* ---- Local Setup API ---- */}
      <Section title="Local Setup API">
        <Text size="2" color="gray" as="p">
          The setup portal can call a small API running on the Pi. The same
          concepts can later be exposed over BLE.
        </Text>

        <CodeBlock>{`GET  /api/status
GET  /api/wifi/scan
POST /api/wifi/connect
POST /api/wifi/forget
GET  /api/sensors/test
POST /api/crowdpm/start-registration
GET  /api/crowdpm/registration-status
POST /api/settings
POST /api/reboot
POST /api/factory-reset`}</CodeBlock>
      </Section>

      {/* ---- Button and LED ---- */}
      <Section title="Button and Status LED">
        <Text size="2" color="gray" as="p">
          A field node should be understandable without SSH. Add a physical
          button and a status LED.
        </Text>

        <InfoTable
          headers={["Action", "Behavior"]}
          rows={[
            ["Short press", "Show status or wake the status LED"],
            ["Hold 5 seconds", "Enter setup mode"],
            ["Hold 20 seconds", "Factory reset Wi-Fi and CrowdPM identity"],
          ]}
        />

        <InfoTable
          headers={["LED Pattern", "Meaning"]}
          rows={[
            ["Slow blink", "Setup mode"],
            ["Fast blink", "Connecting to Wi-Fi"],
            ["Solid", "Online"],
            ["Double blink", "Offline but logging"],
            ["Triple blink", "GPS missing"],
            ["Error blink", "Sensor failure"],
          ]}
        />
      </Section>

      {/* ---- Quality Flags ---- */}
      <Section title="Quality Flags and Diagnostics">
        <Text size="2" color="gray" as="p">
          The node should record enough diagnostic metadata to explain bad data
          later. Locally, store details such as GPS status, HDOP, power status,
          PMS checksum failures, upload attempts, and last upload error.
        </Text>

        <InfoTable
          headers={["Flag", "Meaning"]}
          rows={[
            ["0", "Normal"],
            ["1", "GPS missing"],
            ["2", "Sensor read failed"],
            ["4", "Weak GPS precision"],
            ["8", "Power interruption"],
            ["16", "Value outside expected range"],
          ]}
        />
      </Section>

      {/* ---- Verification ---- */}
      <Section title="Verification Checklist">
        <BulletList>
          <ListItem>
            GPS prints NMEA sentences on <InlineCode>/dev/serial0</InlineCode>.
          </ListItem>
          <ListItem>
            PMS5003 frames begin with hex bytes <InlineCode>42 4d</InlineCode>.
          </ListItem>
          <ListItem>DHT22 returns temperature and humidity.</ListItem>
          <ListItem>Device registration prints a CrowdPM user code.</ListItem>
          <ListItem>Activation succeeds in the browser.</ListItem>
          <ListItem>Test batch upload succeeds.</ListItem>
          <ListItem>Offline readings remain in SQLite.</ListItem>
          <ListItem>Returning to Wi-Fi uploads pending readings.</ListItem>
        </BulletList>

        <Subsection title="Quick GPS Test">
          <CodeBlock>{`timeout 10 cat /dev/serial0`}</CodeBlock>
        </Subsection>

        <Subsection title="Quick PMS5003 Test">
          <CodeBlock>{`python3 - <<'PY'
import serial
s = serial.Serial("/dev/ttyUSB0", 9600, timeout=5)
print(s.read(32).hex())
PY`}</CodeBlock>
        </Subsection>

        <Subsection title="Quick DHT22 Test">
          <CodeBlock>{`cd ~/crowdpm-pi
source .venv/bin/activate

python - <<'PY'
import time
import board
import adafruit_dht

sensor = adafruit_dht.DHT22(board.D17, use_pulseio=False)

for i in range(10):
    try:
        print("temperature C:", sensor.temperature, "humidity %:", sensor.humidity)
    except RuntimeError as e:
        print("retry:", e)
    time.sleep(2)
PY`}</CodeBlock>
        </Subsection>
      </Section>

      {/* ---- Final Target ---- */}
      <Section title="Product Goal">
        <Text size="2" color="gray" as="p">
          The best product target is not merely a Raspberry Pi script that
          uploads when everything works. The better target is a self-contained
          field node that can be configured by a normal user, run without constant
          internet, survive network interruptions, store data locally, upload
          later, and explain its status without requiring SSH.
        </Text>

        <CodeBlock>{`A good CrowdPM node should:
  - be configurable by a normal user
  - run without internet during measurement
  - save every reading locally first
  - upload later when Wi-Fi returns
  - recover from power and network interruptions
  - be reset without SSH
  - show useful status with LEDs or a local page
  - avoid data loss unless storage is exhausted`}</CodeBlock>
      </Section>
          </Flex>
        </Tabs.Content>
      </Tabs.Root>
      </Flex>
      <LegalDocumentDialog
        documentId={openLegalDocument}
        onOpenChange={(open) => {
          if (!open) setOpenLegalDocument(null);
        }}
      />
    </>
  );
}
