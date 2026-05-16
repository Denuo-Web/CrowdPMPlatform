export const APP_ROUTES = {
  home: "/",
  map: "/map",
  dashboard: "/dashboard",
  admin: "/admin",
  activation: "/activate",
  pairingGuide: "/pairing-guide",
  about: "/about",
  node: "/node",
  apiDocs: "/api-docs",
} as const;

export type DeepLinkedAppTab = "pairing-info" | "about" | "node" | "api-docs";
export type RoutedAppTab = "home" | "map" | "dashboard" | "admin" | DeepLinkedAppTab;

const ROUTED_TAB_ROUTES: Record<RoutedAppTab, string> = {
  home: APP_ROUTES.home,
  map: APP_ROUTES.map,
  dashboard: APP_ROUTES.dashboard,
  admin: APP_ROUTES.admin,
  "pairing-info": APP_ROUTES.pairingGuide,
  about: APP_ROUTES.about,
  node: APP_ROUTES.node,
  "api-docs": APP_ROUTES.apiDocs,
};

const ROUTED_TAB_ROUTE_ENTRIES = [
  ["map", APP_ROUTES.map],
  ["dashboard", APP_ROUTES.dashboard],
  ["admin", APP_ROUTES.admin],
  ["pairing-info", APP_ROUTES.pairingGuide],
  ["about", APP_ROUTES.about],
  ["node", APP_ROUTES.node],
  ["api-docs", APP_ROUTES.apiDocs],
  ["home", APP_ROUTES.home],
] as const satisfies readonly [RoutedAppTab, string][];

function normalizeAppPathname(pathname: string): string {
  const normalized = pathname.toLowerCase().replace(/\/+$/, "");
  return normalized || "/";
}

export function matchesAppRoute(pathname: string, route: string): boolean {
  const normalizedPathname = normalizeAppPathname(pathname);
  const normalizedRoute = normalizeAppPathname(route);
  if (normalizedRoute === APP_ROUTES.home) {
    return normalizedPathname === normalizedRoute;
  }
  return normalizedPathname === normalizedRoute || normalizedPathname.startsWith(`${normalizedRoute}/`);
}

export function getAppTabFromPath(pathname: string): RoutedAppTab | null {
  const match = ROUTED_TAB_ROUTE_ENTRIES.find((entry) => matchesAppRoute(pathname, entry[1]));
  return match?.[0] ?? null;
}

export function getDeepLinkedAppTab(pathname: string): DeepLinkedAppTab | null {
  const tab = getAppTabFromPath(pathname);
  return tab === "pairing-info" || tab === "about" || tab === "node" || tab === "api-docs" ? tab : null;
}

export function getRouteForAppTab(tab: RoutedAppTab): string {
  return ROUTED_TAB_ROUTES[tab];
}

export function getRouteForDeepLinkedAppTab(tab: DeepLinkedAppTab): string {
  return ROUTED_TAB_ROUTES[tab];
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
