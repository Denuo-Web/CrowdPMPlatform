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

const LAST_UPDATED = "May 10, 2026";
const COMPANY_NAME = "Denuo Web, LLC";
const COMPANY_CONTACT_EMAIL = "info@denuoweb.com";
const COMPANY_LICENSE_EMAIL = "license@denuoweb.com";
const COMPANY_MAILING_ADDRESS = "1292 High Street PMB 222, Eugene, OR 97401";

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
        quality monitoring platform operated by {COMPANY_NAME}. By creating an account or using the
        hosted service, you agree to these terms.
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

      <Section title="3. Submitted Data">
        <P>
          You keep whatever rights you have in sensor data and other content you submit. You grant
          {` ${COMPANY_NAME} `}a license to host, store, process, analyze, reproduce, moderate,
          display, publish, and distribute submitted data as needed to operate, secure, improve, and
          make CrowdPM available.
        </P>
        <P>
          Batch visibility controls whether measurement batches are public or private. Public batches
          may appear on the public map and public API responses with PM2.5 values, coordinates,
          timestamps, device identifiers, device names, and batch metadata. Private batches are
          limited to your account and authorized administrators, subject to operational, security, and
          legal needs.
        </P>
        <P>
          Do not submit measurements from locations where you do not have the right to collect or
          share location-linked data, and do not submit sensitive personal information through sensor
          names, device names, batch data, moderation reasons, or support messages.
        </P>
      </Section>

      <Section title="4. Acceptable Use">
        <BulletList>
          <Bullet>Do not interfere with the service, bypass access controls, or probe systems without permission.</Bullet>
          <Bullet>Do not submit malicious, fraudulent, misleading, unlawful, or privacy-invasive data.</Bullet>
          <Bullet>Do not impersonate another person, misrepresent device ownership, or pair devices you are not authorized to use.</Bullet>
          <Bullet>Do not use CrowdPM in a way that would violate law, third-party rights, or these terms.</Bullet>
        </BulletList>
      </Section>

      <Section title="5. Moderation and Availability">
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

      <Section title="6. Open Source and Commercial Licensing">
        <P>
          Source code use is governed by the separate CrowdPM license, not by these service terms.
          Review the License modal and the repository license before copying, modifying, deploying,
          or incorporating CrowdPM code.
        </P>
      </Section>

      <Section title="7. Disclaimers and Liability">
        <P>
          CrowdPM is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind. To the
          fullest extent permitted by law, {COMPANY_NAME} disclaims implied warranties including
          merchantability, fitness for a particular purpose, accuracy, non-infringement, and
          uninterrupted availability.
        </P>
        <P>
          To the fullest extent permitted by law, {COMPANY_NAME} will not be liable for indirect,
          incidental, special, consequential, exemplary, or punitive damages, or for loss of data,
          profits, goodwill, or service availability arising from CrowdPM.
        </P>
      </Section>

      <Section title="8. Changes and Contact">
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
          <Bullet>Moderation and administration records, including moderator user IDs, role changes, disabled account status, moderation reasons, and audit records.</Bullet>
          <Bullet>Technical and security data, including IP address or network hints, request headers, logs, rate-limit keys, browser/device information available to the service, and error diagnostics.</Bullet>
          <Bullet>Local browser storage, including recent map zoom, timeline position, smoke-test selections, and cached batch data used to keep the interface responsive.</Bullet>
          <Bullet>Communications you send to us, including email or support messages.</Bullet>
        </BulletList>
        <P>
          As currently implemented, CrowdPM does not include payment processing, third-party
          advertising analytics, or marketing pixels in the application code.
        </P>
      </Section>

      <Section title="2. How We Use Information">
        <BulletList>
          <Bullet>Provide authentication, device pairing, ingest, map display, dashboards, moderation, and administration features.</Bullet>
          <Bullet>Store and process sensor measurements, enforce visibility choices, and show public batches on the map and public API.</Bullet>
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
          If you do not want location-linked measurements to be public, keep the relevant device or
          batch visibility set to private and avoid submitting sensitive labels or names.
        </P>
      </Section>

      <Section title="4. How We Share Information">
        <BulletList>
          <Bullet>With Google Firebase and Google Cloud services used for authentication, hosting, functions, Firestore, storage, and operational logs.</Bullet>
          <Bullet>With the public, when you or a device under your account submits public approved batch data.</Bullet>
          <Bullet>With authorized moderators and administrators who need access to operate, secure, moderate, or support CrowdPM.</Bullet>
          <Bullet>When required to comply with law, protect rights and safety, investigate abuse, or enforce terms.</Bullet>
          <Bullet>In aggregated or de-identified forms that do not reasonably identify a person.</Bullet>
        </BulletList>
        <P>
          We do not sell personal information as part of the current CrowdPM implementation.
        </P>
      </Section>

      <Section title="5. Retention and Deletion">
        <P>
          Account, device, settings, token, audit, log, and measurement records are retained for as
          long as needed to provide CrowdPM, maintain integrity of the shared dataset, comply with
          legal obligations, resolve disputes, and enforce terms. Batch deletion in the dashboard
          removes the stored payload and batch record for that batch.
        </P>
        <P>
          You may request access, correction, export, or deletion of personal information by contacting
          us. Some records may be retained where required for security, legal compliance, backups,
          audit integrity, or legitimate operational purposes.
        </P>
      </Section>

      <Section title="6. Security">
        <P>
          CrowdPM uses Firebase Authentication, owner checks, role-based authorization, device
          pairing, token controls, DPoP-oriented device flows, rate limits, moderation controls, and
          cloud provider security features. No online service can guarantee perfect security.
        </P>
      </Section>

      <Section title="7. Children">
        <P>
          CrowdPM is not directed to children under 13, and we do not knowingly collect personal
          information from children under 13. Contact us if you believe a child provided personal
          information.
        </P>
      </Section>

      <Section title="8. Contact">
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
          CrowdPM source code is available in the{" "}
          <ExternalLink href={PROJECT_LINKS.repository} color="iris" highContrast>
            Denuo-Web/CrowdPMPlatform repository
          </ExternalLink>{" "}
          and is dual-licensed under the GNU Affero General Public License version 3.0 or later and a
          separate commercial license from {COMPANY_NAME}.
        </P>
        <P>
          The AGPL option lets you copy, modify, run, and distribute covered code if you comply with
          the AGPL, including its source availability requirements for modified network services.
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
      </Section>

      <Section title="2. Commercial License">
        <P>
          Organizations or individuals that want proprietary terms, private modifications, custom
          support, or rights outside the AGPL may need a separate commercial license. Contact{" "}
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

      <Section title="4. Public Dataset">
        <P>
          Public approved measurements may be displayed through CrowdPM maps and public API responses.
          Because public data can be copied by others, do not mark a batch public unless you are
          comfortable with its location-linked measurement data being publicly available.
        </P>
      </Section>

      <Section title="5. Trademarks and Third-Party Software">
        <P>
          The names CrowdPM, Denuo Web, and related logos or branding are not licensed for unrelated
          commercial branding unless {COMPANY_NAME} grants that permission separately. CrowdPM also
          includes third-party open-source dependencies, which remain subject to their own licenses.
        </P>
      </Section>

      <Section title="6. No Warranty">
        <P>
          CrowdPM code, datasets, and hosted service features are provided without warranty to the
          fullest extent permitted by law. See the repository license and Terms of Service for
          warranty and liability details.
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
