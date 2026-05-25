import type { IncomingHttpHeaders } from "node:http";

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.find((entry) => typeof entry === "string" && entry.trim().length > 0)?.trim() ?? "";
  }
  return typeof value === "string" ? value.trim() : "";
}

function isLocalRuntime(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true"
    || Boolean(process.env.FIREBASE_EMULATOR_HUB)
    || process.env.NODE_ENV === "test";
}

export function stripApiEntryPrefix(url: string | undefined): string {
  const raw = typeof url === "string" && url.length > 0 ? url : "/";
  if (!raw.startsWith("/api")) {
    return raw;
  }

  const nextChar = raw.charAt("/api".length);
  if (nextChar && nextChar !== "/" && nextChar !== "?") {
    return raw;
  }

  const stripped = raw.slice("/api".length);
  if (!stripped) {
    return "/";
  }
  if (stripped.startsWith("?")) {
    return `/${stripped}`;
  }
  return stripped;
}

function normalizeBaseUrl(baseUrl: string): URL {
  const parsed = new URL(baseUrl);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
  return parsed;
}

export function buildCanonicalEndpointUrl(baseUrl: string, requestUrl: string | undefined): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const cleaned = (requestUrl ?? "/").split("#", 1)[0] || "/";
  if (cleaned.startsWith("?")) {
    return `${normalizedBaseUrl.toString()}${cleaned}`;
  }
  if (cleaned.startsWith("/?")) {
    return `${normalizedBaseUrl.toString()}${cleaned.slice(1)}`;
  }
  if (cleaned === "/" || cleaned.length === 0) {
    return normalizedBaseUrl.toString();
  }
  const joinableBaseUrl = new URL(normalizedBaseUrl.toString());
  joinableBaseUrl.pathname = joinableBaseUrl.pathname.replace(/\/+$/u, "");
  joinableBaseUrl.pathname = joinableBaseUrl.pathname.length > 0 ? `${joinableBaseUrl.pathname}/` : "/";
  const relativePath = cleaned === "/"
    ? ""
    : cleaned.startsWith("/")
      ? cleaned.slice(1)
      : cleaned;
  return new URL(relativePath, joinableBaseUrl).toString();
}

export function extractClientIp(headers: IncomingHttpHeaders): string | null {
  const appEngineIp = firstHeaderValue(headers["x-appengine-user-ip"]);
  if (appEngineIp) return appEngineIp;

  if (!isLocalRuntime()) {
    return null;
  }

  const forwardedFor = firstHeaderValue(headers["x-forwarded-for"]);
  if (forwardedFor) {
    const ip = forwardedFor.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const realIp = firstHeaderValue(headers["x-real-ip"]);
  if (realIp) return realIp;
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
  if (isLocalRuntime()) {
    const explicit =
      firstHeaderValue(headers["cf-asn"])
      || firstHeaderValue(headers["x-client-asn"])
      || firstHeaderValue(headers["x-geoip-asnum"]);
    if (explicit) {
      return `AS${explicit.replace(/^AS/i, "")}`;
    }
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
