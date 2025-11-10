import type { IncomingHttpHeaders } from "node:http";

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === "string" && entry.trim().length > 0)?.trim() ?? "";
  }
  return typeof value === "string" ? value.trim() : "";
}

export function canonicalRequestUrl(url: string | undefined, headers: IncomingHttpHeaders): string {
  const proto = firstHeaderValue(headers["x-forwarded-proto"])
    || firstHeaderValue(headers[":scheme"])
    || "https";
  const host = firstHeaderValue(headers["x-forwarded-host"]) || firstHeaderValue(headers.host);
  if (!host) {
    throw new Error("Unable to determine request host");
  }
  const cleaned = (url ?? "/").split("#", 1)[0] || "/";
  const normalizedPath = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return `${proto.toLowerCase()}://${host.toLowerCase()}${normalizedPath}`;
}

export function extractClientIp(headers: IncomingHttpHeaders): string | null {
  const forwardedFor = firstHeaderValue(headers["x-forwarded-for"]);
  if (forwardedFor) {
    const ip = forwardedFor.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const realIp = firstHeaderValue(headers["x-real-ip"]);
  if (realIp) return realIp;
  const appEngineIp = firstHeaderValue(headers["x-appengine-user-ip"]);
  if (appEngineIp) return appEngineIp;
  return null;
}

export function coarsenIpForDisplay(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes(":")) {
    const segments = ip.split(":").slice(0, 4).map((segment) => segment || "0");
    return `${segments.join(":")}::/64`;
  }
  const octets = ip.split(".");
  if (octets.length !== 4) return ip;
  return `${octets[0]}.${octets[1]}.${octets[2]}.0/24`;
}

export function deriveNetworkHint(headers: IncomingHttpHeaders, ip: string | null): string | null {
  const explicit =
    firstHeaderValue(headers["cf-asn"])
    || firstHeaderValue(headers["x-client-asn"])
    || firstHeaderValue(headers["x-geoip-asnum"]);
  if (explicit) {
    return `AS${explicit.replace(/^AS/i, "")}`;
  }
  if (!ip) return null;
  if (ip.includes(":")) {
    const hextets = ip.split(":").slice(0, 3).map((segment) => segment || "0");
    return `v6-${hextets.join(":")}`;
  }
  const octets = ip.split(".");
  if (octets.length !== 4) return null;
  return `v4-${octets[0]}.${octets[1]}`;
}
