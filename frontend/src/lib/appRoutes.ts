export const APP_ROUTES = {
  home: "/",
  activation: "/activate",
  pairingGuide: "/pairing-guide",
  about: "/about",
  node: "/node",
} as const;

export type DeepLinkedAppTab = "pairing-info" | "about" | "node";

const DEEP_LINKED_TAB_ROUTES: Record<DeepLinkedAppTab, string> = {
  "pairing-info": APP_ROUTES.pairingGuide,
  about: APP_ROUTES.about,
  node: APP_ROUTES.node,
};

const DEEP_LINKED_TAB_ROUTE_ENTRIES = Object.entries(DEEP_LINKED_TAB_ROUTES) as Array<[DeepLinkedAppTab, string]>;

function normalizeAppPathname(pathname: string): string {
  return pathname.toLowerCase();
}

export function matchesAppRoute(pathname: string, route: string): boolean {
  return normalizeAppPathname(pathname).startsWith(normalizeAppPathname(route));
}

export function getDeepLinkedAppTab(pathname: string): DeepLinkedAppTab | null {
  const normalizedPathname = normalizeAppPathname(pathname);
  const match = DEEP_LINKED_TAB_ROUTE_ENTRIES.find((entry) => normalizedPathname.startsWith(entry[1]));
  return match?.[0] ?? null;
}

export function getRouteForDeepLinkedAppTab(tab: DeepLinkedAppTab): string {
  return DEEP_LINKED_TAB_ROUTES[tab];
}

export function isActivationRoute(pathname: string): boolean {
  return matchesAppRoute(pathname, APP_ROUTES.activation);
}

export function isDeepLinkedAppRoute(pathname: string): boolean {
  return getDeepLinkedAppTab(pathname) !== null;
}

export function openAppRouteInNewTab(route: string): void {
  if (typeof window === "undefined") return;
  window.open(route, "_blank", "noopener,noreferrer");
}
