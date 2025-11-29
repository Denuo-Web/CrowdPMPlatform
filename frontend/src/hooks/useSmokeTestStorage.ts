import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BatchVisibility, IngestSmokeTestPayload, IngestSmokeTestResponse } from "../lib/api";
import { decodeBatchKey, encodeBatchKey } from "../lib/batchKeys";
import { logWarning } from "../lib/logger";
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet } from "../lib/storage";
import type { SmokeHistoryItem } from "../types/smokeTest";

type StorageConfig = {
  historyKey: string;
  lastDeviceKey: string;
  selectionKey: string;
  batchCacheKey: string;
  userId?: string | null;
  parseHistory: (raw: string | null) => SmokeHistoryItem[];
};

type StorageListener = () => void;

const storageListeners = new Map<string, Set<StorageListener>>();
const storageCache = new Map<string, unknown>();

function storageListenerKey(baseKey: string, userId?: string | null): string {
  return `${userId ?? "anon"}:${baseKey}`;
}

function subscribeToStorage(key: string, listener: StorageListener): () => void {
  let listeners = storageListeners.get(key);
  if (!listeners) {
    listeners = new Set();
    storageListeners.set(key, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      storageListeners.delete(key);
    }
  };
}

function publishStorageChange(key: string): void {
  const listeners = storageListeners.get(key);
  if (!listeners) return;
  listeners.forEach((listener) => listener());
}

function setCachedValue<T>(key: string, value: T): void {
  storageCache.set(key, value);
}

function getCachedValue<T>(key: string): T | undefined {
  return storageCache.get(key) as T | undefined;
}

function clearCachedValue(key: string): void {
  storageCache.delete(key);
}

export function usePersistedSmokePayload(config: {
  storageKey: string;
  defaultPayload: string;
  userId?: string | null;
  onLoad?: (raw: string) => void;
}) {
  const { storageKey, defaultPayload, userId, onLoad } = config;
  const listenerKey = storageListenerKey(storageKey, userId);

  useEffect(() => {
    clearCachedValue(listenerKey);
    publishStorageChange(listenerKey);
  }, [defaultPayload, listenerKey]);

  const getPayloadSnapshot = useCallback(() => {
    const cached = getCachedValue<string>(listenerKey);
    if (cached !== undefined) return cached;
    const stored = safeLocalStorageGet(
      storageKey,
      defaultPayload,
      { context: "smoke-test:payload:load", userId }
    );
    const next = stored ?? defaultPayload;
    setCachedValue(listenerKey, next);
    return next;
  }, [defaultPayload, listenerKey, storageKey, userId]);

  const payload = useSyncExternalStore(
    useCallback((listener) => subscribeToStorage(listenerKey, listener), [listenerKey]),
    getPayloadSnapshot,
    getPayloadSnapshot
  );

  const setPayload = useCallback<Dispatch<SetStateAction<string>>>((next) => {
    const resolved = typeof next === "function" ? next(getPayloadSnapshot()) : next;
    setCachedValue(listenerKey, resolved);
    if (userId) {
      safeLocalStorageSet(
        storageKey,
        resolved,
        { context: "smoke-test:payload:save", userId }
      );
    }
    publishStorageChange(listenerKey);
  }, [getPayloadSnapshot, listenerKey, storageKey, userId]);

  useEffect(() => {
    onLoad?.(payload);
  }, [onLoad, payload]);

  return [payload, setPayload] as const;
}

