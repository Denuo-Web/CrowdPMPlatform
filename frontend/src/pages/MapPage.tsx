import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { timestampToIsoString, timestampToMillis } from "@crowdpm/types";
import {
  fetchBatchDetail,
  fetchPublicBatchDetail,
  listBatches,
  listPublicBatches,
  type BatchSummary,
  type MeasurementRecord,
  type IngestSmokeTestResponse,
  type IngestSmokeTestPoint,
  type IngestSmokeTestCleanupResponse,
} from "../lib/api";
import { decodeBatchKey, encodeBatchKey } from "../lib/batchKeys";
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet, scopedStorageKey } from "../lib/storage";
import {
  detectCanvasVideoExportSupport,
  startCanvasRecording,
} from "../lib/videoExport";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";
import type { Map3DCaptureSession, Map3DHandle } from "../components/Map3D";

// Keys used to scope localStorage entries per user so shared browsers do not mix data.
const LAST_SELECTION_KEY = "crowdpm:lastSmokeSelection";
const LAST_SMOKE_CACHE_KEY = "crowdpm:lastSmokeBatchCache";
const BATCH_LIST_STALE_MS = 30_000; // keep batch list warm for 30 seconds to avoid redundant refetches
const SHOW_ALL_PUBLIC_24H_KEY = "__all_public_last_24h__";
const SHOW_ALL_PUBLIC_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const VIDEO_EXPORT_DURATION_MS = 12_000;
const VIDEO_EXPORT_FPS = 30;
const VIDEO_EXPORT_MIN_POINT_MS = 160;
const VIDEO_EXPORT_FINAL_POINT_MS = 320;

// React Query cache keys. Keeping them as helpers avoids typos across the file.
const BATCHES_QUERY_KEY = (uid: string | null | undefined) => ["batches", uid ?? "guest"] as const;
const BATCH_DETAIL_QUERY_KEY = (uid: string, batchKey: string) => ["batchDetail", uid, batchKey] as const;
const Map3D = lazy(() => import("../components/Map3D"));

type StoredSmokeBatch = {
  summary: BatchSummary;
  points: IngestSmokeTestPoint[];
};

type MapMeasurementRecord = MeasurementRecord & {
  batchKey?: string;
  batchPointIndex?: number;
};

// Safely parse a cached smoke batch so stale/invalid JSON never breaks the UI.
function parseStoredSmokeBatch(raw: string | null): StoredSmokeBatch | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { summary?: Partial<BatchSummary>; points?: IngestSmokeTestPoint[] } | null;
    if (!parsed || typeof parsed !== "object") return null;
    const summary = parsed.summary;
    if (
      !summary
      || typeof summary.batchId !== "string"
      || typeof summary.deviceId !== "string"
    ) {
      return null;
    }
    if (!Array.isArray(parsed.points) || !parsed.points.length) {
      return null;
    }
    const normalizedSummary: BatchSummary = {
      batchId: summary.batchId,
      deviceId: summary.deviceId,
      deviceName: typeof summary.deviceName === "string" ? summary.deviceName : null,
      count: typeof summary.count === "number" ? summary.count : parsed.points.length,
      processedAt: timestampToIsoString(summary.processedAt) ?? new Date().toISOString(),
      visibility: summary.visibility === "public" ? "public" : "private",
      moderationState: summary.moderationState === "quarantined" ? "quarantined" : "approved",
    };
    return { summary: normalizedSummary, points: parsed.points };
  }
  catch {
    return null;
  }
}

// When we have a cached batch locally but the server has not returned it yet,
// prepend it so the dropdown still shows the user's latest run.
function mergeCachedSummary(list: BatchSummary[], cached: StoredSmokeBatch | null): BatchSummary[] {
  if (!cached) return list;
  const exists = list.some((batch) => batch.batchId === cached.summary.batchId && batch.deviceId === cached.summary.deviceId);
  if (exists) return list;
  return [cached.summary, ...list];
}

function formatBatchLabel(batch: BatchSummary) {
  const timeMs = timestampToMillis(batch.processedAt);
  const timeLabel = timeMs === null ? "Pending timestamp" : new Date(timeMs).toLocaleString();
  const name = batch.deviceName?.trim().length ? batch.deviceName : batch.deviceId;
  const countLabel = batch.count ? ` (${batch.count})` : "";
  return `${timeLabel} — ${name}${countLabel}`;
}

