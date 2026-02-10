import type { FastifyReply } from "fastify";
import { RateLimitError } from "./rateLimiter.js";

export type NormalizedHttpError = {
  statusCode: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

type HttpErrorMeta = Record<string, unknown>;

const RESERVED_BODY_KEYS = new Set(["error", "message", "error_description"]);

const DEFAULT_ERROR_BY_STATUS: Record<number, string> = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  406: "not_acceptable",
  408: "request_timeout",
  409: "conflict",
  410: "gone",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable_entity",
  429: "rate_limited",
  500: "unexpected_error",
  502: "bad_gateway",
  503: "service_unavailable",
  504: "gateway_timeout",
};

function defaultErrorCodeForStatus(statusCode: number): string {
  if (DEFAULT_ERROR_BY_STATUS[statusCode]) return DEFAULT_ERROR_BY_STATUS[statusCode];
  if (statusCode >= 500) return "unexpected_error";
  if (statusCode >= 400) return "bad_request";
  return "unexpected_error";
}

function normalizeErrorCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const normalized = code
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return normalized || null;
}

function cleanMeta(meta: unknown): HttpErrorMeta | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const out: HttpErrorMeta = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export function httpError(
  statusCode: number,
  error: string,
  message?: string,
  meta?: HttpErrorMeta
): Error & { statusCode: number; code: string; meta?: HttpErrorMeta } {
  const normalizedCode = normalizeErrorCode(error) ?? defaultErrorCodeForStatus(statusCode);
  const err = new Error(message ?? "") as Error & { statusCode: number; code: string; meta?: HttpErrorMeta };
  err.statusCode = statusCode;
  err.code = normalizedCode;
  const cleanedMeta = cleanMeta(meta);
  if (cleanedMeta) err.meta = cleanedMeta;
  return err;
}

function statusCodeFrom(err: unknown, fallbackStatusCode: number): number {
  const statusCode = typeof err === "object" && err && "statusCode" in err
    ? Number((err as { statusCode: unknown }).statusCode)
    : Number.NaN;
  return Number.isFinite(statusCode) && statusCode >= 100 ? statusCode : fallbackStatusCode;
}

function errorCodeFrom(err: unknown, statusCode: number): string {
  if (err instanceof RateLimitError) return "rate_limited";
  if (typeof err === "object" && err) {
    const code = (err as { code?: unknown }).code;
    const normalizedCode = normalizeErrorCode(code);
    if (normalizedCode) return normalizedCode;
    const reason = (err as { reason?: unknown }).reason;
    const normalizedReason = normalizeErrorCode(reason);
    if (normalizedReason) return normalizedReason;
  }
  return defaultErrorCodeForStatus(statusCode);
}

function messageFrom(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message?: string }).message;
  }
  return undefined;
}

function headersFrom(err: unknown): Record<string, string> | undefined {
  if (!err || typeof err !== "object") return undefined;
  const rawHeaders = (err as { headers?: unknown }).headers;
  if (!rawHeaders || typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") headers[key] = value;
    else if (typeof value === "number" || typeof value === "boolean") headers[key] = String(value);
  }
  return Object.keys(headers).length ? headers : undefined;
}

function metaFrom(err: unknown): HttpErrorMeta | undefined {
  if (!err || typeof err !== "object") return undefined;
  return cleanMeta((err as { meta?: unknown }).meta);
}

function withMessageAliases(body: Record<string, unknown>, message: string | undefined): void {
  if (!message || message.trim().length === 0) return;
  body.message = message;
  body.error_description = message;
}

function mergeMeta(body: Record<string, unknown>, meta: HttpErrorMeta | undefined): void {
  if (!meta) return;
  for (const [key, value] of Object.entries(meta)) {
    if (RESERVED_BODY_KEYS.has(key)) continue;
    if (value === undefined) continue;
    body[key] = value;
  }
}

export function toHttpError(err: unknown, fallbackStatusCode = 500): NormalizedHttpError {
  if (err instanceof RateLimitError) {
    const retryAfter = Math.max(1, err.retryAfterSeconds);
    return {
      statusCode: err.statusCode,
      headers: { "retry-after": String(retryAfter) },
      body: { error: "rate_limited", retry_after: retryAfter },
    };
  }
  const statusCode = statusCodeFrom(err, fallbackStatusCode);
  const error = errorCodeFrom(err, statusCode);
  const message = messageFrom(err);
  const body: Record<string, unknown> = { error };
  withMessageAliases(body, message);
  mergeMeta(body, metaFrom(err));
  const headers = headersFrom(err);
  return { statusCode, body, headers };
}

export function sendHttpError(rep: FastifyReply, err: unknown, fallbackStatusCode = 500) {
  const normalized = toHttpError(err, fallbackStatusCode);
  if (normalized.headers) rep.headers(normalized.headers);
  return rep.code(normalized.statusCode).send(normalized.body);
}
