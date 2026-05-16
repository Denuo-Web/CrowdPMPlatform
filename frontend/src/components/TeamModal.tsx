import { Avatar, Dialog, Flex, Heading, IconButton, Link, Separator, Text } from "@radix-ui/themes";
import { GitHubLogoIcon, LinkedInLogoIcon } from "@radix-ui/react-icons";
import { ExternalAnchor, ExternalLink } from "./ExternalLink";
import { PROJECT_LINKS, PROJECT_RESOURCE_LINKS } from "../lib/projectLinks";

const TEAM_MEMBERS: Array<{
  name: string;
  role: string;
  email: string;
  github: string;
  linkedin: string;
}> = [
  {
    name: "Jaron Rosenau",
    role: "Team Lead",
    email: "rosenauj@oregonstate.edu",
    github: "https://github.com/denuoweb",
    linkedin: "https://www.linkedin.com/in/jaronrosenau/",
  },
  {
    name: "Jack Armstrong",
    role: "Team Manager",
    email: "armsjack@oregonstate.edu",
    github: "https://github.com/JackArmstrong22",
    linkedin: "https://www.linkedin.com/in/jack-t-armstrong/",
  },
  {
    name: "Skylar Soon",
    role: "Developer",
    email: "soonsk@oregonstate.edu",
    github: "https://github.com/skylarsoon",
    linkedin: "https://www.linkedin.com/in/skylar-soon/",
  },
  {
    name: "Mark Sparhawk",
    role: "Developer",
    email: "sparhawm@oregonstate.edu",
    github: "https://github.com/MarkSparhawk",
    linkedin: "https://www.linkedin.com/in/mark-sparhawk/",
  },
];

type TeamModalProps = {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  isSignedIn: boolean;
};

export function TeamModal({ open, onOpenChange, isSignedIn }: TeamModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content
        size="4"
        style={{
          width: "min(560px, 96vw)",
          maxWidth: "560px",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <Heading as="h2" size="5" trim="start">
          <ExternalLink href={PROJECT_LINKS.osuEecsProgram} color="iris" highContrast>
            OSU EECS
          </ExternalLink>{" "}
          Capstone Team
        </Heading>
        <Text size="2" color="gray" mt="2">
          Key collaborators for the capstone effort and their primary roles.
        </Text>
        <Flex direction="column" gap="3" mt="4">
          {TEAM_MEMBERS.map((member) => (
            <Flex key={member.name} align="center" gap="3" style={{ width: "100%" }}>
              <Flex align="center" gap="3" style={{ flex: 1, minWidth: 0 }}>
                <Avatar
                  radius="full"
                  size="2"
                  fallback={member.name.charAt(0).toUpperCase() || "?"}
                />
                <Text size="2" weight="medium">
                  <Link href={`mailto:${member.email}`} color="iris" highContrast>
                    {member.name}
                  </Link>
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
                  <ExternalAnchor href={member.github}>
                    <GitHubLogoIcon />
                  </ExternalAnchor>
                </IconButton>
                <IconButton
                  asChild
                  variant="soft"
                  size="1"
                  radius="full"
                  aria-label={`${member.name} LinkedIn profile`}
                >
                  <ExternalAnchor href={member.linkedin}>
                    <LinkedInLogoIcon />
                  </ExternalAnchor>
                </IconButton>
              </Flex>
            </Flex>
          ))}
        </Flex>
        {isSignedIn ? (
          <>
            <Separator my="4" />
            <Text size="2" color="gray">
              Coordination links
            </Text>
            <Flex direction="column" gap="2" mt="2">
              {PROJECT_RESOURCE_LINKS.map((resource) => (
                <ExternalLink
                  key={resource.href}
                  href={resource.href}
                  color="iris"
                  highContrast
                  size="2"
                >
                  {resource.label}
                </ExternalLink>
              ))}
            </Flex>
          </>
        ) : null}
      </Dialog.Content>
    </Dialog.Root>
  );
}