function pointsToMeasurementRecords(
  points: IngestSmokeTestPoint[],
  fallbackDeviceId: string,
  batchId: string,
  options?: { batchKey?: string }
): MapMeasurementRecord[] {
  return [...points]
    .sort((a, b) => {
      const aTs = timestampToMillis(a.timestamp as unknown as MeasurementRecord["timestamp"]) ?? 0;
      const bTs = timestampToMillis(b.timestamp as unknown as MeasurementRecord["timestamp"]) ?? 0;
      return aTs - bTs;
    })
    .map((point, idx) => {
      const deviceId = typeof point.device_id === "string" && point.device_id.length
        ? point.device_id
        : fallbackDeviceId;
      return {
        id: `${batchId}-${deviceId}-${idx}`,
        deviceId,
        pollutant: "pm25",
        value: point.value,
        unit: point.unit ?? "µg/m³",
        lat: point.lat ?? 0,
        lon: point.lon ?? 0,
        altitude: point.altitude ?? null,
        precision: point.precision ?? null,
        timestamp: point.timestamp,
        flags: point.flags ?? 0,
        batchKey: options?.batchKey,
        batchPointIndex: idx,
      } satisfies MapMeasurementRecord;
    });
}

type MapPageProps = {
  pendingSmokeResult?: IngestSmokeTestResponse | null;
  onSmokeResultConsumed?: () => void;
  pendingCleanupDetail?: IngestSmokeTestCleanupResponse | null;
  onCleanupDetailConsumed?: () => void;
};

function buildClearedSet(detail?: IngestSmokeTestCleanupResponse | null) {
  const cleared = new Set<string>();
  if (!detail) return cleared;
  if (Array.isArray(detail.clearedDeviceIds)) {
    detail.clearedDeviceIds.forEach((id) => {
      if (typeof id === "string" && id.length) cleared.add(id);
    });
  }
  if (typeof detail.clearedDeviceId === "string" && detail.clearedDeviceId.length) {
    cleared.add(detail.clearedDeviceId);
  }
  return cleared;
}

// Utility so we can safely schedule state updates outside React render cycles.
function deferStateUpdate(action: () => void) {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(action);
    return;
  }
  Promise.resolve().then(action).catch(() => {});
}

function waitForAnimationFrame(): Promise<number> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(resolve);
  });
}

