import type { ComponentPropsWithoutRef } from "react";

type InternalNewTabAnchorProps = Omit<ComponentPropsWithoutRef<"a">, "target" | "rel">;

const INTERNAL_NEW_TAB_REL = "noopener noreferrer";

export function InternalNewTabAnchor(props: InternalNewTabAnchorProps) {
  return <a target="_blank" rel={INTERNAL_NEW_TAB_REL} {...props} />;
}
