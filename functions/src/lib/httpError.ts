import type { FastifyReply } from "fastify";
import { IngestServiceError } from "../services/ingestService.js";
import { SmokeTestServiceError } from "../services/ingestSmokeTestService.js";
import { RateLimitError } from "./rateLimiter.js";

export type NormalizedHttpError = {
  statusCode: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
};

export function httpError(statusCode: number, error: string, message?: string): Error & { statusCode: number; code: string } {
  const err = new Error(message ?? error);
  return Object.assign(err, { statusCode, code: error });
}

function statusCodeFrom(err: unknown, fallbackStatusCode: number): number {
  const statusCode = typeof err === "object" && err && "statusCode" in err
    ? Number((err as { statusCode: unknown }).statusCode)
    : Number.NaN;
  return Number.isFinite(statusCode) && statusCode >= 100 ? statusCode : fallbackStatusCode;
}

function errorCodeFrom(err: unknown): string | null {
  if (err instanceof RateLimitError) return "rate_limited";
  if (err instanceof IngestServiceError) return err.reason;
  if (err instanceof SmokeTestServiceError) return err.reason;
  if (typeof err === "object" && err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && code.trim().length > 0) return code.trim();
    const error = (err as { error?: unknown }).error;
    if (typeof error === "string" && error.trim().length > 0) return error.trim();
  }
  if (err instanceof Error && err.message) return err.message;
  return null;
}

function messageFrom(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err && typeof (err as { message?: unknown }).message === "string") {
    return (err as { message?: string }).message;
  }
  return undefined;
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
  const error = errorCodeFrom(err) ?? "unexpected_error";
  const message = messageFrom(err);
  const body: Record<string, unknown> = { error };
  if (message && message !== error) body.message = message;
  return { statusCode, body };
}

export function sendHttpError(rep: FastifyReply, err: unknown, fallbackStatusCode = 500) {
  const normalized = toHttpError(err, fallbackStatusCode);
  if (normalized.headers) rep.headers(normalized.headers);
  return rep.code(normalized.statusCode).send(normalized.body);
}
