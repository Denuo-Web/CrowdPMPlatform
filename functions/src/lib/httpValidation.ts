import { DEFAULT_BATCH_VISIBILITY, normalizeBatchVisibility, type BatchVisibility } from "./batchVisibility.js";
import { httpError } from "./httpError.js";
import { timestampToIsoString } from "./time.js";

function validationError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  return httpError(statusCode, code, message);
}

export function parseDeviceId(raw: unknown, fieldName = "Device id"): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw validationError(400, "invalid_device_id", `${fieldName} is required`);
  }
  return value;
}

export function normalizeTimestamp(input: unknown, options?: { fieldName?: string; required?: boolean }): string | null {
  const normalized = timestampToIsoString(input);
  if (normalized || options?.required === false) return normalized;
  if (options?.required === true) {
    throw validationError(400, "invalid_timestamp", `${options.fieldName ?? "timestamp"} is invalid`);
  }
  return normalized;
}

export function normalizeVisibility(input: unknown): BatchVisibility;
export function normalizeVisibility(input: unknown, fallback: BatchVisibility): BatchVisibility;
export function normalizeVisibility(input: unknown, fallback: null): BatchVisibility | null;
export function normalizeVisibility(
  input: unknown,
  fallback: BatchVisibility | null = DEFAULT_BATCH_VISIBILITY
): BatchVisibility | null {
  return normalizeBatchVisibility(input) ?? fallback;
}
