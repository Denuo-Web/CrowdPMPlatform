import type fastifyCors from "@fastify/cors";
import type { FastifyRequest } from "fastify";
import type { IncomingHttpHeaders } from "node:http";

type FastifyCorsOptions = fastifyCors.FastifyCorsOptions;

type HeaderResponse = {
  setHeader(name: string, value: string): void;
  getHeader?(name: string): number | string | string[] | undefined;
};

const LOCAL_DEVELOPMENT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
] as const;

const DEFAULT_ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const DEFAULT_ALLOWED_HEADERS = "Authorization, Content-Type, DPoP, X-Batch-Visibility";

function isLocalRuntime(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true"
    || Boolean(process.env.FIREBASE_EMULATOR_HUB)
    || process.env.NODE_ENV === "test";
}

function splitConfiguredOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeOrigin(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  }
  catch {
    return null;
  }
}

function configuredAllowedOrigins(): Set<string> {
  const candidates = [
    process.env.FRONTEND_URL,
    process.env.PUBLIC_APP_BASE_URL,
    process.env.DEVICE_ACTIVATION_URL,
    ...splitConfiguredOrigins(process.env.CORS_ALLOWED_ORIGINS),
    ...(isLocalRuntime() ? LOCAL_DEVELOPMENT_ORIGINS : []),
  ];
  return new Set(candidates.map((value) => normalizeOrigin(value)).filter((value): value is string => Boolean(value)));
}

function requestPath(requestUrl: string | undefined): string {
  try {
    return new URL(requestUrl || "/", "https://crowdpm.local").pathname;
  }
  catch {
    return "/";
  }
}

export function isPublicCorsPath(requestUrl: string | undefined): boolean {
  const path = requestPath(requestUrl);
  return path === "/health" || path.startsWith("/v1/public/");
}

export function resolveCorsOrigin(originHeader: string | undefined, requestUrl: string | undefined): boolean {
  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;
  if (isPublicCorsPath(requestUrl)) return true;
  return configuredAllowedOrigins().has(origin);
}

export function fastifyCorsOptionsForRequest(req: FastifyRequest): FastifyCorsOptions {
  const originHeader = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
  return {
    origin: resolveCorsOrigin(originHeader, req.raw.url ?? req.url),
    methods: DEFAULT_ALLOWED_METHODS,
    allowedHeaders: DEFAULT_ALLOWED_HEADERS,
  };
}

function appendVaryOrigin(res: HeaderResponse): void {
  const current = res.getHeader?.("Vary");
  const values = Array.isArray(current) ? current.join(", ") : String(current ?? "");
  if (values.toLowerCase().split(",").map((value) => value.trim()).includes("origin")) {
    return;
  }
  res.setHeader("Vary", values ? `${values}, Origin` : "Origin");
}

function firstHeader(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.find((entry) => entry.trim().length > 0);
  }
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function applyCorsHeaders(
  req: { headers: IncomingHttpHeaders; url?: string },
  res: HeaderResponse,
  options?: { methods?: string }
): boolean {
  appendVaryOrigin(res);
  const origin = firstHeader(req.headers, "origin");
  if (!resolveCorsOrigin(origin, req.url)) {
    return false;
  }
  res.setHeader("Access-Control-Allow-Origin", origin ?? "");
  res.setHeader("Access-Control-Allow-Methods", options?.methods ?? DEFAULT_ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", DEFAULT_ALLOWED_HEADERS);
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}
