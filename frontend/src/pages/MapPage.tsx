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

  // Always render the map — use all-public mode by default when nothing is selected
  const effectiveShowAllMode = isShowingAllPublic24h || !selectedBatchKey;
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
    if (!isExportSectionVisible) {
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
  }, [isExportSectionVisible]);

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
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* ---- Always-visible map ---- */}
      <Suspense fallback={<div style={{ width: "100%", height: "100%", background: "var(--color-surface)" }} />}>
        <Map3D
          ref={map3DRef}
          data={data}
          selectedIndex={selectedIndex}
          onSelectIndex={effectiveShowAllMode ? undefined : setIndexOverride}
          onSelectPoint={handleMapPointSelect}
          autoCenterKey={autoCenterKey}
          interleaved={settings.interleavedRendering}
          showAllMode={effectiveShowAllMode}
        />
      </Suspense>

      {/* ---- Branded top bar ---- */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 4,
          display: "flex",
          flexDirection: "column",
          pointerEvents: "none",
        }}
      >
        {/* Accent gradient line */}
        <div
          style={{
            height: 3,
            background: "linear-gradient(90deg, var(--accent-9), var(--accent-7), var(--accent-9))",
            opacity: 0.9,
          }}
        />
        {/* Logo bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "var(--space-3) var(--space-4)",
            paddingLeft: "calc(var(--space-4) - 5px)",
            background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 100%)",
          }}
        >
          {/* Cloud / air quality icon */}
          <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden>
            <circle cx="14" cy="14" r="13" stroke="var(--accent-9)" strokeWidth="1.5" fill="none" opacity="0.7" />
            <path
              d="M8 17a3.5 3.5 0 0 1 .5-6.95A5 5 0 0 1 18 10a4 4 0 0 1 2 7.5"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
            <circle cx="12" cy="20" r="1" fill="var(--accent-9)" opacity="0.8" />
            <circle cx="16" cy="21" r="0.7" fill="var(--accent-9)" opacity="0.6" />
            <circle cx="14" cy="23" r="0.5" fill="var(--accent-9)" opacity="0.4" />
          </svg>
          <span
            style={{
              fontSize: "var(--font-size-4)",
              fontWeight: 700,
              color: "white",
              letterSpacing: "-0.02em",
              textShadow: "0 1px 4px rgba(0,0,0,0.5)",
            }}
          >
            CrowdPM
          </span>
          <span
            style={{
              fontSize: "var(--font-size-1)",
              color: "rgba(255,255,255,0.6)",
              fontWeight: 400,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            Air Quality Network
          </span>
        </div>
      </div>

      {/* ---- Welcome hero overlay (when no batch selected and no data) ---- */}
      {!selectedBatchKey && !rows.length ? (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            zIndex: 2,
          }}
        >
          <div
            style={{
              pointerEvents: "auto",
              background: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              borderRadius: "var(--radius-4)",
              padding: "var(--space-6)",
              maxWidth: 460,
              textAlign: "center",
              color: "var(--gray-12)",
              boxShadow: "var(--shadow-5)",
            }}
          >
            {/* Logo mark */}
            <svg width="48" height="48" viewBox="0 0 28 28" fill="none" aria-hidden style={{ margin: "0 auto var(--space-3)" }}>
              <circle cx="14" cy="14" r="13" stroke="var(--accent-9)" strokeWidth="1.5" fill="none" opacity="0.7" />
              <path
                d="M8 17a3.5 3.5 0 0 1 .5-6.95A5 5 0 0 1 18 10a4 4 0 0 1 2 7.5"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="12" cy="20" r="1" fill="var(--accent-9)" opacity="0.8" />
              <circle cx="16" cy="21" r="0.7" fill="var(--accent-9)" opacity="0.6" />
              <circle cx="14" cy="23" r="0.5" fill="var(--accent-9)" opacity="0.4" />
            </svg>
            <h2 style={{ margin: 0, fontSize: "var(--font-size-6)", fontWeight: 700 }}>
              Real-time community air quality, mapped in 3D
            </h2>
            <p style={{ marginTop: "var(--space-3)", color: "var(--gray-11)", fontSize: "var(--font-size-3)" }}>
              Explore public sensor data below, or pair your own node to start contributing measurements.
            </p>
            <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => handleBatchSelect(SHOW_ALL_PUBLIC_24H_KEY)}
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  borderRadius: "var(--radius-3)",
                  border: "none",
                  background: "var(--accent-9)",
                  color: "white",
                  fontWeight: 600,
                  fontSize: "var(--font-size-2)",
                  cursor: "pointer",
                }}
              >
                Browse public data
              </button>
              <button
                type="button"
                onClick={() => window.open("/pairing-guide", "_blank")}
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  borderRadius: "var(--radius-3)",
                  border: "1px solid var(--gray-a7)",
                  background: "transparent",
                  color: "var(--gray-12)",
                  fontWeight: 500,
                  fontSize: "var(--font-size-2)",
                  cursor: "pointer",
                }}
              >
                Pair a node
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---- Floating controls panel (top-right) ---- */}
      <div
        style={{
          position: "absolute",
          top: "var(--space-4)",
          right: "var(--space-4)",
          zIndex: 3,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-3)",
          maxWidth: 360,
          width: "calc(100% - var(--space-8))",
        }}
      >
        {/* Error banner */}
        {queryError ? (
          <div
            style={{
              padding: "var(--space-3)",
              borderRadius: "var(--radius-3)",
              background: "rgba(220, 38, 38, 0.85)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              color: "white",
              fontSize: "var(--font-size-2)",
            }}
          >
            {queryError instanceof Error ? queryError.message : "Unable to load batches. Please retry."}
          </div>
        ) : null}

        {/* Batch selector */}
        <div
          style={{
            padding: "var(--space-4)",
            borderRadius: "var(--radius-3)",
            background: "rgba(0, 0, 0, 0.7)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            boxShadow: "var(--shadow-3)",
          }}
        >
          <label htmlFor="batch-select" style={{ display: "block", marginBottom: 6, fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
            Measurement batch
          </label>
          <select
            id="batch-select"
            value={selectedBatchKey}
            onChange={(e) => handleBatchSelect(e.target.value)}
            disabled={isAuthLoading}
            style={{
              width: "100%",
              padding: "var(--space-2) var(--space-4) var(--space-2) var(--space-2)",
              borderRadius: "var(--radius-2)",
              border: "1px solid var(--gray-a6)",
              background: "var(--color-surface)",
              color: "var(--gray-12)",
              fontSize: "var(--font-size-2)",
              appearance: "none",
              WebkitAppearance: "none",
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239BA1A6' d='M2.5 4.5L6 8l3.5-3.5'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right var(--space-2) center",
              backgroundSize: "12px",
            }}
          >
            <option value="">{user ? "Select batch" : "Select a public batch"}</option>
            <option value={SHOW_ALL_PUBLIC_24H_KEY}>Show all public (last 24h)</option>
            {visibleBatches.map((batch) => {
              const key = encodeBatchKey(batch.deviceId, batch.batchId);
              return <option key={key} value={key}>{formatBatchLabel(batch)}</option>;
            })}
          </select>
        </div>

        {/* Video export card (when a specific batch is selected) */}
        {isExportSectionVisible ? (
          <div
            style={{
              padding: "var(--space-4)",
              borderRadius: "var(--radius-3)",
              background: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              boxShadow: "var(--shadow-3)",
              color: "var(--gray-12)",
            }}
          >
            <p style={{ margin: 0, fontWeight: 600, fontSize: "var(--font-size-2)" }}>
              🎬 Video Export
            </p>
            {exportDisabledReason ? (
              <p style={{ margin: "6px 0 0", fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                {exportDisabledReason}
              </p>
            ) : isExporting ? (
              <div style={{ marginTop: 8 }}>
                <p style={{ margin: 0, fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                  {exportStatus ?? "Exporting..."}
                </p>
                <div
                  style={{
                    marginTop: 6,
                    height: 4,
                    borderRadius: 2,
                    background: "var(--gray-a5)",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.round(exportProgress * 100)}%`,
                      height: "100%",
                      background: "var(--accent-9)",
                      borderRadius: 2,
                      transition: "width 0.2s ease",
                    }}
                  />
                </div>
              </div>
            ) : renderedVideoUrl ? (
              <div style={{ marginTop: 8 }}>
                <p style={{ margin: 0, fontSize: "var(--font-size-1)", color: "var(--accent-11)" }}>
                  {exportStatus ?? "Video ready!"}
                </p>
                <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 8, flexWrap: "wrap" }}>
                  <a
                    href={renderedVideoUrl}
                    download={renderedVideoName ?? "export.webm"}
                    style={{
                      display: "inline-block",
                      padding: "var(--space-1) var(--space-3)",
                      borderRadius: "var(--radius-2)",
                      background: "var(--accent-9)",
                      color: "white",
                      fontWeight: 600,
                      fontSize: "var(--font-size-1)",
                      textDecoration: "none",
                      cursor: "pointer",
                    }}
                  >
                    Download {renderedVideoMimeType === "video/mp4" ? "MP4" : "WebM"}
                  </a>
                  <button
                    type="button"
                    onClick={handleRenderVideo}
                    style={{
                      padding: "var(--space-1) var(--space-3)",
                      borderRadius: "var(--radius-2)",
                      border: "1px solid var(--gray-a6)",
                      background: "transparent",
                      color: "var(--gray-12)",
                      fontSize: "var(--font-size-1)",
                      cursor: "pointer",
                    }}
                  >
                    Re-render
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <p style={{ margin: "0 0 8px", fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                  Render a flythrough video of this batch's measurements.
                </p>
                <button
                  type="button"
                  onClick={handleRenderVideo}
                  disabled={!canStartExport}
                  style={{
                    padding: "var(--space-1) var(--space-3)",
                    borderRadius: "var(--radius-2)",
                    border: "none",
                    background: canStartExport ? "var(--accent-9)" : "var(--gray-a5)",
                    color: canStartExport ? "white" : "var(--gray-11)",
                    fontWeight: 600,
                    fontSize: "var(--font-size-1)",
                    cursor: canStartExport ? "pointer" : "not-allowed",
                  }}
                >
                  Render Video
                </button>
              </div>
            )}
            {exportError ? (
              <p style={{ margin: "8px 0 0", fontSize: "var(--font-size-1)", color: "#f87171" }}>
                {exportError}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Detail / timeline panel */}
        {rows.length ? (
          <div
            style={{
              padding: "var(--space-3)",
              borderRadius: "var(--radius-3)",
              background: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              boxShadow: "var(--shadow-3)",
              color: "var(--gray-12)",
            }}
          >
            {isShowingAllPublic24h ? (
              <>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "var(--font-size-2)" }}>
                  All public data — last 24 hours
                </p>
                <p style={{ margin: "4px 0 0", fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                  <strong>{rows.length}</strong> measurements across <strong>{allModeBatchCount}</strong> batches.
                  Click any point to drill in.
                </p>
              </>
            ) : (
              <>
                <label htmlFor="measurement-slider" style={{ fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                  Timeline
                </label>
                <input
                  id="measurement-slider"
                  type="range"
                  min={0}
                  max={rows.length - 1}
                  step={1}
                  value={selectedIndex}
                  onChange={(e) => setIndexOverride(Number(e.target.value))}
                  style={{ width: "100%", marginTop: 4 }}
                />
                {selectedPoint ? (
                  <div style={{ marginTop: 8 }}>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: "var(--font-size-2)" }}>
                      {selectedMoment ? selectedMoment.toLocaleString() : ""}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                      PM2.5: <strong>{selectedPoint.value} {selectedPoint.unit || "µg/m³"}</strong>
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                      {selectedPoint.lat.toFixed(5)}, {selectedPoint.lon.toFixed(5)}
                      {selectedPoint.precision != null ? ` · ±${selectedPoint.precision}m` : ""}
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : selectedBatchKey && isLoadingBatch ? (
          <div
            style={{
              padding: "var(--space-3)",
              borderRadius: "var(--radius-3)",
              background: "rgba(0, 0, 0, 0.7)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              color: "var(--gray-11)",
              fontSize: "var(--font-size-2)",
            }}
          >
            Loading measurements…
          </div>
        ) : null}
      </div>

      {/* ---- Stats strip (bottom-left) ---- */}
      {/* ---- Stats strip (bottom-left) ---- */}
      <div
        style={{
          position: "absolute",
          bottom: "var(--space-4)",
          left: "var(--space-4)",
          zIndex: 3,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-2) var(--space-4)",
          borderRadius: "var(--radius-3)",
          background: "rgba(0, 0, 0, 0.6)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: "var(--gray-11)",
          fontSize: "var(--font-size-1)",
        }}
      >
        {/* Live dot indicator */}
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            backgroundColor: "var(--accent-9)",
            boxShadow: "0 0 6px var(--accent-9)",
            animation: rows.length > 0 ? "pulse-dot 2s ease-in-out infinite" : "none",
          }}
        />
        <span>
          {rows.length > 0
            ? isShowingAllPublic24h
              ? `${allModeBatchCount} active batches · ${rows.length} measurements`
              : `${rows.length} measurements in batch`
            : "No data loaded"}
        </span>
      </div>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}
