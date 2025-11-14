import { Timestamp } from "firebase-admin/firestore";

export type TimestampLike =
  | Timestamp
  | Date
  | number
  | string
  | { toDate?: () => Date | null }
  | null
  | undefined;

function hasToDate(value: unknown): value is { toDate: () => Date | null } {
  return typeof value === "object"
    && value !== null
    && typeof (value as { toDate?: () => Date | null }).toDate === "function";
}

export function toDate(input: unknown): Date | null {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (input instanceof Timestamp) return input.toDate();
  if (typeof input === "number") {
    return Number.isFinite(input) ? new Date(input) : null;
  }
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (hasToDate(input)) {
    try {
      const result = input.toDate();
      return result instanceof Date ? result : null;
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
