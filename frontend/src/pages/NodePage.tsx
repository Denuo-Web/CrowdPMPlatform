import { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Callout,
  Card,
  Flex,
  Heading,
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
import { createNodePurchaseCheckoutSession } from "../lib/api";

type SectionProps = {
  title: string;
  children: ReactNode;
};

type TableProps = {
  headers: string[];
  rows: ReactNode[][];
};

type NodeProductVariantId = "standard" | "co2" | "no2" | "co2_no2";

type NodeProductVariant = {
  id: NodeProductVariantId;
  label: string;
  summary: string;
  addedHardware: string;
  addOnAmountCents: number;
  totalAmountCents: number;
};

const BASE_NODE_PRICE_CENTS = 35_000;
const CO2_SENSOR_ADD_ON_CENTS = 2_799;
const NO2_SENSOR_ADD_ON_CENTS = 2_695 + 1_189;

const ZERO_2_W_URL = "https://www.amazon.com/Raspberry-Heatsink-Adapter-Quad-core-Bluetooth/dp/B0DRRDJKDV?crid=3VRASN6F43J3I&dib=eyJ2IjoiMSJ9.t-BTW30Tluhki6lWlHIi2rulYzLQMAGFk2OvRz-XBQTYgqnJ_G_aL00we8CvIVnKwG2Qc75itVV_M0bpyBUc5YG3r7ovACXMTrtlMTUUnZBffQIiEHNn3Yqk-Chei1tyWsoAB2tTea-NTY83Z_QJUq5-3JfgkUiz0PjutePcLmnkuMuu_IWzavyrhKUNrUjTEI8BgTUNhwVf1epqDu2ahFmxjLDI5xaFLi5SgdjHoeg.dYFNm35Nc1V43vvTuZ8pC5dQ-abvmafEYOYXJh8E5Ss&dib_tag=se&keywords=raspberry%2Bpi%2Bzero%2B2%2Bw&qid=1778398787&sprefix=Raspberry%2BPi%2BZero%2B2%2BW%2Caps%2C178&sr=8-2-spons&sp_csd=d2lkZ2V0TmFtZT1zcF9hdGY&th=1&linkCode=ll2&tag=lipbalm01-20&linkId=35363b709757db3d01baa6b973c52a01&language=en_US&ref_=as_li_ss_tl";
const PMS5003_URL = "https://www.amazon.com/BestParts-Digital-Particle-Concentration-PMS5003/dp/B0B1DQKV4N?crid=2CSK1VIYBL9LN&dib=eyJ2IjoiMSJ9.98U0BdlWh4vmYk-feCR0PmZpSTwOza-Io1F0J5aEYxt-Atifz_ulAtN2MSfswsFSwZAY5G94uyuiJwZQ1pJEgEFX1HBloSTDsFit2N07xKk13LTq4uwQ5LAGvFMMuUeWH2nLcVwe2SqFNb96Kn75VRFoIWku34vnGX3ryzbO4xgpcNSnNDH7QmqgRqu-KYCsnv1gNizUAnlnmoc22RpGTvxNFB4H45LOk2Hf_kqlcO8.l0Rt1mD9IbbwGvgp5ZFUzZgF46xGdPN76S6jbwz8CLE&dib_tag=se&keywords=Plantower+PMS5003&qid=1778398886&sprefix=plantower+pms5003%2Caps%2C225&sr=8-4&linkCode=ll2&tag=lipbalm01-20&linkId=7eb62de9f07d2cf0f66b47bb7349e0db&language=en_US&ref_=as_li_ss_tl";
const DHT22_URL = "https://www.amazon.com/dp/B0DSW7D3S9?th=1&linkCode=ll2&tag=lipbalm01-20&linkId=8a2b4c580bdeb37c7affe8f834a72a28&language=en_US&ref_=as_li_ss_tl";
const GPS_FEATHERWING_URL = "https://www.amazon.com/Adafruit-3133-Ultimate-GPS-FeatherWing/dp/B01G00Q5HA?crid=1X53I1W4DISNM&dib=eyJ2IjoiMSJ9.JSJlLK9_Sq4L3fPvtooh22eJd9cKJC_-7hcW-ui76Bp20Og4vxbBOm2Tam5u3WxPE9aWvKesoatagCEyl6mbZ6AIbRm1MMX8aLm099jTuCwhTSdD-5lqK_Sv2CXTZzl-o82ilDBVsJ4klAAy19Sm-cpgLgB_oHfKJyn15NJGxbsPqmZCALgzYTBmiPqQpasO5nqDuQ5TDYuCgy3Uliefxw.xLDgaCkY86xRO4swaIcX-0BaEAlz6EGBdfd1h_6GYTY&dib_tag=se&keywords=Adafruit+Ultimate+GPS+Pi+HAT&qid=1778399043&sprefix=adafruit+ultimate+gps+pi+hat%2Caps%2C326&xpid=KcdfhSO3ZXN-G&linkCode=ll2&tag=lipbalm01-20&linkId=6d5d342f3cbe67d00de8ec0f4c9fd577&language=en_US&ref_=as_li_ss_tl";
const SD_CARD_URL = "https://www.amazon.com/SanDisk-Ultra-microSDHC-Memory-Adapter/dp/B08GY9NYRM?crid=2KSLXNGFQ6QTU&dib=eyJ2IjoiMSJ9.cC5cEhilIJZ8uIFkRCnkltIEzWQtFgQq-85a7sC5zOBuxlNn7kV6Acl2AEPksDanzwUdhsAYtVHVcpBMsxrySYzrIn8iKKPReGo-n6Sm25xY5h_s3gxOBvxB6biVeYvbSVMpdqq0V04ys73DryoywF8MfCrJ0bFo5CPk8JW5oaqJQVcZYqtWJvDbeCPKeUUgPqh7fX4boOjRY1ycBDPa5Q.mpsFJuv4tSWFqRD0s4gHz8UtruEG4l92pbms5TJAAjU&dib_tag=se&keywords=sandisk%2Bextreme%2B32%2Bsd&qid=1778531180&sprefix=sandisk%2Bextreme%2B%2Bsd%2Caps%2C491&xpid=Z4LCntxaYnMES&th=1&linkCode=ll2&tag=lipbalm01-20&linkId=ecb68eedf02441ad989f4b465c8037ba&language=en_US&ref_=as_li_ss_tl";
const USB_TO_TTL_URL = "https://www.amazon.com/dp/B0G61569JG?th=1&linkCode=ll2&tag=lipbalm01-20&linkId=5e49b7bc297b33e721e671312e45f1a1&language=en_US&ref_=as_li_ss_tl";
const OTG_ADAPTER_URL = "https://www.amazon.com/dp/B015GZLG8I?th=1&linkCode=ll2&tag=lipbalm01-20&linkId=d31fc458d54c90c0e3a7ef69edccad08&language=en_US&ref_=as_li_ss_tl";
const LINE_CABLES_URL = "https://www.amazon.com/dp/B08YRGVYPV?th=1&linkCode=ll2&tag=lipbalm01-20&linkId=0e64e274f6524982c4806f74982744e0&language=en_US&ref_=as_li_ss_tl";
const PISUGAR_3_PLUS_URL = "https://www.amazon.com/PiSugar-Plus-Pwnagotchi-Management-Raspberry/dp/B0FBK89B8H?crid=LFBH2KAF10OE&dib=eyJ2IjoiMSJ9.L0Ud_TUpDnpSJdO5W3nbRsP6KDdvl9mBzCTXI1Wgu8N8TErLSyNRjB761bzndZGqn8-A8kN77bnyCNm25h_AtH8fbGcUDaW2gupHScAfR8t7ylwXTTgwRxWWtJXzMZ6r4ew80IZaX6eRtLnMMl14zg.0HpvF_Oc66MzhahEEWzs9yCISfYWDvDd3YIgQQlW6BQ&dib_tag=se&keywords=PiSugar2+Plus+5000+mAh&qid=1778400315&s=electronics&sprefix=pisugar2+plus+5000+mah%2Celectronics%2C161&sr=1-3&linkCode=ll2&tag=lipbalm01-20&linkId=c7d788c8d0b545684e272d2ae0c677cf&language=en_US&ref_=as_li_ss_tl";
const CO2_SENSOR_URL = "https://www.amazon.com/dp/B0D18XXGCW";
const NO2_SENSOR_URL = "https://www.amazon.com/dp/B0BG2YZP5L";
const ADS1115_URL = "https://www.amazon.com/dp/B01DLHKMO2";

const NODE_PRODUCT_VARIANTS: NodeProductVariant[] = [
  {
    id: "standard",
    label: "PM2.5 standard node",
    summary: "Current shipped build with PMS5003, GPS, temperature/humidity, local storage, and battery management.",
    addedHardware: "No additional gas sensor hardware",
    addOnAmountCents: 0,
    totalAmountCents: BASE_NODE_PRICE_CENTS,
  },
  {
    id: "no2",
    label: "PM2.5 + NO2 node",
    summary: "Adds a MiCS-6814 NO2 / vehicle-exhaust module and an ADS1115 ADC for Pi-compatible readout.",
    addedHardware: "MiCS-6814 NO2 module + ADS1115 ADC",
    addOnAmountCents: NO2_SENSOR_ADD_ON_CENTS,
    totalAmountCents: BASE_NODE_PRICE_CENTS + NO2_SENSOR_ADD_ON_CENTS,
  },
  {
    id: "co2",
    label: "PM2.5 + CO2 node",
    summary: "Adds an SCD41 CO2 sensor that also reports temperature and humidity over I2C.",
    addedHardware: "SCD41 CO2 sensor",
    addOnAmountCents: CO2_SENSOR_ADD_ON_CENTS,
    totalAmountCents: BASE_NODE_PRICE_CENTS + CO2_SENSOR_ADD_ON_CENTS,
  },
  {
    id: "co2_no2",
    label: "PM2.5 + CO2 + NO2 node",
    summary: "Combines the CO2 add-on with the NO2 / car-exhaust add-on in one mobile node.",
    addedHardware: "SCD41 CO2 sensor + MiCS-6814 NO2 module + ADS1115 ADC",
    addOnAmountCents: CO2_SENSOR_ADD_ON_CENTS + NO2_SENSOR_ADD_ON_CENTS,
    totalAmountCents: BASE_NODE_PRICE_CENTS + CO2_SENSOR_ADD_ON_CENTS + NO2_SENSOR_ADD_ON_CENTS,
  },
];

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
        <Text
          as="code"
          size="1"
          style={{
            whiteSpace: "pre",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        >
          {children}
        </Text>
      </pre>
    </Box>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return (
    <Text
      as="code"
      size="1"
      style={{
        borderRadius: "4px",
        padding: "0.1rem 0.3rem",
        background: "var(--gray-3)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    >
      {children}
    </Text>
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

type CheckoutNotice = "success" | "cancelled" | null;

function readCheckoutNotice(): CheckoutNotice {
  if (typeof window === "undefined") {
    return null;
  }
  const status = new URLSearchParams(window.location.search).get("checkout");
  return status === "success" || status === "cancelled" ? status : null;
}

export default function NodePage() {
  const [isStartingCheckout, setIsStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutNotice, setCheckoutNotice] = useState<CheckoutNotice>(readCheckoutNotice);
  const [openLegalDocument, setOpenLegalDocument] = useState<LegalDocumentId | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<NodeProductVariantId>("standard");
  const selectedVariant = NODE_PRODUCT_VARIANTS.find(({ id }) => id === selectedVariantId) ?? NODE_PRODUCT_VARIANTS[0];

  useEffect(() => {
    setCheckoutNotice(readCheckoutNotice());
  }, []);

  const handlePurchaseNode = async () => {
    setCheckoutError("");
    setIsStartingCheckout(true);
    try {
      const session = await createNodePurchaseCheckoutSession(selectedVariant.id);
      window.location.assign(session.url);
      return;
    }
    catch (err) {
      const message = err instanceof Error && err.message.trim().length > 0
        ? err.message
        : "Unable to open checkout right now.";
      setCheckoutError(message);
      setIsStartingCheckout(false);
    }
  };

  return (
    <>
      <Flex direction="column" gap="5">
      {/* ---- Hero ---- */}
      <Box>
        <Flex
          justify="between"
          align="start"
          gap="4"
          wrap="wrap"
        >
          <Box style={{ maxWidth: "46rem" }}>
            <Heading as="h1" size="5">
              Products - CrowdPM Node Hardware
            </Heading>
            <Text size="3" color="gray" mt="2" as="p">
              A CrowdPM node is a small air-quality computer that measures PM2.5,
              records where and when the measurement happened, stores the reading
              locally, and uploads the data to CrowdPM when internet is available.
              Multiple product options are available: the current PM2.5 build, a
              CO2 add-on build, a NO2 car-exhaust build, and a combined CO2 + NO2
              build.
            </Text>
            <Text size="2" mt="3" as="p">
              Base price starts at {formatUsd(BASE_NODE_PRICE_CENTS)} per node with
              US shipping included. The add-on sensor options below use the current
              Amazon hardware prices listed on this page, and sales tax is calculated
              at checkout from the shipping address.
            </Text>
          </Box>

          <Flex direction="column" gap="2" style={{ maxWidth: "23rem", width: "100%" }}>
            {NODE_PRODUCT_VARIANTS.map((variant) => {
              const isSelected = variant.id === selectedVariant.id;
              return (
                <Card
                  key={variant.id}
                  style={{
                    padding: 0,
                    border: isSelected ? "1px solid var(--accent-8)" : "1px solid var(--gray-a5)",
                    background: isSelected ? "var(--accent-a3)" : "var(--color-surface)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedVariantId(variant.id)}
                    aria-pressed={isSelected}
                    style={{
                      all: "unset",
                      boxSizing: "border-box",
                      cursor: "pointer",
                      display: "block",
                      width: "100%",
                      padding: "0.875rem",
                    }}
                  >
                    <Flex align="start" justify="between" gap="3">
                      <Box>
                        <Text size="2" as="div" style={{ fontWeight: 600 }}>
                          {variant.label}
                        </Text>
                        <Text size="1" color="gray" as="p" mt="1">
                          {variant.summary}
                        </Text>
                      </Box>
                      <Text size="2" as="span" style={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                        {formatUsd(variant.totalAmountCents)}
                      </Text>
                    </Flex>
                  </button>
                </Card>
              );
            })}

            <Text size="2" as="p">
              Selected price: {formatUsd(selectedVariant.totalAmountCents)}.
              {" "}This option adds {formatUsd(selectedVariant.addOnAmountCents)} over the
              {" "}{formatUsd(BASE_NODE_PRICE_CENTS)} base node.
            </Text>
            <Button
              size="3"
              onClick={() => { void handlePurchaseNode(); }}
              disabled={isStartingCheckout}
            >
              {isStartingCheckout
                ? "Opening Checkout..."
                : `Purchase Selected Product - ${formatUsd(selectedVariant.totalAmountCents)}`}
            </Button>
            <Text size="1" color="gray" as="p">
              Sold by Denuo Web, LLC as a one-time hardware purchase. US shipping is
              included, sales tax is calculated in Stripe Checkout, and selected
              sensor add-ons are reflected in the checkout price. Node orders are
              subject to the{" "}
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
              Checkout completed. Stripe will email the receipt for your node purchase.
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

      <Section title="Available Product Options">
        <Text size="2" color="gray" as="p">
          CrowdPM currently sells one standard PM2.5 node and three sensor-expanded
          options. The add-on amounts below use the Amazon prices for the listed
          sensor hardware and, where required, the extra interface board needed to
          make the sensor compatible with the Raspberry Pi Zero 2 W.
        </Text>

        <InfoTable
          headers={["Option", "Added hardware", "Added price", "Total price"]}
          rows={NODE_PRODUCT_VARIANTS.map((variant) => [
            variant.label,
            variant.addedHardware,
            variant.addOnAmountCents === 0 ? "Included in base build" : `+${formatUsd(variant.addOnAmountCents)}`,
            formatUsd(variant.totalAmountCents),
          ])}
        />

        <Callout.Root color="blue" variant="surface">
          <Callout.Text>
            For batches captured with extra gas sensors, the map can later add a
            pollutant dropdown so viewers can switch between PM2.5, NO2, CO2,
            and similar channels.
          </Callout.Text>
        </Callout.Root>
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
                These are the first-time setup steps for a shipped CrowdPM node.
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
                    "Move the node near your Wi-Fi router, flip the power switch to On, and let it finish booting. If the battery is low, connect external power first.",
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
                  measurements until it is switched off or the battery is depleted.
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
          local setup controls, and integrated battery management. Optional build
          variants add CO2 sensing, NO2 vehicle-exhaust sensing, or both.
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
              <PartLink key="co2-sensor" href={CO2_SENSOR_URL}>SCD41 CO2 sensor</PartLink>,
              "Optional CO2 add-on over I2C. Also reports temperature and humidity, so it can supplement or replace the DHT22 in an expanded build.",
            ],
            [
              <PartLink key="no2-sensor" href={NO2_SENSOR_URL}>MiCS-6814 NO2 / exhaust sensor module</PartLink>,
              "Optional NO2-focused gas add-on sourced from an automobile-exhaust style air-quality module.",
            ],
            [
              <PartLink key="ads1115" href={ADS1115_URL}>ADS1115 ADC</PartLink>,
              "Required when using the MiCS-6814 add-on because the Pi Zero 2 W does not provide native analog input pins.",
            ],
            [
              <PartLink key="gps-featherwing" href={GPS_FEATHERWING_URL}>Adafruit Ultimate GPS FeatherWing</PartLink>,
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
              <PartLink key="pisugar-3-plus" href={PISUGAR_3_PLUS_URL}>PiSugar 3 Plus</PartLink>,
              "Integrated battery and power management for the mobile node",
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
          <ListItem>Runs from the PiSugar 3 Plus battery module.</ListItem>
          <ListItem>Uses GPS for each mobile reading.</ListItem>
          <ListItem>Writes every reading locally before upload.</ListItem>
          <ListItem>Does not require Wi-Fi or a phone hotspot while measuring.</ListItem>
          <ListItem>Uploads later when the node reconnects to known Wi-Fi.</ListItem>
          <ListItem>
            Good default sample interval: 5–15 seconds for detailed mapping,
            30–60 seconds for longer battery life.
          </ListItem>
        </BulletList>
      </Section>

      {/* ---- Wiring ---- */}
      <Section title="Wiring">
        <Subsection title="Important UART Constraint">
          <Text size="2" color="gray" as="p">
            Both the GPS FeatherWing and the PMS5003 use UART serial. The
            Raspberry Pi Zero 2 W has one convenient primary UART exposed on
            GPIO14/GPIO15. The cleanest design is to put the GPS FeatherWing on
            the Pi UART and the PMS5003 on a USB-to-TTL serial adapter.
          </Text>

          <CodeBlock>{`GPS FeatherWing:
  Use Raspberry Pi UART on GPIO14/GPIO15.

PMS5003:
  Use USB-to-TTL serial adapter.

DHT22:
  Use normal GPIO, such as GPIO17.`}</CodeBlock>
        </Subsection>

        <Subsection title="GPS FeatherWing">
          <Text size="2" color="gray" as="p">
            Wire the Adafruit Ultimate GPS FeatherWing to the Raspberry Pi Zero
            2 W UART pins. Keep the GPS board and antenna oriented toward open
            sky when possible.
          </Text>

          <InfoTable
            headers={["GPS FeatherWing Pin", "Raspberry Pi Connection", "Physical Pin"]}
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

        <Subsection title="Optional CO2 Sensor (SCD41)">
          <Text size="2" color="gray" as="p">
            The SCD41 CO2 add-on is the cleanest extra sensor option for the Pi
            Zero 2 W because it speaks I2C directly. Wire it to the Raspberry Pi
            I2C bus and keep the module in free airflow, away from the PMS5003
            exhaust and away from the Pi&apos;s warmest surfaces.
          </Text>

          <InfoTable
            headers={["SCD41 Pin", "Raspberry Pi Connection", "Physical Pin"]}
            rows={[
              ["VIN / VCC", "3.3 V", "Pin 1"],
              ["GND", "GND", "Pin 6 or 9"],
              ["SDA", "GPIO2 / SDA1", "Pin 3"],
              ["SCL", "GPIO3 / SCL1", "Pin 5"],
            ]}
          />
        </Subsection>

        <Subsection title="Optional NO2 Sensor (MiCS-6814 + ADS1115)">
          <Text size="2" color="gray" as="p">
            The Amazon MiCS-6814 boards expose analog gas channels, so the Pi
            Zero 2 W needs an ADS1115 ADC in between. Use the oxidizing / NO2
            output channel from the gas board and read it through an ADS1115
            input. This is the extra hardware included in the NO2 product option.
          </Text>

          <InfoTable
            headers={["ADS1115 Pin", "Raspberry Pi Connection", "Physical Pin"]}
            rows={[
              ["VDD", "3.3 V", "Pin 1"],
              ["GND", "GND", "Pin 6 or 9"],
              ["SDA", "GPIO2 / SDA1", "Pin 3"],
              ["SCL", "GPIO3 / SCL1", "Pin 5"],
              ["ADDR", "GND for default I2C address", "Pin 6 or 9"],
            ]}
          />

          <InfoTable
            headers={["MiCS-6814 Signal", "Connect To"]}
            rows={[
              ["VCC", "5 V, physical pin 2 or 4"],
              ["GND", "Raspberry Pi GND"],
              ["NO2 / OX analog output", "ADS1115 A0"],
            ]}
          />

          <Text size="2" color="gray" as="p">
            Board labels vary a little between Amazon sellers. Look for the
            oxidizing output, often marked <InlineCode>OX</InlineCode>,
            <InlineCode>NO2</InlineCode>, or a similar analog-output label, and
            route that channel into the ADS1115.
          </Text>
        </Subsection>
      </Section>

      {/* ---- Pi Setup ---- */}
      <Section title="Raspberry Pi Setup">
        <Subsection title="Enable UART for GPS">
          <Text size="2" color="gray" as="p">
            Enable serial hardware and disable the serial login console.
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
            <InlineCode>$GPGGA</InlineCode> or <InlineCode>$GPRMC</InlineCode>.
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
        <Subsection title="Install Node 24 and Download the Registration Helper">
          <CodeBlock>{`cd ~

curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc

nvm install 24
nvm use 24

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
pip install pyserial pynmea2 adafruit-circuitpython-dht`}</CodeBlock>
        </Subsection>
      </Section>

      {/* ---- Mobile Build ---- */}
      <Section title="Mobile Node Design">
        <Text size="2" color="gray" as="p">
          Assume there is no Wi-Fi during measurement. The node should use GPS,
          store readings locally, and upload later when known Wi-Fi is available.
        </Text>

        <CodeBlock>{`During field use:
  - Run from the PiSugar 3 Plus battery module.
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
            ["Battery-saving mode", "30–60 seconds"],
          ]}
        />

        <Text size="2" color="gray" as="p">
          At a 10-second sample interval, the node records about 360 readings per
          hour, or about 2,880 readings over an 8-hour field session. That is
          small for SQLite and reasonable for delayed batch upload.
        </Text>
      </Section>

      {/* ---- Battery ---- */}
      <Section title="Battery and Power">
        <Text size="2" color="gray" as="p">
          A Pi Zero 2 W plus PMS5003 plus GPS plus USB serial adapter draws too
          much current for very small batteries. The PiSugar 3 Plus gives the
          standard mobile node an integrated battery and power-management layer
          while keeping the build compact.
        </Text>

        <InfoTable
          headers={["Battery", "Use"]}
          rows={[
            [
              <PartLink key="battery-pisugar-3-plus" href={PISUGAR_3_PLUS_URL}>PiSugar 3 Plus</PartLink>,
              "Recommended integrated battery and power-management module",
            ],
            ["External 5 V / 3 A USB-C power", "Useful for bench testing and long indoor setup sessions"],
            ["Spare charged module", "Useful when field sessions exceed one battery cycle"],
          ]}
        />

        <Text size="2" color="gray" as="p">
          Recommended mobile setup:
        </Text>

        <CodeBlock>{`PiSugar 3 Plus mounted under the Raspberry Pi Zero 2 W
USB-C charging cable available for setup and recovery
Power budget tested with PMS5003, GPS, DHT22, and USB serial attached`}</CodeBlock>

        <Text size="2" color="gray" as="p">
          Validate runtime with the final enclosure, sample interval, Wi-Fi
          behavior, and GPS placement. Sensor warm-up and weak Wi-Fi can change
          the real power draw.
        </Text>
      </Section>

      {/* ---- Physical Layout ---- */}
      <Section title="Physical Layout">
        <CodeBlock>{`Main enclosure:
  - Raspberry Pi Zero 2 W
  - PiSugar 3 Plus
  - USB serial adapter
  - wiring strain relief

Ventilated air path:
  - PMS5003 air inlet/outlet
  - protected from rain and road debris

Sky-facing or upper-frame area:
  - GPS FeatherWing with less body or metal obstruction

Shielded airflow area:
  - DHT22
  - away from Pi heat, battery heat, direct sun, and rain`}</CodeBlock>

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
          later. Locally, store details such as GPS status, HDOP, battery level,
          PMS checksum failures, upload attempts, and last upload error.
        </Text>

        <InfoTable
          headers={["Flag", "Meaning"]}
          rows={[
            ["0", "Normal"],
            ["1", "GPS missing"],
            ["2", "Sensor read failed"],
            ["4", "Weak GPS precision"],
            ["8", "Low battery"],
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
