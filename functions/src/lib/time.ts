import type { TimestampInput } from "@crowdpm/types";

export type TimestampLike = TimestampInput;

function hasToDate(value: unknown): value is { toDate: () => Date | null } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { toDate?: () => Date | null }).toDate === "function";
}

function hasToMillis(value: unknown): value is { toMillis: () => number } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { toMillis?: () => number }).toMillis === "function";
}

export function toDate(input: unknown): Date | null {
  const value = input as TimestampInput;
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? new Date(value) : null;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (hasToDate(value)) {
    try {
      const date = value.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date;
      }
    }
    catch {
      // Fall through to toMillis when available.
    }
  }
  if (hasToMillis(value)) {
    try {
      const millis = value.toMillis();
      return Number.isFinite(millis) ? new Date(millis) : null;
    }
    catch {
      return null;
    }
  }
  return null;
}

export function timestampToMillis(input: unknown): number | null {
  const date = toDate(input);
  return date ? date.getTime() : null;
}

export function timestampToIsoString(input: unknown): string | null {
  const date = toDate(input);
  return date ? date.toISOString() : null;
}
