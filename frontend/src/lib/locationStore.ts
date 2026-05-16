import { useSyncExternalStore } from "react";

export type BrowserLocationSnapshot = {
  href: string;
  pathname: string;
  search: string;
  hash: string;
};

const LOCATION_CHANGE_EVENT = "crowdpm:locationchange";
const SERVER_LOCATION: BrowserLocationSnapshot = {
  href: "https://crowdpmplatform.web.app/",
  pathname: "/",
  search: "",
  hash: "",
};

let cachedBrowserLocation: BrowserLocationSnapshot = SERVER_LOCATION;

function readBrowserLocation(): BrowserLocationSnapshot {
  if (typeof window === "undefined") return SERVER_LOCATION;
  const { href, pathname, search, hash } = window.location;
  if (
    cachedBrowserLocation.href === href
    && cachedBrowserLocation.pathname === pathname
    && cachedBrowserLocation.search === search
    && cachedBrowserLocation.hash === hash
  ) {
    return cachedBrowserLocation;
  }
  cachedBrowserLocation = { href, pathname, search, hash };
  return cachedBrowserLocation;
}

function emitLocationChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT));
}

function subscribeToBrowserLocation(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(LOCATION_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(LOCATION_CHANGE_EVENT, onStoreChange);
  };
}

export function useBrowserLocation(): BrowserLocationSnapshot {
  return useSyncExternalStore(subscribeToBrowserLocation, readBrowserLocation, () => SERVER_LOCATION);
}

export function pushAppLocation(url: string | URL): void {
  if (typeof window === "undefined") return;
  window.history.pushState({}, "", url);
  emitLocationChange();
}

export function replaceAppLocation(url: string | URL): void {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, "", url);
  emitLocationChange();
}

export function replaceCurrentUrl(updater: (url: URL) => void): void {
  if (typeof window === "undefined") return;
  const nextUrl = new URL(window.location.href);
  updater(nextUrl);
  replaceAppLocation(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}
