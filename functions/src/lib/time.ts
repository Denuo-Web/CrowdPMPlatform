import {
  timestampToDate as sharedTimestampToDate,
  timestampToIsoString as sharedTimestampToIsoString,
  timestampToMillis as sharedTimestampToMillis,
  type TimestampInput,
} from "@crowdpm/types";

export type TimestampLike = TimestampInput;

export function toDate(input: unknown): Date | null {
  return sharedTimestampToDate(input as TimestampInput);
}

export function timestampToMillis(input: unknown): number | null {
  return sharedTimestampToMillis(input as TimestampInput);
}

export function timestampToIsoString(input: unknown): string | null {
  return sharedTimestampToIsoString(input as TimestampInput);
}