export function useSmokeTestStorage(config: StorageConfig) {
  const {
    historyKey,
    lastDeviceKey,
    selectionKey,
    batchCacheKey,
    userId,
    parseHistory,
  } = config;

  const historyListenerKey = storageListenerKey(historyKey, userId);

  useEffect(() => {
    clearCachedValue(historyListenerKey);
    publishStorageChange(historyListenerKey);
  }, [historyListenerKey, parseHistory]);

  const getHistorySnapshot = useCallback(() => {
    const cached = getCachedValue<SmokeHistoryItem[]>(historyListenerKey);
    if (cached !== undefined) return cached;
    const stored = safeLocalStorageGet(
      historyKey,
      null,
      { context: "smoke-test:history:load", userId }
    );
    const parsed = parseHistory(stored);
    setCachedValue(historyListenerKey, parsed);
    return parsed;
  }, [historyKey, historyListenerKey, parseHistory, userId]);

  const history = useSyncExternalStore(
    useCallback((listener) => subscribeToStorage(historyListenerKey, listener), [historyListenerKey]),
    getHistorySnapshot,
    getHistorySnapshot
  );
  const historyRef = useRef<SmokeHistoryItem[]>(history);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const persistHistory = useCallback((nextHistory: SmokeHistoryItem[]) => {
    historyRef.current = nextHistory;
    setCachedValue(historyListenerKey, nextHistory);
    if (userId) {
      safeLocalStorageSet(
        historyKey,
        JSON.stringify(nextHistory),
        { context: "smoke-test:history:save", userId }
      );
    }
    publishStorageChange(historyListenerKey);
  }, [historyKey, historyListenerKey, userId]);

  const updateHistory = useCallback((updater: (prev: SmokeHistoryItem[]) => SmokeHistoryItem[]) => {
    const next = updater(historyRef.current);
    persistHistory(next);
    return next;
  }, [persistHistory]);

  const persistRunArtifacts = useCallback((args: {
    result: IngestSmokeTestResponse;
    payload: IngestSmokeTestPayload;
    visibility: BatchVisibility;
  }) => {
    if (!userId) return;
    const cachePoints = Array.isArray(args.result.points) && args.result.points.length
      ? args.result.points
      : args.payload.points;
    safeLocalStorageSet(
      lastDeviceKey,
      args.result.deviceId,
      { context: "smoke-test:last-device", userId }
    );
    safeLocalStorageSet(
      selectionKey,
      encodeBatchKey(args.result.deviceId, args.result.batchId),
      { context: "smoke-test:selection", userId }
    );
    if (cachePoints?.length) {
      const cachePayload = {
        summary: {
          batchId: args.result.batchId,
          deviceId: args.result.deviceId,
          deviceName: null,
          count: cachePoints.length,
          processedAt: new Date().toISOString(),
          visibility: args.result.visibility ?? args.visibility,
        },
        points: cachePoints,
      };
      safeLocalStorageSet(
        batchCacheKey,
        JSON.stringify(cachePayload),
        { context: "smoke-test:cache", userId }
      );
    }
    else {
      safeLocalStorageRemove(
        batchCacheKey,
        { context: "smoke-test:cache-clear", userId }
      );
    }
  }, [batchCacheKey, lastDeviceKey, selectionKey, userId]);

  const clearArtifactsForDevices = useCallback((deviceIds: string[]) => {
    if (!userId || !deviceIds.length) return;
    const targetIds = new Set(deviceIds);
    const last = safeLocalStorageGet(
      lastDeviceKey,
      null,
      { context: "smoke-test:last-device:read", userId }
    );
    if (last && targetIds.has(last)) {
      safeLocalStorageRemove(lastDeviceKey, { context: "smoke-test:last-device:clear", userId });
    }
    const lastSelection = decodeBatchKey(safeLocalStorageGet(
      selectionKey,
      null,
      { context: "smoke-test:selection:read", userId }
    ));
    if (lastSelection && targetIds.has(lastSelection.deviceId)) {
      safeLocalStorageRemove(selectionKey, { context: "smoke-test:selection:clear", userId });
    }
    const cachedRaw = safeLocalStorageGet(
      batchCacheKey,
      null,
      { context: "smoke-test:cache:read", userId }
    );
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { summary?: { deviceId?: string } } | null;
        if (cached?.summary?.deviceId && targetIds.has(cached.summary.deviceId)) {
          safeLocalStorageRemove(batchCacheKey, { context: "smoke-test:cache-clear", userId });
        }
      }
      catch (err) {
        logWarning("Failed to parse cached batch during device cleanup", { userId, deviceIds }, err);
        safeLocalStorageRemove(batchCacheKey, { context: "smoke-test:cache-clear", userId });
      }
    }
  }, [batchCacheKey, lastDeviceKey, selectionKey, userId]);

  const clearArtifactsForBatch = useCallback((deviceId: string, batchId: string) => {
    if (!userId) return;
    const lastSelection = decodeBatchKey(safeLocalStorageGet(
      selectionKey,
      null,
      { context: "smoke-test:selection:read", userId }
    ));
    if (lastSelection && lastSelection.deviceId === deviceId && lastSelection.batchId === batchId) {
      safeLocalStorageRemove(selectionKey, { context: "smoke-test:selection:clear", userId });
    }
    const cachedRaw = safeLocalStorageGet(
      batchCacheKey,
      null,
      { context: "smoke-test:cache:read", userId }
    );
    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as { summary?: { deviceId?: string; batchId?: string } } | null;
        if (
          cached?.summary?.deviceId === deviceId
          && cached.summary.batchId === batchId
        ) {
          safeLocalStorageRemove(batchCacheKey, { context: "smoke-test:cache-clear", userId });
        }
      }
      catch (err) {
        logWarning("Failed to parse cached batch during batch cleanup", { userId, deviceId, batchId }, err);
        safeLocalStorageRemove(batchCacheKey, { context: "smoke-test:cache-clear", userId });
      }
    }
  }, [batchCacheKey, selectionKey, userId]);

  return {
    history,
    historyRef,
    persistHistory,
    updateHistory,
    persistRunArtifacts,
    clearArtifactsForDevices,
    clearArtifactsForBatch,
  };
}
