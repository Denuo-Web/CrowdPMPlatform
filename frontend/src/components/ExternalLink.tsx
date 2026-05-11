import type { ComponentProps, ComponentPropsWithoutRef } from "react";
import { Link } from "@radix-ui/themes";

type ExternalLinkProps = Omit<ComponentProps<typeof Link>, "target" | "rel">;
type ExternalAnchorProps = Omit<ComponentPropsWithoutRef<"a">, "target" | "rel">;

const EXTERNAL_LINK_REL = "noopener noreferrer";

export function ExternalLink(props: ExternalLinkProps) {
  return <Link target="_blank" rel={EXTERNAL_LINK_REL} {...props} />;
}

export function ExternalAnchor(props: ExternalAnchorProps) {
  return <a target="_blank" rel={EXTERNAL_LINK_REL} {...props} />;
}