async function waitForAnimationFrames(count: number) {
  for (let index = 0; index < count; index += 1) {
    await waitForAnimationFrame();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function sanitizeFileSegment(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "batch";
}

export default function MapPage({
  pendingSmokeResult = null,
  onSmokeResultConsumed,
  pendingCleanupDetail = null,
  onCleanupDetailConsumed,
}: MapPageProps = {}) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { settings } = useUserSettings();
  const queryClient = useQueryClient();

  const userScopedSelectionKey = useMemo(
    () => scopedStorageKey(LAST_SELECTION_KEY, user?.uid ?? undefined),
    [user?.uid]
  );
  const userScopedCacheKey = useMemo(
    () => scopedStorageKey(LAST_SMOKE_CACHE_KEY, user?.uid ?? undefined),
    [user?.uid]
  );

  // Keep track of which batch is selected plus the position in the measurement timeline.
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>("");
  const cacheHydratedRef = useRef<string | null>(null);
  const skipIndexResetRef = useRef(false);
  const map3DRef = useRef<Map3DHandle | null>(null);
  const [captureAvailable, setCaptureAvailable] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [renderedVideoName, setRenderedVideoName] = useState<string | null>(null);
  const [renderedVideoMimeType, setRenderedVideoMimeType] = useState<string | null>(null);
  const recordingSupport = useMemo(() => detectCanvasVideoExportSupport(), []);


  const getCachedBatch = useCallback(() => {
    const raw = safeLocalStorageGet(
      userScopedCacheKey,
      null,
      { context: "map:cache:read", userId: user?.uid }
    );
    return parseStoredSmokeBatch(raw);
  }, [user?.uid, userScopedCacheKey]);

  // Query #1: list of batches visible to the user.
  const batchesQuery = useQuery<BatchSummary[]>({
    queryKey: BATCHES_QUERY_KEY(user?.uid ?? null),
    queryFn: async () => {
      if (!user) {
        return listPublicBatches();
      }
      const [owned, publicBatches] = await Promise.all([
        listBatches().catch(() => []),
        listPublicBatches(),
      ]);
      const merged = mergeCachedSummary(owned, getCachedBatch());
      const byKey = new Map<string, BatchSummary>();
      publicBatches.forEach((batch) => byKey.set(encodeBatchKey(batch.deviceId, batch.batchId), batch));
      merged.forEach((batch) => byKey.set(encodeBatchKey(batch.deviceId, batch.batchId), batch));
      return Array.from(byKey.values());
    },
    enabled: !isAuthLoading,
    placeholderData: (prev) => prev ?? [],
    staleTime: BATCH_LIST_STALE_MS,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.toLowerCase().includes("unauthorized")) return false;
      return failureCount < 3;
    },
  });

  const visibleBatches = useMemo(
    () => batchesQuery.data ?? [],
    [batchesQuery.data]
  );

  const selectedSummary = useMemo(() => {
    if (!selectedBatchKey) return null;
    const parsed = decodeBatchKey(selectedBatchKey);
    if (!parsed) return null;
    return visibleBatches.find((batch) => batch.deviceId === parsed.deviceId && batch.batchId === parsed.batchId) ?? null;
  }, [selectedBatchKey, visibleBatches]);

  const batchDetailQueryKey = useMemo(
    () => (selectedBatchKey ? BATCH_DETAIL_QUERY_KEY(user?.uid ?? "public", selectedBatchKey) : null),
    [selectedBatchKey, user]
  );
  const isShowingAllPublic24h = selectedBatchKey === SHOW_ALL_PUBLIC_24H_KEY;

  // Query #2: measurement detail for the currently selected batch.
  const measurementQuery = useQuery<MapMeasurementRecord[]>({
    queryKey: batchDetailQueryKey ?? ["batchDetail", "idle", "none"],
    enabled: Boolean(batchDetailQueryKey) && !isAuthLoading,
    retry: 5,
    retryDelay: 1_500,
    queryFn: async () => {
      if (!batchDetailQueryKey || !selectedBatchKey) return [];
      if (selectedBatchKey === SHOW_ALL_PUBLIC_24H_KEY) {
        const cutoff = Date.now() - SHOW_ALL_PUBLIC_LOOKBACK_MS;
        const publicSummaries = await listPublicBatches(100);
        const recentSummaries = publicSummaries.filter((batch) => {
          const processedAtMs = timestampToMillis(batch.processedAt);
          return processedAtMs !== null && processedAtMs >= cutoff;
        });
        if (!recentSummaries.length) return [];

        const details = await Promise.all(
          recentSummaries.map(async (batch) => {
            try {
              return await fetchPublicBatchDetail(batch.deviceId, batch.batchId);
            }
            catch (err) {
              console.warn("Unable to load public batch detail", batch.deviceId, batch.batchId, err);
              return null;
            }
          })
        );

        return details
          .flatMap((detail) => {
            if (!detail) return [];
            const batchKey = encodeBatchKey(detail.deviceId, detail.batchId);
            return pointsToMeasurementRecords(detail.points, detail.deviceId, detail.batchId, { batchKey });
          })
          .filter((point) => {
            const timestamp = timestampToMillis(point.timestamp);
            return timestamp !== null && timestamp >= cutoff;
          })
          .sort((a, b) => (timestampToMillis(a.timestamp) ?? 0) - (timestampToMillis(b.timestamp) ?? 0));
      }

      const parsed = decodeBatchKey(selectedBatchKey);
      if (!parsed) return [];

      const shouldUsePrivateDetail = Boolean(user) && selectedSummary !== null && selectedSummary.visibility !== "public";
      const fetchDetail = shouldUsePrivateDetail ? fetchBatchDetail : fetchPublicBatchDetail;
      const detail = await fetchDetail(parsed.deviceId, parsed.batchId);
      return pointsToMeasurementRecords(detail.points, detail.deviceId, detail.batchId, { batchKey: selectedBatchKey });
    },
    retryOnMount: false,
    throwOnError: false,
    placeholderData: (prev) => prev ?? [],
  });

  const rows = useMemo(
    () => measurementQuery.data ?? [],
    [measurementQuery.data]
  );

  const isLoadingBatch = measurementQuery.isFetching || measurementQuery.isLoading;
  const queryError = batchesQuery.error || measurementQuery.error;

  // Whenever a new batch or fresh data arrives, snap the slider to the latest point.
  // useEffect(() => {
  //   const newIndex = rows.length ? rows.length - 1 : 0;
  //   setSelectedIndex(newIndex);
  //   // This effect synchronizes state with data changes - intentional pattern
  //   // eslint-disable-next-line react-hooks/set-state-in-effect
  // }, [rows.length, selectedBatchKey]);
  const [indexOverride, setIndexOverride] = useState<number | null>(null);

  // Always derive the index
  const selectedIndex = indexOverride ?? (rows.length ? rows.length - 1 : 0);

  // Only reset override when the BATCH changes, not when data changes
  useEffect(() => {
    deferStateUpdate(() => {
      if (skipIndexResetRef.current) {
        skipIndexResetRef.current = false;
        return;
      }
      setIndexOverride(null);
    });
  }, [selectedBatchKey]); // Remove rows.length from dependencies

  // // Reset override when data changes
  // useEffect(() => {
  //   setIndexOverride(null);
  // }, [selectedBatchKey, rows.length]);

  // Hydrate the React Query cache with any batch cached in localStorage to show data instantly on refresh.
  useEffect(() => {
    if (!user) {
      cacheHydratedRef.current = null;
      return;
    }
    if (cacheHydratedRef.current === userScopedCacheKey) return;
    const cached = getCachedBatch();
    if (!cached) return;
    cacheHydratedRef.current = userScopedCacheKey;
    const key = encodeBatchKey(cached.summary.deviceId, cached.summary.batchId);
    const records = pointsToMeasurementRecords(cached.points, cached.summary.deviceId, cached.summary.batchId);
    queryClient.setQueryData(BATCH_DETAIL_QUERY_KEY(user.uid, key), records);
    queryClient.setQueryData<BatchSummary[]>(BATCHES_QUERY_KEY(user.uid), (prev = []) => {
      const filtered = prev.filter((batch) => encodeBatchKey(batch.deviceId, batch.batchId) !== key);
      return [cached.summary, ...filtered];
    });
  }, [getCachedBatch, queryClient, user, userScopedCacheKey]);

  const handleBatchSelect = useCallback((value: string) => {
    setSelectedBatchKey(value);
    if (user) {
      if (value) {
        safeLocalStorageSet(
          userScopedSelectionKey,
          value,
          { context: "map:selected-batch:update", userId: user.uid }
        );
      }
      else {
        safeLocalStorageRemove(
          userScopedSelectionKey,
          { context: "map:selected-batch:clear", userId: user.uid }
        );
      }
    }
  }, [user, userScopedSelectionKey]);

  const upsertBatchSummary = useCallback((summary: BatchSummary) => {
    if (!user) return;
    queryClient.setQueryData<BatchSummary[]>(BATCHES_QUERY_KEY(user.uid), (prev = []) => {
      const filtered = prev.filter((batch) => !(batch.batchId === summary.batchId && batch.deviceId === summary.deviceId));
      return [summary, ...filtered];
    });
  }, [queryClient, user]);

  // Process smoke test results delivered via props by priming the React Query cache.
  const processSmokeResult = useCallback((detail: IngestSmokeTestResponse) => {
    if (!user || !detail?.batchId) return;
    const deviceForBatch = detail.deviceId || detail.seededDeviceId;
    if (!deviceForBatch) return;
    const key = encodeBatchKey(deviceForBatch, detail.batchId);
    const rawPoints = detail.points?.length ? detail.points : detail.payload?.points ?? [];
    const records = rawPoints.length
      ? pointsToMeasurementRecords(rawPoints as IngestSmokeTestPoint[], deviceForBatch, detail.batchId, { batchKey: key })
      : [];
    const summary: BatchSummary = {
      batchId: detail.batchId,
      deviceId: deviceForBatch,
      deviceName: null,
      count: rawPoints.length,
      processedAt: new Date().toISOString(),
      visibility: detail.visibility ?? "private",
      moderationState: detail.moderationState ?? "approved",
    };

    upsertBatchSummary(summary);

    if (records.length) {
      queryClient.setQueryData(BATCH_DETAIL_QUERY_KEY(user.uid, key), records);
      setIndexOverride(records.length - 1);
    }
    else {
      queryClient.removeQueries({ queryKey: BATCH_DETAIL_QUERY_KEY(user.uid, key), exact: true });
      setIndexOverride(0);
    }

    setSelectedBatchKey(key);
    if (user) {
      safeLocalStorageSet(
        userScopedSelectionKey,
        key,
        { context: "map:selected-batch:save", userId: user.uid }
      );
      if (rawPoints.length) {
        safeLocalStorageSet(
          userScopedCacheKey,
          JSON.stringify({ summary, points: rawPoints }),
          { context: "map:cache:save", userId: user.uid }
        );
      }
      else {
        safeLocalStorageRemove(
          userScopedCacheKey,
          { context: "map:cache:clear", userId: user.uid }
        );
      }
    }

    void queryClient.invalidateQueries({ queryKey: BATCHES_QUERY_KEY(user.uid) });
  }, [queryClient, upsertBatchSummary, user, userScopedCacheKey, userScopedSelectionKey]);

  // Cleanup events remove batches tied to devices that were cleared server-side.
  const processCleanupDetail = useCallback((detail: IngestSmokeTestCleanupResponse) => {
    if (!user) return;
    const cleared = buildClearedSet(detail);
    if (!cleared.size) return;

    queryClient.setQueryData<BatchSummary[]>(BATCHES_QUERY_KEY(user.uid), (prev = []) =>
      prev.filter((batch) => !cleared.has(batch.deviceId))
    );

    queryClient.removeQueries({
      predicate: (query) => {
        const [type, uid, encoded] = query.queryKey as [unknown, unknown, unknown];
        if (type !== "batchDetail" || uid !== user.uid || typeof encoded !== "string") return false;
        const parsed = decodeBatchKey(encoded);
        return parsed ? cleared.has(parsed.deviceId) : false;
      },
    });

    const current = decodeBatchKey(selectedBatchKey);
    if (current && cleared.has(current.deviceId)) {
      setSelectedBatchKey("");
      setIndexOverride(0);
      safeLocalStorageRemove(
        userScopedSelectionKey,
        { context: "map:selected-batch:clear-on-cleanup", userId: user.uid }
      );
      const cached = getCachedBatch();
      if (cached && cleared.has(cached.summary.deviceId)) {
        safeLocalStorageRemove(
          userScopedCacheKey,
          { context: "map:cache:clear-on-cleanup", userId: user.uid }
        );
      }
    }

    void queryClient.invalidateQueries({ queryKey: BATCHES_QUERY_KEY(user.uid) });
  }, [getCachedBatch, queryClient, selectedBatchKey, user, userScopedCacheKey, userScopedSelectionKey]);

  useEffect(() => {
    if (!pendingSmokeResult) return;
    deferStateUpdate(() => {
      processSmokeResult(pendingSmokeResult);
      onSmokeResultConsumed?.();
    });
  }, [onSmokeResultConsumed, pendingSmokeResult, processSmokeResult]);

  useEffect(() => {
    if (!pendingCleanupDetail) return;
    deferStateUpdate(() => {
      processCleanupDetail(pendingCleanupDetail);
      onCleanupDetailConsumed?.();
    });
  }, [onCleanupDetailConsumed, pendingCleanupDetail, processCleanupDetail]);

  const handleMapPointSelect = useCallback((point: { batchKey?: string; batchPointIndex?: number }) => {
    if (!isShowingAllPublic24h) return;
    if (!point.batchKey) return;
    skipIndexResetRef.current = true;
    setSelectedBatchKey(point.batchKey);
    const pointIndex = typeof point.batchPointIndex === "number" ? point.batchPointIndex : null;
    setIndexOverride(pointIndex);
    if (user) {
      safeLocalStorageSet(
        userScopedSelectionKey,
        point.batchKey,
        { context: "map:selected-batch:from-all", userId: user.uid }
      );
    }
  }, [isShowingAllPublic24h, user, userScopedSelectionKey]);

  const data = useMemo(
    () => {
      const fallbackTimestamp = 0;
      return rows.map((r) => ({
        lat: r.lat,
        lon: r.lon,
        timestamp: timestampToMillis(r.timestamp) ?? fallbackTimestamp,
        value: r.value,
        precision: r.precision ?? null,
        altitude: r.altitude ?? null,
        batchKey: r.batchKey,
        batchPointIndex: r.batchPointIndex,
      }));
    },
    [rows]
  );

  const autoCenterKey = useMemo(() => {
    if (!rows.length) return "";
    const first = rows[0];
    const last = rows[rows.length - 1];
    return [selectedBatchKey, first?.id ?? "first", last?.id ?? "last", rows.length].join(":");
  }, [rows, selectedBatchKey]);

  const selectedPoint = rows[selectedIndex];
  const selectedMomentMs = selectedPoint ? timestampToMillis(selectedPoint.timestamp) : null;
  const selectedMoment = selectedMomentMs !== null ? new Date(selectedMomentMs) : null;
  const shouldRenderMap = Boolean(selectedBatchKey && rows.length);
  const selectedBatchParsed = useMemo(
    () => decodeBatchKey(selectedBatchKey),
    [selectedBatchKey]
  );
  const allModeBatchCount = useMemo(() => (
    new Set(
      rows
        .map((row) => row.batchKey)
        .filter((key): key is string => typeof key === "string" && key.length > 0)
    ).size
  ), [rows]);
  const isExportSectionVisible = Boolean(selectedBatchKey) && !isShowingAllPublic24h;
  const canExportSelection = useMemo(() => {
    if (!selectedBatchKey || isShowingAllPublic24h) return false;
    if (user) return Boolean(selectedSummary);
    return selectedSummary?.visibility === "public";
  }, [isShowingAllPublic24h, selectedBatchKey, selectedSummary, user]);
  const exportDisabledReason = useMemo(() => {
    if (!isExportSectionVisible) return null;
    if (isLoadingBatch) return "Wait for the selected batch to finish loading before exporting.";
    if (!canExportSelection) {
      return user
        ? "The selected batch is not available for export."
        : "Video export is only available for public batches when signed out.";
    }
    if (rows.length < 2) return "Video export requires at least 2 measurements in the selected batch.";
    if (!recordingSupport.supported) return recordingSupport.reason;
    if (!captureAvailable) return "The live 3D map canvas is not ready for capture in this browser.";
    return null;
  }, [
    canExportSelection,
    captureAvailable,
    isExportSectionVisible,
    isLoadingBatch,
    recordingSupport.reason,
    recordingSupport.supported,
    rows.length,
    user,
  ]);
  const canStartExport = isExportSectionVisible && !isExporting && !exportDisabledReason;

  useEffect(() => {
    if (!shouldRenderMap || isShowingAllPublic24h) {
      setCaptureAvailable(false);
      return;
    }

    const updateCaptureAvailability = () => {
      const canvas = map3DRef.current?.getCaptureCanvas() ?? null;
      setCaptureAvailable(Boolean(canvas));
    };

    updateCaptureAvailability();
    const intervalId = window.setInterval(updateCaptureAvailability, 750);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [isShowingAllPublic24h, rows.length, selectedBatchKey, shouldRenderMap]);

  useEffect(() => {
    return () => {
      if (renderedVideoUrl) {
        URL.revokeObjectURL(renderedVideoUrl);
      }
    };
  }, [renderedVideoUrl]);

  const handleRenderVideo = useCallback(async () => {
    if (!canStartExport || !selectedBatchParsed) return;

    const initialCanvas = map3DRef.current?.getCaptureCanvas() ?? null;
    if (!initialCanvas) {
      setExportError("The live 3D map canvas is not ready for capture in this browser.");
      setExportStatus(null);
      return;
    }

    const previousIndex = selectedIndex;
    const pointCount = rows.length;
    const lastIndex = Math.max(pointCount - 1, 0);
    const deviceSegment = sanitizeFileSegment(selectedSummary?.deviceName ?? selectedBatchParsed.deviceId);
    const batchSegment = sanitizeFileSegment(selectedBatchParsed.batchId);
    let recordingSession: ReturnType<typeof startCanvasRecording> | null = null;
    let captureSession: Map3DCaptureSession | null = null;

    if (renderedVideoUrl) {
      URL.revokeObjectURL(renderedVideoUrl);
    }
    setRenderedVideoUrl(null);
    setRenderedVideoName(null);
    setRenderedVideoMimeType(null);
    setExportError(null);
    setExportProgress(0);
    setExportStatus("Preparing live map capture...");
    setIsExporting(true);
    setIndexOverride(0);

    try {
      await waitForAnimationFrames(2);

      captureSession = await (map3DRef.current?.startCaptureSession() ?? Promise.resolve(null));
      const captureCanvas = captureSession?.canvas ?? null;
      if (!captureCanvas) {
        throw new Error("Unable to prepare the live map and overlay for video export.");
      }

      const targetPointDurationMs = Math.max(
        VIDEO_EXPORT_MIN_POINT_MS,
        Math.round(VIDEO_EXPORT_DURATION_MS / pointCount)
      );

      await waitForAnimationFrames(2);
      await (map3DRef.current?.waitForVisualReady() ?? waitForAnimationFrames(3));

      recordingSession = startCanvasRecording(captureCanvas, {
        fps: VIDEO_EXPORT_FPS,
        mimeType: recordingSupport.mimeType ?? undefined,
      });

      await waitForAnimationFrames(1);
      setExportStatus(`Rendering point 1 of ${pointCount}...`);
      setExportProgress(pointCount ? 1 / pointCount : 1);
      await sleep(targetPointDurationMs);

      for (let index = 1; index <= lastIndex; index += 1) {
        const stepStartedAt = performance.now();
        setIndexOverride(index);
        setExportStatus(`Rendering point ${index + 1} of ${pointCount}...`);

        await waitForAnimationFrames(1);
        await (map3DRef.current?.waitForVisualReady() ?? waitForAnimationFrames(3));

        const elapsedMs = performance.now() - stepStartedAt;
        const remainingMs = Math.max(
          index === lastIndex ? VIDEO_EXPORT_FINAL_POINT_MS : 0,
          targetPointDurationMs - elapsedMs
        );
        if (remainingMs > 0) {
          await sleep(remainingMs);
        }

        setExportProgress((index + 1) / pointCount);
      }

      setExportProgress(1);
      setExportStatus("Finalizing video...");

      const blob = await recordingSession.stop();
      recordingSession = null;
      const objectUrl = URL.createObjectURL(blob);

      setRenderedVideoUrl(objectUrl);
      setRenderedVideoName(`${deviceSegment}-${batchSegment}.webm`);
      setRenderedVideoMimeType(blob.type || recordingSupport.mimeType);
      setExportStatus("Video ready for download.");
    }
    catch (err) {
      if (recordingSession) {
        await recordingSession.stop().catch(() => {});
      }
      const message = err instanceof Error ? err.message : "Unable to render the batch video.";
      setExportError(message);
      setExportStatus(null);
    }
    finally {
      captureSession?.stop();
      setIsExporting(false);
      setIndexOverride(Math.min(previousIndex, lastIndex));
    }
  }, [
    canStartExport,
    recordingSupport.mimeType,
    renderedVideoUrl,
    rows.length,
    selectedBatchParsed,
    selectedIndex,
    selectedSummary?.deviceName,
  ]);

  return (
    <div style={{ padding: 12 }}>
      <h2>CrowdPM Map</h2>
      {queryError ? (
        <p style={{ color: "tomato", marginBottom: 8, fontSize: 14 }}>
          {queryError instanceof Error ? queryError.message : "Unable to load batches. Please retry."}
        </p>
      ) : null}
      <label htmlFor="batch-select" style={{ display: "block", marginBottom: 6 }}>
        Measurement batch
      </label>
      <select
        id="batch-select"
        value={selectedBatchKey}
        onChange={(e) => handleBatchSelect(e.target.value)}
        disabled={isAuthLoading || isExporting}
      >
        <option value="">{user ? "Select batch" : "Select a public batch"}</option>
        <option value={SHOW_ALL_PUBLIC_24H_KEY}>Show all public balls (last 24h)</option>
        {visibleBatches.map((batch) => {
          const key = encodeBatchKey(batch.deviceId, batch.batchId);
          return <option key={key} value={key}>{formatBatchLabel(batch)}</option>;
        })}
      </select>
      {!visibleBatches.length ? (
        <p style={{ marginTop: 8, fontSize: 14 }}>
          {user
            ? "No batches available yet. Run a smoke test from the dashboard to generate one."
            : "No public batches are available yet."}
        </p>
      ) : null}
      {rows.length ? (
        <div style={{ marginTop: 16 }}>
          {isShowingAllPublic24h ? (
            <div
              style={{
                marginTop: 8,
                padding: 12,
                borderRadius: 8,
                background: "var(--color-panel)",
                color: "var(--gray-12)",
                border: "1px solid var(--gray-a6)",
              }}
            >
              <p style={{ margin: 0, fontWeight: 600, color: "var(--gray-12)" }}>
                Showing all public balls from the last 24 hours
              </p>
              <p style={{ margin: "4px 0 0" }}>
                Loaded <strong>{rows.length}</strong> measurements across <strong>{allModeBatchCount}</strong> public batches.
              </p>
              <p style={{ margin: "4px 0 0" }}>
                Click any ball on the map to switch to that batch&apos;s individual timeline view.
              </p>
            </div>
          ) : (
            <>
              <label htmlFor="measurement-slider">Measurement timeline</label>
              <input
                id="measurement-slider"
                type="range"
                min={0}
                max={rows.length - 1}
                step={1}
                value={selectedIndex}
                onChange={(e) => setIndexOverride(Number(e.target.value))}
                disabled={isExporting}
                style={{ width: "100%", marginTop: 8 }}
              />
              {selectedPoint ? (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 8,
                    background: "var(--color-panel)",
                    color: "var(--gray-12)",
                    border: "1px solid var(--gray-a6)",
                  }}
                >
                  <p style={{ margin: 0, fontWeight: 600, color: "var(--gray-12)" }}>
                    {selectedMoment ? selectedMoment.toLocaleString() : ""}
                  </p>
                  <p style={{ margin: "4px 0 0" }}>
                    Value: <strong>{selectedPoint.value} {selectedPoint.unit || "ug/m3"}</strong>
                  </p>
                  <p style={{ margin: "4px 0 0" }}>
                    Location: {selectedPoint.lat.toFixed(5)}, {selectedPoint.lon.toFixed(5)}
                  </p>
                  <p style={{ margin: "4px 0 0" }}>
                    GPS accuracy: {selectedPoint.precision !== undefined && selectedPoint.precision !== null
                      ? `+/-${selectedPoint.precision} m`
                      : "not provided"}
                  </p>
                  <p style={{ margin: "4px 0 0" }}>
                    Altitude: {selectedPoint.altitude !== undefined && selectedPoint.altitude !== null
                      ? `${selectedPoint.altitude.toFixed(1)} m`
                      : "not provided"}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <p style={{ marginTop: 16 }}>
          {isShowingAllPublic24h
            ? (isLoadingBatch ? "Loading public measurements from the last 24 hours..." : "No public measurements were found in the last 24 hours.")
            : selectedBatchKey
            ? (isLoadingBatch ? "Loading measurements for the selected batch..." : "No measurements available for this batch.")
            : "Select a batch with recent measurements to explore the timeline."}
        </p>
      )}
      {isExportSectionVisible ? (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: "var(--color-panel)",
            color: "var(--gray-12)",
            border: "1px solid var(--gray-a6)",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, color: "var(--gray-12)" }}>
            Batch video export
          </p>
          <p style={{ margin: "4px 0 0" }}>
            Render a 12-second WebM playback of this batch from the first point to the last point.
          </p>
          <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => { void handleRenderVideo(); }}
              disabled={!canStartExport}
            >
              {isExporting ? "Rendering video..." : "Render video"}
            </button>
            {isExporting ? (
              <span>{Math.round(exportProgress * 100)}%</span>
            ) : null}
            {renderedVideoUrl && renderedVideoName ? (
              <a href={renderedVideoUrl} download={renderedVideoName}>
                Download rendered video
              </a>
            ) : null}
          </div>
          {exportDisabledReason ? (
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--gray-11)" }}>
              {exportDisabledReason}
            </p>
          ) : null}
          {exportStatus ? (
            <p style={{ margin: "8px 0 0", fontSize: 14 }}>
              {isExporting ? `${exportStatus} ${Math.round(exportProgress * 100)}%` : exportStatus}
            </p>
          ) : null}
          {exportError ? (
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "tomato" }}>
              {exportError}
            </p>
          ) : null}
          {renderedVideoMimeType && renderedVideoUrl ? (
            <p style={{ margin: "8px 0 0", fontSize: 14, color: "var(--gray-11)" }}>
              Format: <code>{renderedVideoMimeType}</code>. This download link is available for this session only.
            </p>
          ) : null}
        </div>
      ) : null}
      {shouldRenderMap ? (
        <Suspense fallback={<p style={{ marginTop: 16 }}>Loading map...</p>}>
          <Map3D
            ref={map3DRef}
            data={data}
            selectedIndex={selectedIndex}
            onSelectIndex={isShowingAllPublic24h || isExporting ? undefined : setIndexOverride}
            onSelectPoint={isExporting ? undefined : handleMapPointSelect}
            autoCenterKey={autoCenterKey}
            interleaved={settings.interleavedRendering}
            showAllMode={isShowingAllPublic24h}
            forceFollowSelection={isExporting}
            playbackPathMode={isExporting ? "progressive" : "full"}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
