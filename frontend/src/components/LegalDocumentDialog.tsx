import type { ReactNode } from "react";
import { Box, Dialog, Flex, Heading, Link, Separator, Text } from "@radix-ui/themes";
import { ExternalLink } from "./ExternalLink";
import { PROJECT_LINKS } from "../lib/projectLinks";

export type LegalDocumentId = "terms" | "privacy" | "license";

type LegalDocumentDialogProps = {
  documentId: LegalDocumentId | null;
  onOpenChange: (open: boolean) => void;
};

type LegalDocumentLinkProps = {
  documentId: LegalDocumentId;
  children: ReactNode;
  onOpen: (documentId: LegalDocumentId) => void;
};

const LAST_UPDATED = "May 14, 2026";
const COMPANY_NAME = "Denuo Web LLC";
const COMPANY_CONTACT_EMAIL = "info@denuoweb.com";
const COMPANY_LICENSE_EMAIL = "license@denuoweb.com";
const COMPANY_MAILING_ADDRESS = "1292 High Street PMB 222, Eugene, OR 97401";
const AMAZON_ASSOCIATE_DISCLOSURE = "As an Amazon Associate I earn from qualifying purchases.";

const legalDocumentTitles: Record<LegalDocumentId, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  license: "License",
};

export function LegalDocumentLink({ documentId, children, onOpen }: LegalDocumentLinkProps) {
  return (
    <Link
      href={`#${documentId}`}
      color="iris"
      highContrast
      onClick={(event) => {
        event.preventDefault();
        onOpen(documentId);
      }}
    >
      {children}
    </Link>
  );
}

