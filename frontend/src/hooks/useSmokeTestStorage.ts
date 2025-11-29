import { useCallback, useEffect, useRef, useState } from "react";
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

export function usePersistedSmokePayload(config: {
  storageKey: string;
  defaultPayload: string;
  userId?: string | null;
  onLoad?: (raw: string) => void;
}) {
  const { storageKey, defaultPayload, userId, onLoad } = config;
  const [payload, setPayload] = useState<string>(defaultPayload);

  useEffect(() => {
    const stored = safeLocalStorageGet(
      storageKey,
      defaultPayload,
      { context: "smoke-test:payload:load", userId }
    );
    const next = stored ?? defaultPayload;
    setPayload(next);
    onLoad?.(next);
  }, [defaultPayload, onLoad, storageKey, userId]);

  useEffect(() => {
    if (!userId) return;
    safeLocalStorageSet(
      storageKey,
      payload,
      { context: "smoke-test:payload:save", userId }
    );
  }, [payload, storageKey, userId]);

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

  const [history, setHistory] = useState<SmokeHistoryItem[]>([]);
  const historyRef = useRef<SmokeHistoryItem[]>([]);

  useEffect(() => {
    const stored = safeLocalStorageGet(
      historyKey,
      null,
      { context: "smoke-test:history:load", userId }
    );
    const parsed = parseHistory(stored);
    setHistory(parsed);
    historyRef.current = parsed;
  }, [historyKey, parseHistory, userId]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const persistHistory = useCallback((nextHistory: SmokeHistoryItem[]) => {
    setHistory(nextHistory);
    historyRef.current = nextHistory;
    if (userId) {
      safeLocalStorageSet(
        historyKey,
        JSON.stringify(nextHistory),
        { context: "smoke-test:history:save", userId }
      );
    }
  }, [historyKey, userId]);

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
