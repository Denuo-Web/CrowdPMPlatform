import { logWarning, type LogContext } from "./logger";

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function scopedStorageKey(base: string, uid?: string | null): string {
  return uid ? `${base}:${uid}` : base;
}

export function safeLocalStorageGet(key: string, fallback: string | null = null, context?: LogContext): string | null {
  if (!hasWindow()) return fallback;
  try {
    return window.localStorage.getItem(key) ?? fallback;
  }
  catch (err) {
    logWarning("localStorage read failed", { key, ...context }, err);
    return fallback;
  }
}

export function safeLocalStorageSet(key: string, value: string, context?: LogContext): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.setItem(key, value);
  }
  catch (err) {
    logWarning("localStorage write failed", { key, ...context }, err);
  }
}

export function safeLocalStorageRemove(keys: string | string[], context?: LogContext): void {
  if (!hasWindow()) return;
  const targetKeys = Array.isArray(keys) ? keys : [keys];
  try {
    targetKeys.forEach((key) => window.localStorage.removeItem(key));
  }
  catch (err) {
    logWarning("localStorage remove failed", { keys: targetKeys, ...context }, err);
  }
}