export function LegalDocumentDialog({ documentId, onOpenChange }: LegalDocumentDialogProps) {
  const title = documentId ? legalDocumentTitles[documentId] : "Legal document";

  return (
    <Dialog.Root open={Boolean(documentId)} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="4"
        style={{
          width: "min(760px, 96vw)",
          maxWidth: "760px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <Dialog.Title>{title}</Dialog.Title>
        {documentId ? (
          <Box mt="3">
            {documentId === "terms" ? <TermsOfService /> : null}
            {documentId === "privacy" ? <PrivacyPolicy /> : null}
            {documentId === "license" ? <LicenseTerms /> : null}
          </Box>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}

function UpdatedNotice() {
  return (
    <Text size="2" color="gray" as="p">
      Last updated: {LAST_UPDATED}
    </Text>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box mt="5">
      <Heading as="h3" size="3" mb="2">
        {title}
      </Heading>
      <Flex direction="column" gap="2">
        {children}
      </Flex>
    </Box>
  );
}

function P({ children }: { children: ReactNode }) {
  return (
    <Text size="2" as="p" color="gray">
      {children}
    </Text>
  );
}

function BulletList({ children }: { children: ReactNode }) {
  return (
    <Box asChild pl="4">
      <ul style={{ margin: 0 }}>
        {children}
      </ul>
    </Box>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <Text asChild size="2" color="gray">
      <li>{children}</li>
    </Text>
  );
}

function TermsOfService() {
  return (
    <>
      <UpdatedNotice />
      <P>
        These Terms of Service govern your access to and use of CrowdPM, a crowd-sourced PM2.5 air
        quality monitoring platform operated by {COMPANY_NAME}. By creating an account, using the
        hosted service, or purchasing CrowdPM node hardware, you agree to these terms.
      </P>

      <Section title="1. Service">
        <P>
          CrowdPM lets users pair compatible sensor nodes, submit particulate matter measurements
          with location and timestamp metadata, view public measurements on a 3D map, manage owned
          batches, and participate in moderation workflows where authorized.
        </P>
        <P>
          CrowdPM is for community awareness, research, and educational use. It is not an official
          regulatory, emergency, medical, or safety notification service, and measurements may be
          delayed, incomplete, inaccurate, or unavailable.
        </P>
      </Section>

      <Section title="2. Accounts and Devices">
        <P>
          Accounts are created with email and password authentication through Firebase Authentication.
          You are responsible for keeping your credentials secure and for activity under your account.
        </P>
        <P>
          Devices paired to your account may submit measurements, device identifiers, model/version
          information, public key material, fingerprints, pairing records, and operational status.
          You are responsible for the deployment, calibration, legal placement, and safe operation of
          any hardware you connect to CrowdPM.
        </P>
      </Section>

      <Section title="3. Paid Products and Digital Expansions">
        <P>
          CrowdPM node hardware is sold by {COMPANY_NAME}. Node purchases are one-time hardware
          purchases processed through Stripe Checkout. The base node price is $375 with standard US
          shipping included, before applicable sales tax. Applicable sales tax is calculated during
          checkout from the shipping address.
        </P>
        <P>
          You are purchasing physical CrowdPM node hardware and any expressly listed related services
          from {COMPANY_NAME}. Power source and USB-A-to-micro-USB cable are not included. CrowdPM
          Platform software is open-source software maintained by {COMPANY_NAME} and contributors.
          Purchase of hardware does not restrict your rights under the applicable open-source
          software license.
        </P>
        <P>
          Purchase of a node does not transfer ownership of {COMPANY_NAME} trademarks, branding,
          hosted infrastructure, customer accounts, or proprietary business materials.
        </P>
        <P>
          CrowdPM may also offer one-time digital expansion purchases processed through Stripe
          Checkout. Digital expansions, including the theme save unlock, apply to the purchasing
          CrowdPM account, do not include shipping, and may permanently enable the purchased feature
          for that account after payment completes. Applicable sales tax may be calculated during
          checkout from the billing location.
        </P>
        <P>
          We currently accept node orders only for shipping addresses in the United States. You are
          responsible for providing accurate contact, billing, and shipping information and for any
          local requirements that apply to deploying, powering, mounting, or operating the hardware.
        </P>
        <P>
          Unless a different shipping estimate is stated at checkout or in an order confirmation, we
          expect to ship node hardware within 30 days after completed payment. If we cannot ship
          within the stated time or, if no time was stated, within 30 days, we will contact you with
          a revised shipping date and the option to cancel the unshipped order for a prompt refund.
        </P>
        <P>
          Contact us within 30 days after delivery if a node arrives damaged, defective, or
          materially different from what you ordered. We may ask for reasonable troubleshooting
          details, photographs, diagnostic information, or return of the hardware before issuing a
          replacement, repair, or refund. Shipping charges included in the node price are not
          separately refundable except where required by law or where the entire unshipped order is
          cancelled. This policy does not limit rights that cannot be waived under applicable law.
        </P>
        <P>
          Node hardware, firmware, sensors, GPS, wireless networking, and environmental
          measurements are provided for community, research, and educational use. They are not
          certified safety, medical, emergency, industrial hygiene, or regulatory monitoring
          equipment.
        </P>
      </Section>

      <Section title="4. Submitted Data">
        <P>
          You keep whatever rights you have in sensor data and other content you submit. You grant
          {` ${COMPANY_NAME} `}a license to host, store, process, analyze, reproduce, moderate,
          display, publish, and distribute submitted data as needed to operate, secure, improve, and
          make CrowdPM available.
        </P>
        <P>
          Batch visibility controls whether measurement batches are public or private. Public batches
          may appear on the public map and public API responses only after they are approved for
          publication, with PM2.5 values, submitted coordinates, timestamps, device identifiers,
          device names, and batch metadata. Unless a feature expressly says otherwise, public
          coordinates and timestamps are published at the precision submitted by the device and may
          reveal sensitive location or movement patterns. Private batches are limited to your account
          and authorized administrators, subject to operational, security, and legal needs.
        </P>
        <P>
          Do not submit measurements from locations where you do not have the right to collect or
          share location-linked data, and do not submit sensitive personal information through sensor
          names, device names, batch data, moderation reasons, or support messages.
        </P>
      </Section>

      <Section title="5. Acceptable Use">
        <BulletList>
          <Bullet>Do not interfere with the service, bypass access controls, or probe systems without permission.</Bullet>
          <Bullet>Do not submit malicious, fraudulent, misleading, unlawful, or privacy-invasive data.</Bullet>
          <Bullet>Do not impersonate another person, misrepresent device ownership, or pair devices you are not authorized to use.</Bullet>
          <Bullet>Do not use CrowdPM in a way that would violate law, third-party rights, or these terms.</Bullet>
        </BulletList>
      </Section>

      <Section title="6. Moderation and Availability">
        <P>
          CrowdPM may quarantine, hide, delete, or relabel batches; revoke or suspend devices; disable
          accounts; adjust roles; and preserve audit records where needed to operate the service,
          protect users, investigate abuse, or comply with law.
        </P>
        <P>
          We may change, suspend, or discontinue features, APIs, public datasets, or hosted access at
          any time. Open-source code availability does not guarantee availability of the hosted
          CrowdPM service.
        </P>
      </Section>

      <Section title="7. Open Source and Commercial Licensing">
        <P>
          Source code use is governed by the separate CrowdPM license, not by these service terms.
          Review the License modal and the repository license before copying, modifying, deploying,
          or incorporating CrowdPM code.
        </P>
      </Section>

      <Section title="8. Affiliate and Hardware Links">
        <P>
          {AMAZON_ASSOCIATE_DISCLOSURE} Some hardware links, including Amazon
          Associates or Amazon Influencer links, are paid referral links. If you
          click a paid link and buy something, {COMPANY_NAME} may receive a
          commission at no additional cost to you.
        </P>
        <P>
          Third-party retailers are independent from CrowdPM. Product availability,
          pricing, shipping, returns, warranties, taxes, safety information, and
          retailer customer service are handled by the retailer or manufacturer,
          not CrowdPM, unless you buy CrowdPM hardware directly through our
          checkout. Affiliate links do not mean Amazon or any retailer sponsors,
          endorses, or is responsible for CrowdPM.
        </P>
      </Section>

      <Section title="9. Disclaimers and Liability">
        <P>
          CrowdPM is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind. To the
          fullest extent permitted by law, {COMPANY_NAME} disclaims implied warranties including
          merchantability, fitness for a particular purpose, accuracy, non-infringement, and
          uninterrupted availability.
        </P>
        <P>
          To the fullest extent permitted by law, {COMPANY_NAME} will not be liable for indirect,
          incidental, special, consequential, exemplary, or punitive damages, or for loss of data,
          profits, goodwill, service availability, hardware availability, measurement accuracy, or
          device operation arising from CrowdPM.
        </P>
        <P>
          Nothing in these terms limits any consumer warranty, refund, cancellation, or other rights
          that cannot be waived under applicable law.
        </P>
      </Section>

      <Section title="10. Changes and Contact">
        <P>
          We may update these terms by posting revised terms in the service. Continued use after an
          update means you accept the revised terms.
        </P>
        <P>
          Contact {COMPANY_NAME} at{" "}
          <Link href={`mailto:${COMPANY_CONTACT_EMAIL}`} color="iris" highContrast>
            {COMPANY_CONTACT_EMAIL}
          </Link>{" "}
          or by mail at {COMPANY_MAILING_ADDRESS}.
        </P>
      </Section>
    </>
  );
}

function PrivacyPolicy() {
  return (
    <>
      <UpdatedNotice />
      <P>
        This Privacy Policy explains how {COMPANY_NAME} collects, uses, shares, and protects
        information when you use CrowdPM.
      </P>

      <Section title="1. Information We Collect">
        <BulletList>
          <Bullet>Account information, including email address, Firebase user ID, sign-in metadata, account status, and role claims.</Bullet>
          <Bullet>User settings, including default batch visibility, map/rendering preferences, and theme preferences.</Bullet>
          <Bullet>Device records, including device IDs, optional device names, owner IDs, model/version, status, fingerprints, public key material, pairing codes, token records, and last-seen timestamps.</Bullet>
          <Bullet>Measurement and batch data, including PM2.5 readings, pollutant/unit, latitude, longitude, altitude, precision, timestamp, flags, batch IDs, visibility, moderation state, storage paths, and related metadata.</Bullet>
          <Bullet>Paid product records, including Stripe Checkout session IDs, payment status, customer contact details, billing and shipping addresses where applicable, order totals, tax amounts, shipping details for hardware, receipts, refunds, support messages, and related fulfillment or entitlement records.</Bullet>
          <Bullet>Moderation and administration records, including moderator user IDs, role changes, disabled account status, moderation reasons, and audit records.</Bullet>
          <Bullet>Technical and security data, including IP address or network hints, request headers, logs, rate-limit keys, browser/device information available to the service, and error diagnostics.</Bullet>
          <Bullet>Local browser storage, including recent map zoom, timeline position, and selected batch data used to keep the interface responsive.</Bullet>
          <Bullet>Communications you send to us, including email or support messages.</Bullet>
        </BulletList>
        <P>
          Payment card details are processed by Stripe. CrowdPM receives transaction and fulfillment
          metadata from Stripe but does not store full payment card numbers in the application
          database. As currently implemented, CrowdPM does not include third-party advertising
          analytics or marketing pixels in the application code.
        </P>
      </Section>

      <Section title="2. How We Use Information">
        <BulletList>
          <Bullet>Provide authentication, device pairing, ingest, map display, dashboards, moderation, and administration features.</Bullet>
          <Bullet>Store and process sensor measurements, enforce visibility choices, and show public batches on the map and public API.</Bullet>
          <Bullet>Process paid product purchases, calculate tax, ship hardware orders, grant digital entitlements, send receipts, handle refunds or replacements, and respond to order support requests.</Bullet>
          <Bullet>Protect the service through rate limiting, abuse detection, access controls, logging, audits, token revocation, and troubleshooting.</Bullet>
          <Bullet>Save preferences and improve reliability, usability, and performance.</Bullet>
          <Bullet>Respond to support, licensing, security, or legal requests.</Bullet>
        </BulletList>
      </Section>

      <Section title="3. Public Data">
        <P>
          If a batch is marked public and approved, CrowdPM may display or return its measurement
          points, coordinates, timestamps, device ID, optional device name, and batch metadata to
          anyone through the public map or public API. Public environmental data can be copied or
          reused by others once made available.
        </P>
        <P>
          CrowdPM does not intentionally publish private batches through the public map or public API.
          Public API responses are limited to approved public batches, but the coordinates and
          timestamps in those approved batches may be precise enough to infer where a device traveled,
          where it was stored, or when someone was nearby.
        </P>
        <P>
          If you do not want location-linked measurements to be public, keep the relevant device or
          batch visibility set to private and avoid submitting sensitive labels or names.
        </P>
      </Section>

      <Section title="4. How We Share Information">
        <BulletList>
          <Bullet>With Google Firebase and Google Cloud services used for authentication, hosting, functions, Firestore, storage, and operational logs.</Bullet>
          <Bullet>With Stripe for payment processing, sales tax calculation, checkout, receipts, fraud prevention, refunds, and related payment operations.</Bullet>
          <Bullet>With shipping, fulfillment, repair, or customer-support providers where needed to deliver or support node hardware orders.</Bullet>
          <Bullet>With the public, when you or a device under your account submits public approved batch data.</Bullet>
          <Bullet>With authorized moderators and administrators who need access to operate, secure, moderate, or support CrowdPM.</Bullet>
          <Bullet>When required to comply with law, protect rights and safety, investigate abuse, or enforce terms.</Bullet>
          <Bullet>In aggregated or de-identified forms that do not reasonably identify a person.</Bullet>
        </BulletList>
        <P>
          We do not sell personal information as part of the current CrowdPM implementation.
        </P>
      </Section>

      <Section title="5. Affiliate Links and Third-Party Retailers">
        <P>
          {AMAZON_ASSOCIATE_DISCLOSURE} If you click an Amazon Associates,
          Amazon Influencer, or other third-party retailer link, you leave
          CrowdPM and the retailer may collect information about your visit,
          browser, device, account, purchases, and referral source under its own
          privacy notice.
        </P>
        <P>
          Amazon or another affiliate program may identify that a click came from
          a CrowdPM paid referral link so purchases can be attributed. We may
          receive referral or commission reports, but retailer purchases are
          processed by the retailer and we do not receive your retailer account
          credentials or full payment card details from those links.
        </P>
      </Section>

      <Section title="6. Retention and Deletion">
        <P>
          Account, device, settings, token, audit, log, purchase, fulfillment, support, and
          measurement records are retained for as long as needed to provide CrowdPM, maintain
          integrity of the shared dataset, fulfill orders, comply with tax and legal obligations,
          resolve disputes, and enforce terms. Batch deletion in the dashboard removes the stored
          payload and batch record for that batch.
        </P>
        <P>
          You may request access, correction, export, or deletion of personal information by contacting
          us. Batch data can be reviewed through account dashboard features and exported through
          available product interfaces or by verified request. Deletion requests may result in
          deletion, de-identification, or visibility changes depending on the record type and legal
          requirements.
        </P>
        <P>
          Some records may be retained where required for security, legal compliance, tax and order
          records, backups, abuse investigations, audit integrity, dispute resolution, or legitimate
          operational purposes. We cannot delete copies of public approved data already downloaded,
          cached, or copied by others before a deletion or visibility change is completed.
        </P>
      </Section>

      <Section title="7. Security">
        <P>
          CrowdPM uses Firebase Authentication, owner checks, role-based authorization, device
          pairing, token controls, DPoP-oriented device flows, rate limits, moderation controls, and
          cloud provider security features. No online service can guarantee perfect security.
        </P>
      </Section>

      <Section title="8. Not an Official Health or Safety System">
        <P>
          CrowdPM measurements and maps are provided for community awareness, research, and
          educational use. They are not official regulatory, medical, emergency-response, industrial
          hygiene, or safety alerts, and they should not be used as the sole basis for health,
          evacuation, workplace, or regulatory decisions.
        </P>
      </Section>

      <Section title="9. Children">
        <P>
          CrowdPM is not directed to children under 13, and we do not knowingly collect personal
          information from children under 13. Contact us if you believe a child provided personal
          information.
        </P>
      </Section>

      <Section title="10. Contact">
        <P>
          Contact {COMPANY_NAME} at{" "}
          <Link href={`mailto:${COMPANY_CONTACT_EMAIL}`} color="iris" highContrast>
            {COMPANY_CONTACT_EMAIL}
          </Link>{" "}
          or by mail at {COMPANY_MAILING_ADDRESS}.
        </P>
      </Section>
    </>
  );
}

function LicenseTerms() {
  return (
    <>
      <UpdatedNotice />
      <P>
        This License summary explains how CrowdPM code and submitted data are licensed. It does not
        replace the full repository license or the Terms of Service.
      </P>

      <Section title="1. Source Code">
        <P>
          CrowdPM Platform is open-source software maintained by {COMPANY_NAME} and contributors.
          Source code is available in the{" "}
          <ExternalLink href={PROJECT_LINKS.repository} color="iris" highContrast>
            Denuo-Web/CrowdPMPlatform repository
          </ExternalLink>{" "}
          under the GNU Affero General Public License version 3.0 or later unless another license is
          expressly stated.
        </P>
        <P>
          The AGPL lets you copy, modify, run, and distribute covered code if you comply with the
          AGPL, including its source availability requirements for modified network services.
          Review the{" "}
          <ExternalLink href={PROJECT_LINKS.agpl3} color="iris" highContrast>
            GNU AGPL v3.0
          </ExternalLink>{" "}
          and the{" "}
          <ExternalLink href={PROJECT_LINKS.licenseFile} color="iris" highContrast>
            repository license
          </ExternalLink>{" "}
          for the complete terms.
        </P>
        <P>
          Attribution and public notices are available in{" "}
          <ExternalLink href={PROJECT_LINKS.authorsFile} color="iris" highContrast>
            AUTHORS.md
          </ExternalLink>{" "}
          and{" "}
          <ExternalLink href={PROJECT_LINKS.noticeFile} color="iris" highContrast>
            NOTICE.md
          </ExternalLink>.
        </P>
      </Section>

      <Section title="2. Commercial License">
        <P>
          Commercial licensing may be available from {COMPANY_NAME} for portions of CrowdPM Platform
          owned by, assigned to, or otherwise licensed to {COMPANY_NAME} for that purpose.
          Contributor-owned portions remain subject to their applicable license terms unless separate
          written permission has been obtained. Contact{" "}
          <Link href={`mailto:${COMPANY_LICENSE_EMAIL}`} color="iris" highContrast>
            {COMPANY_LICENSE_EMAIL}
          </Link>{" "}
          for commercial licensing.
        </P>
      </Section>

      <Section title="3. Hosted Service Data">
        <P>
          Sensor measurements, device names, batch metadata, support messages, and other data
          submitted to the hosted CrowdPM service are governed by the Terms of Service and Privacy
          Policy. You retain your rights in submitted data, but you grant {COMPANY_NAME} the service
          license needed to host, process, display, publish, moderate, and distribute it according to
          your visibility settings and the Terms of Service.
        </P>
      </Section>

      <Section title="4. Hardware and Embedded Software">
        <P>
          Buying CrowdPM node hardware transfers ownership of the physical device only. Purchase of
          hardware does not restrict your rights under the applicable open-source software license,
          and it does not transfer ownership of CrowdPM source code, firmware, {COMPANY_NAME}
          trademarks or branding, hosted infrastructure, customer accounts, proprietary business
          materials, datasets, hosted service features, or third-party software included with or used
          by the device.
        </P>
        <P>
          Any CrowdPM firmware, setup scripts, examples, or application code included with a node are
          licensed under the applicable repository license unless a separate written license applies.
          Third-party hardware, firmware, operating system packages, and libraries remain subject to
          their own terms.
        </P>
      </Section>

      <Section title="5. Public Dataset">
        <P>
          Public approved measurements may be displayed through CrowdPM maps and public API responses.
          Because public data can be copied by others, do not mark a batch public unless you are
          comfortable with its location-linked measurement data being publicly available.
        </P>
      </Section>

      <Section title="6. Trademarks and Third-Party Software">
        <P>
          The names CrowdPM, Denuo Web, and related logos or branding are not licensed for unrelated
          commercial branding unless {COMPANY_NAME} grants that permission separately. CrowdPM also
          includes third-party open-source dependencies, which remain subject to their own licenses.
        </P>
      </Section>

      <Section title="7. Affiliate Links and Third-Party Materials">
        <P>
          Affiliate disclosures and retailer links are not software, content, or
          dataset licenses. Amazon Associates, Amazon Influencer, and other
          retailer links do not grant rights to use Amazon marks, product content,
          seller content, third-party product materials, or retailer data except
          as allowed by the applicable owner and program terms.
        </P>
        <P>
          Paid referral links do not mean Amazon or any retailer sponsors,
          endorses, licenses, or is responsible for CrowdPM, the CrowdPM source
          code, the hosted service, or submitted data.
        </P>
      </Section>

      <Section title="8. No Warranty">
        <P>
          CrowdPM code, datasets, hosted service features, and embedded software are provided without
          warranty to the fullest extent permitted by law. See the repository license and Terms of
          Service for hardware, software, warranty, and liability details.
        </P>
      </Section>

      <Separator my="4" />
      <P>
        Licensing questions:{" "}
        <Link href={`mailto:${COMPANY_LICENSE_EMAIL}`} color="iris" highContrast>
          {COMPANY_LICENSE_EMAIL}
        </Link>
      </P>
    </>
  );
}
