import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { timestampToIsoString, timestampToMillis } from "@crowdpm/types";
import { Button, Dialog, Flex, Select, Switch, Text } from "@radix-ui/themes";
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
import { APP_ROUTES, openAppRouteInNewTab } from "../lib/appRoutes";
import { logWarning } from "../lib/logger";
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet, scopedStorageKey } from "../lib/storage";
import {
  detectCanvasVideoExportSupport,
  startCanvasRecording,
} from "../lib/videoExport";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";
import type { Map3DCaptureSession, Map3DHandle } from "../components/Map3D";
import { clampPageIndex, getPaginationWindow, ResultCountControl } from "../components/PaginationControl";

// Keys used to scope localStorage entries per user so shared browsers do not mix data.
const LAST_SELECTION_KEY = "crowdpm:lastSmokeSelection";
const LAST_SMOKE_CACHE_KEY = "crowdpm:lastSmokeBatchCache";
const LAST_MAP_ZOOM_KEY = "crowdpm:lastMapZoom";
const LAST_TIMELINE_INDEX_KEY = "crowdpm:lastTimelineIndex";
const BATCH_LIST_STALE_MS = 30_000; // keep batch list warm for 30 seconds to avoid redundant refetches
const DROPDOWN_BATCH_LIMIT = 20;
const NO_BATCH_SELECTED_KEY = "__no_batch_selected__";
const SEE_ALL_BATCHES_KEY = "__see_all_batches__";
const SHOW_ALL_PUBLIC_24H_KEY = "__all_public_last_24h__";
const SHOW_ALL_PUBLIC_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const EXPANDED_BATCH_FETCH_LIMIT = 500;
const VIDEO_EXPORT_DURATION_MS = 12_000;
const VIDEO_EXPORT_FPS = 30;
const VIDEO_EXPORT_MIN_POINT_MS = 160;
const VIDEO_EXPORT_FINAL_POINT_MS = 320;
const MIN_PERSISTED_MAP_ZOOM = 0;
const MAX_PERSISTED_MAP_ZOOM = 22;
const MAP_PANEL_BACKGROUND = "color-mix(in srgb, var(--color-panel-solid) 88%, transparent)";
const MAP_PANEL_BORDER = "1px solid var(--gray-a6)";
const MAP_PANEL_BLUR = "blur(12px)";
const MAP_PANEL_SECTION_BORDER = "1px solid var(--gray-a5)";
const MAP_FLOATING_PANEL_TOP = "max(calc(env(safe-area-inset-top, 0px) + 72px), var(--space-4))";
const MAP_VIEWPORT_BACKGROUND =
  "radial-gradient(120% 120% at 0% 0%, color-mix(in srgb, var(--accent-8) 20%, transparent), transparent 55%), "
  + "radial-gradient(100% 100% at 100% 0%, color-mix(in srgb, var(--gray-7) 14%, transparent), transparent 60%), "
  + "linear-gradient(180deg, color-mix(in srgb, var(--color-panel-solid) 82%, var(--gray-1)), var(--color-surface))";
const MAP_EMPTY_STATE_TITLE = "Hyper-local community air quality, mapped in 3D";
const MAP_EMPTY_STATE_DESCRIPTION = "Explore public sensor data below, or pair your own node to start contributing measurements.";

// React Query cache keys. Keeping them as helpers avoids typos across the file.
const BATCHES_QUERY_KEY = (uid: string | null | undefined) => ["batches", uid ?? "guest"] as const;
const BATCH_DETAIL_QUERY_KEY = (uid: string, batchKey: string) => ["batchDetail", uid, batchKey] as const;
const Map3D = lazy(() => import("../components/Map3D"));
const TERMINAL_BATCH_ERROR_MESSAGES = ["unauthorized", "authentication required", "not_found", "batch not found"] as const;

type VisibleBatchAccess = "owned" | "public" | "both";
type VisibleBatchSummary = BatchSummary & {
  access: VisibleBatchAccess;
};

type BatchBrowserTimeRange = "all" | "8h" | "24h" | "7d" | "30d";

type StoredSmokeBatch = {
  summary: BatchSummary;
  points: IngestSmokeTestPoint[];
};

type MapMeasurementRecord = MeasurementRecord & {
  batchKey?: string;
  batchPointIndex?: number;
};

type StoredTimelineIndexes = Record<string, number>;

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

function sortBatchesByProcessedAtDesc<T extends BatchSummary>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const timeA = timestampToMillis(a.processedAt) ?? 0;
    const timeB = timestampToMillis(b.processedAt) ?? 0;
    return timeB - timeA;
  });
}

function getBatchBrowserTimeRangeCutoff(range: BatchBrowserTimeRange): number | null {
  switch (range) {
    case "8h":
      return Date.now() - 8 * 60 * 60 * 1000;
    case "24h":
      return Date.now() - 24 * 60 * 60 * 1000;
    case "7d":
      return Date.now() - 7 * 24 * 60 * 60 * 1000;
    case "30d":
      return Date.now() - 30 * 24 * 60 * 60 * 1000;
    case "all":
      return null;
  }
}

function toPublicVisibleBatches(publicBatches: BatchSummary[]): VisibleBatchSummary[] {
  return publicBatches.map((batch) => ({ ...batch, access: "public" }));
}

function mergeBatchLists(primaryBatches: BatchSummary[], publicBatches: BatchSummary[]): VisibleBatchSummary[] {
  const byKey = new Map<string, VisibleBatchSummary>();
  toPublicVisibleBatches(publicBatches).forEach((batch) => {
    byKey.set(encodeBatchKey(batch.deviceId, batch.batchId), batch);
  });
  primaryBatches.forEach((batch) => {
    const key = encodeBatchKey(batch.deviceId, batch.batchId);
    const existing = byKey.get(key);
    byKey.set(key, {
      ...batch,
      access: existing ? "both" : "owned",
    });
  });
  return sortBatchesByProcessedAtDesc(Array.from(byKey.values()));
}

function isTerminalBatchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return TERMINAL_BATCH_ERROR_MESSAGES.some((fragment) => message.includes(fragment));
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

function parseStoredMapZoom(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(Math.max(parsed, MIN_PERSISTED_MAP_ZOOM), MAX_PERSISTED_MAP_ZOOM);
}

function parseStoredTimelineIndexes(raw: string | null): StoredTimelineIndexes {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
    );
  }
  catch {
    return {};
  }
}

function getStoredTimelineIndex(storageKey: string, batchKey: string, maxIndex: number, userId?: string | null): number | null {
  const stored = parseStoredTimelineIndexes(safeLocalStorageGet(
    storageKey,
    null,
    { context: "map:timeline:read", userId }
  ));
  const index = stored[batchKey];
  if (typeof index !== "number" || !Number.isFinite(index)) return null;
  return Math.min(Math.max(Math.round(index), 0), maxIndex);
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
  const userScopedZoomKey = useMemo(
    () => scopedStorageKey(LAST_MAP_ZOOM_KEY, user?.uid ?? undefined),
    [user?.uid]
  );
  const userScopedTimelineKey = useMemo(
    () => scopedStorageKey(LAST_TIMELINE_INDEX_KEY, user?.uid ?? undefined),
    [user?.uid]
  );

  // Keep track of which batch is selected plus the position in the measurement timeline.
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>("");
  const [persistedMapZoom, setPersistedMapZoom] = useState<number | null>(null);
  const [zoomHydrationKey, setZoomHydrationKey] = useState<string | null>(null);
  const [isBatchBrowserOpen, setBatchBrowserOpen] = useState(false);
  const [batchBrowserPageIndex, setBatchBrowserPageIndex] = useState(0);
  const [batchBrowserTimeRange, setBatchBrowserTimeRange] = useState<BatchBrowserTimeRange>("all");
  const [showPublicBatchBrowser, setShowPublicBatchBrowser] = useState(true);
  const [showPrivateBatchBrowser, setShowPrivateBatchBrowser] = useState(true);
  const cacheHydratedRef = useRef<string | null>(null);
  const selectionHydratedRef = useRef<string | null>(null);
  const zoomHydratedRef = useRef<string | null>(null);
  const timelineHydratedRef = useRef<string | null>(null);
  const skipIndexResetRef = useRef(false);
  const map3DRef = useRef<Map3DHandle | null>(null);
  const [captureAvailable, setCaptureAvailable] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [renderedVideoName, setRenderedVideoName] = useState<string | null>(null);
  const [, setRenderedVideoMimeType] = useState<string | null>(null);
  const recordingSupport = useMemo(() => detectCanvasVideoExportSupport(), []);
  const [isMapViewportActivated, setMapViewportActivated] = useState(false);


  const getCachedBatch = useCallback(() => {
    const raw = safeLocalStorageGet(
      userScopedCacheKey,
      null,
      { context: "map:cache:read", userId: user?.uid }
    );
    return parseStoredSmokeBatch(raw);
  }, [user?.uid, userScopedCacheKey]);

  const loadBatchSummaries = useCallback(async (ownedLimit?: number, publicLimit?: number) => {
    if (!user) {
      return toPublicVisibleBatches(await listPublicBatches(publicLimit));
    }
    const [owned, publicBatches] = await Promise.all([
      listBatches(ownedLimit).catch(() => []),
      listPublicBatches(publicLimit),
    ]);
    return mergeBatchLists(mergeCachedSummary(owned, getCachedBatch()), publicBatches);
  }, [getCachedBatch, user]);

  // Query #1: list of batches visible to the user.
  const batchesQuery = useQuery<VisibleBatchSummary[]>({
    queryKey: BATCHES_QUERY_KEY(user?.uid ?? null),
    queryFn: () => loadBatchSummaries(),
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
  const batchBrowserQuery = useQuery<VisibleBatchSummary[]>({
    queryKey: ["batchesExpanded", user?.uid ?? "guest", EXPANDED_BATCH_FETCH_LIMIT],
    queryFn: () => loadBatchSummaries(EXPANDED_BATCH_FETCH_LIMIT, EXPANDED_BATCH_FETCH_LIMIT),
    enabled: isBatchBrowserOpen && !isAuthLoading,
    placeholderData: () => visibleBatches,
    staleTime: BATCH_LIST_STALE_MS,
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.toLowerCase().includes("unauthorized")) return false;
      return failureCount < 3;
    },
  });
  const batchBrowserBatches = useMemo(
    () => batchBrowserQuery.data ?? visibleBatches,
    [batchBrowserQuery.data, visibleBatches]
  );
  const filteredBatchBrowserBatches = useMemo(() => {
    const cutoff = getBatchBrowserTimeRangeCutoff(batchBrowserTimeRange);
    return batchBrowserBatches.filter((batch) => {
      if (batch.visibility === "public" && !showPublicBatchBrowser) return false;
      if (batch.visibility === "private" && !showPrivateBatchBrowser) return false;
      if (cutoff === null) return true;
      const processedAtMs = timestampToMillis(batch.processedAt);
      return processedAtMs !== null && processedAtMs >= cutoff;
    });
  }, [batchBrowserBatches, batchBrowserTimeRange, showPrivateBatchBrowser, showPublicBatchBrowser]);
  const batchBrowserPagination = useMemo(
    () => getPaginationWindow(filteredBatchBrowserBatches.length, batchBrowserPageIndex),
    [filteredBatchBrowserBatches.length, batchBrowserPageIndex]
  );
  const visibleBatchBrowserRows = useMemo(
    () => filteredBatchBrowserBatches.slice(batchBrowserPagination.pageStart, batchBrowserPagination.pageEnd),
    [batchBrowserPagination.pageEnd, batchBrowserPagination.pageStart, filteredBatchBrowserBatches]
  );

  const selectedSummary = useMemo(() => {
    if (!selectedBatchKey) return null;
    const parsed = decodeBatchKey(selectedBatchKey);
    if (!parsed) return null;
    return batchBrowserBatches.find((batch) => batch.deviceId === parsed.deviceId && batch.batchId === parsed.batchId) ?? null;
  }, [batchBrowserBatches, selectedBatchKey]);
  const dropdownBatches = useMemo(() => {
    if (!selectedSummary) return visibleBatches;
    const exists = visibleBatches.some((batch) => (
      batch.deviceId === selectedSummary.deviceId && batch.batchId === selectedSummary.batchId
    ));
    if (exists) return visibleBatches;
    return sortBatchesByProcessedAtDesc([selectedSummary, ...visibleBatches]);
  }, [selectedSummary, visibleBatches]);
  const visibleDropdownBatches = useMemo(() => {
    if (!selectedSummary) return dropdownBatches.slice(0, DROPDOWN_BATCH_LIMIT);
    const prioritized = [
      selectedSummary,
      ...dropdownBatches.filter((batch) => (
        batch.deviceId !== selectedSummary.deviceId || batch.batchId !== selectedSummary.batchId
      )),
    ];
    return prioritized.slice(0, DROPDOWN_BATCH_LIMIT);
  }, [dropdownBatches, selectedSummary]);

  const batchDetailQueryKey = useMemo(
    () => (selectedBatchKey ? BATCH_DETAIL_QUERY_KEY(user?.uid ?? "public", selectedBatchKey) : null),
    [selectedBatchKey, user]
  );
  const isShowingAllPublic24h = selectedBatchKey === SHOW_ALL_PUBLIC_24H_KEY;
  const selectedBatchAccess = selectedSummary?.access ?? "unknown";

  // Query #2: measurement detail for the currently selected batch.
  const measurementQuery = useQuery<MapMeasurementRecord[]>({
    queryKey: batchDetailQueryKey ?? ["batchDetail", "idle", "none"],
    enabled: Boolean(batchDetailQueryKey) && !isAuthLoading,
    retry: (failureCount, error) => {
      if (isTerminalBatchError(error)) return false;
      return failureCount < 5;
    },
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
              logWarning("Unable to load public batch detail", {
                deviceId: batch.deviceId,
                batchId: batch.batchId
              }, err);
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

      const loadPublicDetail = () => fetchPublicBatchDetail(parsed.deviceId, parsed.batchId);
      const loadOwnedDetail = () => fetchBatchDetail(parsed.deviceId, parsed.batchId);
      const detail = await (async () => {
        if (!user) {
          return loadPublicDetail();
        }
        if (selectedBatchAccess === "public" || selectedBatchAccess === "both") {
          return loadPublicDetail();
        }
        if (selectedBatchAccess === "owned") {
          return loadOwnedDetail();
        }

        // Unknown selections happen when a public batch is chosen from a broader query
        // (for example the last-24-hours map) and is not present in the smaller summary list.
        try {
          return await loadPublicDetail();
        }
        catch {
          // Fall through so cached/stale private selections can still resolve via the owned endpoint.
        }

        return loadOwnedDetail();
      })();
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
  const [trackBall, setTrackBall] = useState(true);

  useEffect(() => {
    if (skipIndexResetRef.current) {
      skipIndexResetRef.current = false;
      timelineHydratedRef.current = null;
      return;
    }
    if (!selectedBatchKey || selectedBatchKey === SHOW_ALL_PUBLIC_24H_KEY) {
      timelineHydratedRef.current = null;
      setIndexOverride(null);
      return;
    }
    if (!rows.length) return;

    const hydrationKey = `${userScopedTimelineKey}:${selectedBatchKey}:${rows.length}`;
    if (timelineHydratedRef.current === hydrationKey) return;
    timelineHydratedRef.current = hydrationKey;

    const storedIndex = getStoredTimelineIndex(
      userScopedTimelineKey,
      selectedBatchKey,
      rows.length - 1,
      user?.uid
    );
    if (storedIndex !== null) {
      setIndexOverride(storedIndex);
      return;
    }

    setIndexOverride(null);
  }, [rows.length, selectedBatchKey, user?.uid, userScopedTimelineKey]);

  useEffect(() => {
    const nextPageIndex = clampPageIndex(filteredBatchBrowserBatches.length, batchBrowserPageIndex);
    if (nextPageIndex !== batchBrowserPageIndex) {
      setBatchBrowserPageIndex(nextPageIndex);
    }
  }, [filteredBatchBrowserBatches.length, batchBrowserPageIndex]);

  useEffect(() => {
    setBatchBrowserPageIndex(0);
  }, [batchBrowserTimeRange, showPrivateBatchBrowser, showPublicBatchBrowser]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (selectionHydratedRef.current === userScopedSelectionKey) return;
    selectionHydratedRef.current = userScopedSelectionKey;

    const storedSelection = safeLocalStorageGet(
      userScopedSelectionKey,
      null,
      { context: "map:selected-batch:hydrate", userId: user?.uid }
    );
    if (!storedSelection) {
      setSelectedBatchKey("");
      return;
    }

    if (storedSelection === SHOW_ALL_PUBLIC_24H_KEY || decodeBatchKey(storedSelection)) {
      setSelectedBatchKey(storedSelection);
      return;
    }

    setSelectedBatchKey("");
    safeLocalStorageRemove(
      userScopedSelectionKey,
      { context: "map:selected-batch:clear-invalid", userId: user?.uid }
    );
  }, [isAuthLoading, user?.uid, userScopedSelectionKey]);

  useEffect(() => {
    if (isAuthLoading) return;
    if (zoomHydratedRef.current === userScopedZoomKey) return;
    zoomHydratedRef.current = userScopedZoomKey;

    const storedZoom = parseStoredMapZoom(safeLocalStorageGet(
      userScopedZoomKey,
      null,
      { context: "map:zoom:hydrate", userId: user?.uid }
    ));
    setPersistedMapZoom(storedZoom);
    setZoomHydrationKey(userScopedZoomKey);
    if (storedZoom === null) {
      safeLocalStorageRemove(
        userScopedZoomKey,
        { context: "map:zoom:clear-invalid", userId: user?.uid }
      );
    }
  }, [isAuthLoading, user?.uid, userScopedZoomKey]);

  useEffect(() => {
    if (
      isAuthLoading
      || !isBatchBrowserOpen
      || !batchBrowserQuery.isSuccess
      || batchBrowserQuery.isFetching
    ) {
      return;
    }
    if (!selectedBatchKey || selectedBatchKey === SHOW_ALL_PUBLIC_24H_KEY) return;

    const parsed = decodeBatchKey(selectedBatchKey);
    const selectionExists = parsed
      ? (batchBrowserQuery.data ?? []).some((batch) => batch.deviceId === parsed.deviceId && batch.batchId === parsed.batchId)
      : false;

    if (selectionExists) return;

    setSelectedBatchKey("");
    setIndexOverride(0);
    safeLocalStorageRemove(
      userScopedSelectionKey,
      { context: "map:selected-batch:clear-missing", userId: user?.uid }
    );
  }, [
    batchBrowserQuery.data,
    batchBrowserQuery.isFetching,
    batchBrowserQuery.isSuccess,
    isBatchBrowserOpen,
    isAuthLoading,
    selectedBatchKey,
    user?.uid,
    userScopedSelectionKey,
  ]);

  useEffect(() => {
    if (isAuthLoading || !selectedBatchKey || selectedBatchKey === SHOW_ALL_PUBLIC_24H_KEY) return;
    if (measurementQuery.isFetching || measurementQuery.isLoading || !measurementQuery.isError) return;
    if (!isTerminalBatchError(measurementQuery.error)) return;

    setSelectedBatchKey("");
    setIndexOverride(0);
    safeLocalStorageRemove(
      userScopedSelectionKey,
      { context: "map:selected-batch:clear-terminal-error", userId: user?.uid }
    );

    const cached = getCachedBatch();
    if (cached) {
      const cachedKey = encodeBatchKey(cached.summary.deviceId, cached.summary.batchId);
      if (cachedKey === selectedBatchKey) {
        safeLocalStorageRemove(
          userScopedCacheKey,
          { context: "map:cache:clear-terminal-error", userId: user?.uid }
        );
      }
    }
  }, [
    getCachedBatch,
    isAuthLoading,
    measurementQuery.error,
    measurementQuery.isError,
    measurementQuery.isFetching,
    measurementQuery.isLoading,
    selectedBatchKey,
    user?.uid,
    userScopedCacheKey,
    userScopedSelectionKey,
  ]);

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
    if (value && !isMapViewportActivated) {
      startTransition(() => {
        setMapViewportActivated(true);
      });
    }
    setSelectedBatchKey(value);
    if (value) {
      safeLocalStorageSet(
        userScopedSelectionKey,
        value,
        { context: "map:selected-batch:update", userId: user?.uid }
      );
    }
    else {
      safeLocalStorageRemove(
        userScopedSelectionKey,
        { context: "map:selected-batch:clear", userId: user?.uid }
      );
    }
  }, [isMapViewportActivated, user?.uid, userScopedSelectionKey]);

  const handleMapZoomChange = useCallback((zoom: number) => {
    const nextZoom = Math.min(Math.max(zoom, MIN_PERSISTED_MAP_ZOOM), MAX_PERSISTED_MAP_ZOOM);
    setPersistedMapZoom(nextZoom);
    safeLocalStorageSet(
      userScopedZoomKey,
      String(nextZoom),
      { context: "map:zoom:update", userId: user?.uid }
    );
  }, [user?.uid, userScopedZoomKey]);

  const handleTimelineIndexChange = useCallback((nextIndex: number) => {
    const maxIndex = Math.max(rows.length - 1, 0);
    const clampedIndex = Math.min(Math.max(Math.round(nextIndex), 0), maxIndex);
    setIndexOverride(clampedIndex);

    if (!selectedBatchKey || selectedBatchKey === SHOW_ALL_PUBLIC_24H_KEY || !rows.length) return;
    const stored = parseStoredTimelineIndexes(safeLocalStorageGet(
      userScopedTimelineKey,
      null,
      { context: "map:timeline:read", userId: user?.uid }
    ));
    safeLocalStorageSet(
      userScopedTimelineKey,
      JSON.stringify({
        ...stored,
        [selectedBatchKey]: clampedIndex,
      }),
      { context: "map:timeline:update", userId: user?.uid }
    );
  }, [rows.length, selectedBatchKey, user?.uid, userScopedTimelineKey]);

  const upsertBatchSummary = useCallback((summary: BatchSummary) => {
    queryClient.setQueryData<BatchSummary[]>(BATCHES_QUERY_KEY(user?.uid ?? null), (prev = []) => {
      const filtered = prev.filter((batch) => !(batch.batchId === summary.batchId && batch.deviceId === summary.deviceId));
      return sortBatchesByProcessedAtDesc([summary, ...filtered]);
    });
  }, [queryClient, user?.uid]);

  const openBatchBrowser = useCallback(() => {
    setBatchBrowserPageIndex(0);
    setBatchBrowserOpen(true);
  }, []);

  const handleBatchSelectValueChange = useCallback((value: string) => {
    if (value === NO_BATCH_SELECTED_KEY) {
      handleBatchSelect("");
      return;
    }
    if (value === SEE_ALL_BATCHES_KEY) {
      openBatchBrowser();
      return;
    }
    handleBatchSelect(value);
  }, [handleBatchSelect, openBatchBrowser]);

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
      moderationState: ("moderationState" in detail && detail.moderationState === "quarantined")
        ? "quarantined"
        : "approved",
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
    if (pointIndex !== null) {
      const stored = parseStoredTimelineIndexes(safeLocalStorageGet(
        userScopedTimelineKey,
        null,
        { context: "map:timeline:read-from-all", userId: user?.uid }
      ));
      safeLocalStorageSet(
        userScopedTimelineKey,
        JSON.stringify({
          ...stored,
          [point.batchKey]: pointIndex,
        }),
        { context: "map:timeline:update-from-all", userId: user?.uid }
      );
    }
    if (user) {
      safeLocalStorageSet(
        userScopedSelectionKey,
        point.batchKey,
        { context: "map:selected-batch:from-all", userId: user.uid }
      );
    }
  }, [isShowingAllPublic24h, user, userScopedSelectionKey, userScopedTimelineKey]);

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
  const batchSelectValue = selectedBatchKey || NO_BATCH_SELECTED_KEY;
  const batchSelectPlaceholder = user ? "Select batch" : "Select a public batch";
  const batchBrowserActionLabel = "See all batches...";
  const batchBrowserTitle = user ? "All measurement batches" : "All public measurement batches";
  const allModeBatchCount = useMemo(() => (
    new Set(
      rows
        .map((row) => row.batchKey)
        .filter((key): key is string => typeof key === "string" && key.length > 0)
    ).size
  ), [rows]);

  // Use all-public mode by default when nothing is selected, but defer the heavy 3D viewport on the anonymous hero.
  const effectiveShowAllMode = isShowingAllPublic24h || !selectedBatchKey;
  const isAnonymousHeroState = !user && !selectedBatchKey && !rows.length;
  const shouldRenderMapViewport = isMapViewportActivated || !isAnonymousHeroState;
  const isMapZoomHydrated = !isAuthLoading && zoomHydrationKey === userScopedZoomKey;
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
    if (!captureAvailable) return "The active 3D map canvas is not ready for capture in this browser.";
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
  const shouldShowMeasurementSection = rows.length > 0 || Boolean(selectedBatchKey && isLoadingBatch);

  useEffect(() => {
    if (isAnonymousHeroState || isMapViewportActivated) return;
    startTransition(() => {
      setMapViewportActivated(true);
    });
  }, [isAnonymousHeroState, isMapViewportActivated]);

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
      setExportError("The active 3D map canvas is not ready for capture in this browser.");
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
    setExportStatus("Preparing active map capture...");
    setIsExporting(true);
    setIndexOverride(0);

    try {
      await waitForAnimationFrames(2);

      captureSession = await (map3DRef.current?.startCaptureSession() ?? Promise.resolve(null));
      const captureCanvas = captureSession?.canvas ?? null;
      if (!captureCanvas) {
        throw new Error("Unable to prepare the active map and overlay for video export.");
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
      setExportStatus("Your video is ready to download!");
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
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: MAP_VIEWPORT_BACKGROUND,
        }}
      />
      {/* ---- Always-visible map ---- */}
      <Suspense fallback={<div style={{ width: "100%", height: "100%", background: MAP_VIEWPORT_BACKGROUND }} />}>
        {shouldRenderMapViewport && isMapZoomHydrated ? (
          <Map3D
            ref={map3DRef}
            data={data}
            selectedIndex={selectedIndex}
            onSelectIndex={effectiveShowAllMode ? undefined : handleTimelineIndexChange}
            onSelectPoint={handleMapPointSelect}
            onZoomChange={handleMapZoomChange}
            autoCenterKey={autoCenterKey}
            interleaved={settings.interleavedRendering}
            showAllMode={effectiveShowAllMode}
            defaultZoom={persistedMapZoom ?? undefined}
            forceFollowSelection={!effectiveShowAllMode && (trackBall || isExporting)}
          />
        ) : null}
      </Suspense>

      {/* ---- Welcome hero overlay (when no batch selected and no data) ---- */}
      {isAnonymousHeroState ? (
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
              background: MAP_PANEL_BACKGROUND,
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              border: MAP_PANEL_BORDER,
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
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                fill="none"
              />
              <circle cx="12" cy="20" r="1" fill="var(--accent-9)" opacity="0.8" />
              <circle cx="16" cy="21" r="0.7" fill="var(--accent-9)" opacity="0.6" />
              <circle cx="14" cy="23" r="0.5" fill="var(--accent-9)" opacity="0.4" />
            </svg>
            <h2 style={{ margin: 0, fontSize: "var(--font-size-6)", fontWeight: 700 }}>
              {MAP_EMPTY_STATE_TITLE}
            </h2>
            <p style={{ marginTop: "var(--space-3)", color: "var(--gray-11)", fontSize: "var(--font-size-3)" }}>
              {MAP_EMPTY_STATE_DESCRIPTION}
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
                  color: "var(--accent-contrast)",
                  fontWeight: 600,
                  fontSize: "var(--font-size-2)",
                  cursor: "pointer",
                }}
              >
                Browse public data
              </button>
              <button
                type="button"
                onClick={() => openAppRouteInNewTab(APP_ROUTES.pairingGuide)}
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
          top: MAP_FLOATING_PANEL_TOP,
          right: "var(--space-4)",
          zIndex: 110,
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
          maxWidth: 360,
          width: "calc(100% - var(--space-8))",
          maxHeight: "calc(100dvh - env(safe-area-inset-top, 0px) - 88px)",
          overflowY: "auto",
          paddingBottom: "var(--space-2)",
          scrollbarWidth: "thin",
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
            padding: "var(--space-3)",
            borderRadius: "var(--radius-3)",
            background: MAP_PANEL_BACKGROUND,
            backdropFilter: MAP_PANEL_BLUR,
            WebkitBackdropFilter: MAP_PANEL_BLUR,
            border: MAP_PANEL_BORDER,
            boxShadow: "var(--shadow-3)",
            color: "var(--gray-12)",
          }}
        >
          <label style={{ display: "block", marginBottom: 6, fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
            Measurement batch
          </label>
          <div
            style={{
              width: "fit-content",
              minWidth: "min(420px, 100%)",
              maxWidth: "min(760px, 100%)",
            }}
          >
            <Select.Root
              value={batchSelectValue}
              onValueChange={handleBatchSelectValueChange}
              disabled={isAuthLoading}
            >
              <Select.Trigger
                aria-label="Measurement batch"
                placeholder={batchSelectPlaceholder}
                style={{
                  width: "100%",
                  fontFamily: "var(--default-font-family)",
                  fontSize: "var(--font-size-2)",
                  fontWeight: 400,
                  letterSpacing: 0,
                  color: "var(--gray-12)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              />
              <Select.Content
                position="popper"
                style={{
                  width: "max-content",
                  minWidth: "var(--radix-select-trigger-width)",
                  maxWidth: "calc(100vw - 32px)",
                  maxHeight: "min(360px, var(--radix-select-content-available-height))",
                  fontFamily: "var(--default-font-family)",
                  fontSize: "var(--font-size-2)",
                  fontWeight: 400,
                  letterSpacing: 0,
                }}
              >
                <Select.Item value={NO_BATCH_SELECTED_KEY}>
                  <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {batchSelectPlaceholder}
                  </span>
                </Select.Item>
                <Select.Item value={SHOW_ALL_PUBLIC_24H_KEY}>
                  <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    Show all public (last 24h)
                  </span>
                </Select.Item>
                {visibleDropdownBatches.map((batch) => {
                  const key = encodeBatchKey(batch.deviceId, batch.batchId);
                  return (
                    <Select.Item key={key} value={key}>
                      <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {formatBatchLabel(batch)}
                      </span>
                    </Select.Item>
                  );
                })}
                <Select.Item value={SEE_ALL_BATCHES_KEY}>
                  <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {batchBrowserActionLabel}
                  </span>
                </Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          {shouldShowMeasurementSection || isExportSectionVisible ? (
            <div
              style={{
                marginTop: "var(--space-3)",
                paddingTop: "var(--space-3)",
                borderTop: MAP_PANEL_SECTION_BORDER,
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-3)",
              }}
            >
              {rows.length ? (
                isShowingAllPublic24h ? (
                  <div>
                    <p style={{ margin: 0, fontWeight: 600, fontSize: "var(--font-size-2)" }}>
                      All public data — last 24 hours
                    </p>
                    <p style={{ margin: "4px 0 0", fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                      <strong>{rows.length}</strong> measurements across <strong>{allModeBatchCount}</strong> batches.
                      Click any point to drill in.
                    </p>
                  </div>
                ) : (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "var(--space-3)",
                      }}
                    >
                      <label htmlFor="measurement-slider" style={{ fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                        Timeline
                      </label>
                      <span style={{ fontSize: "var(--font-size-1)", color: "var(--gray-11)", whiteSpace: "nowrap" }}>
                        {rows.length} measurements
                      </span>
                    </div>
                    <input
                      id="measurement-slider"
                      type="range"
                      min={0}
                      max={rows.length - 1}
                      step={1}
                      value={selectedIndex}
                      onChange={(e) => handleTimelineIndexChange(Number(e.target.value))}
                      style={{ width: "100%", marginTop: 4 }}
                    />
                    <div
                      style={{
                        marginTop: "var(--space-2)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "var(--space-3)",
                        color: "var(--gray-11)",
                        fontSize: "var(--font-size-1)",
                      }}
                    >
                      <label htmlFor="ball-tracking-toggle" style={{ cursor: "pointer", fontWeight: 500 }}>
                        {trackBall ? "Track Node Mode" : "Free Mode"}
                      </label>
                      <Switch
                        id="ball-tracking-toggle"
                        checked={trackBall}
                        onCheckedChange={setTrackBall}
                      />
                    </div>
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
                  </div>
                )
              ) : selectedBatchKey && isLoadingBatch ? (
                <div
                  style={{
                    color: "var(--gray-11)",
                    fontSize: "var(--font-size-2)",
                  }}
                >
                  Loading measurements…
                </div>
              ) : null}

              {isExportSectionVisible ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                    paddingTop: shouldShowMeasurementSection ? "var(--space-3)" : 0,
                    borderTop: shouldShowMeasurementSection ? MAP_PANEL_SECTION_BORDER : "none",
                  }}
                >
                  {isExporting ? (
                    <>
                      <p style={{ margin: 0, fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                        {exportStatus ?? "Exporting..."}
                      </p>
                      <div
                        style={{
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
                    </>
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                        {renderedVideoUrl ? (
                          <>
                            <a
                              href={renderedVideoUrl}
                              download={renderedVideoName ?? "export.webm"}
                              style={{
                                display: "inline-block",
                                padding: "var(--space-1) var(--space-3)",
                                borderRadius: "var(--radius-2)",
                                background: "var(--accent-9)",
                                color: "var(--accent-contrast)",
                                fontWeight: 600,
                                fontSize: "var(--font-size-1)",
                                textDecoration: "none",
                                cursor: "pointer",
                              }}
                            >
                              Download Video
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
                              Regenerate Video
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={handleRenderVideo}
                            disabled={!canStartExport}
                            style={{
                              padding: "var(--space-1) var(--space-3)",
                              borderRadius: "var(--radius-2)",
                              border: "none",
                              background: canStartExport ? "var(--accent-9)" : "var(--gray-a5)",
                              color: canStartExport ? "var(--accent-contrast)" : "var(--gray-11)",
                              fontWeight: 600,
                              fontSize: "var(--font-size-1)",
                              cursor: canStartExport ? "pointer" : "not-allowed",
                            }}
                          >
                            Create Video Now
                          </button>
                        )}
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: "var(--font-size-1)",
                          color: renderedVideoUrl ? "var(--accent-11)" : "var(--gray-11)",
                        }}
                      >
                        {renderedVideoUrl
                          ? (exportStatus ?? "Your video is ready to download.")
                          : (exportDisabledReason ?? "Create a video flythrough from the selected measurement batch.")}
                      </p>
                    </>
                  )}
                  {exportError ? (
                    <p style={{ margin: 0, fontSize: "var(--font-size-1)", color: "#f87171" }}>
                      {exportError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <Dialog.Root open={isBatchBrowserOpen} onOpenChange={setBatchBrowserOpen}>
        <Dialog.Content
          size="4"
          style={{
            width: "min(760px, 96vw)",
            maxWidth: "760px",
            maxHeight: "90vh",
            overflowY: "auto",
          }}
        >
          <Dialog.Title>{batchBrowserTitle}</Dialog.Title>
          <Dialog.Description>
            Complete measurement batch history.
          </Dialog.Description>
          <Flex direction="column" gap="3" mt="4">
            {batchBrowserQuery.error ? (
              <Text size="2" color="red">
                {batchBrowserQuery.error instanceof Error
                  ? batchBrowserQuery.error.message
                  : "Unable to load more batches."}
              </Text>
            ) : null}
            <Flex
              align="end"
              justify="between"
              gap="3"
              wrap="wrap"
              style={{
                padding: "var(--space-3)",
                border: "1px solid var(--gray-a5)",
                borderRadius: "var(--radius-3)",
                background: "var(--gray-a2)",
              }}
            >
              <Flex direction="column" gap="1">
                <Text size="1" color="gray">Time range</Text>
                <Select.Root
                  value={batchBrowserTimeRange}
                  onValueChange={(value) => setBatchBrowserTimeRange(value as BatchBrowserTimeRange)}
                >
                  <Select.Trigger aria-label="Batch browser time range" />
                  <Select.Content>
                    <Select.Item value="all">All time</Select.Item>
                    <Select.Item value="8h">Last 8 hours</Select.Item>
                    <Select.Item value="24h">Last 24 hours</Select.Item>
                    <Select.Item value="7d">Last 7 days</Select.Item>
                    <Select.Item value="30d">Last 30 days</Select.Item>
                  </Select.Content>
                </Select.Root>
              </Flex>
              <Flex align="center" gap="4" wrap="wrap">
                <Flex align="center" gap="2">
                  <Switch
                    id="batch-browser-public-filter"
                    checked={showPublicBatchBrowser}
                    onCheckedChange={setShowPublicBatchBrowser}
                  />
                  <label
                    htmlFor="batch-browser-public-filter"
                    style={{ fontSize: "var(--font-size-2)", color: "var(--gray-12)", cursor: "pointer" }}
                  >
                    Public
                  </label>
                </Flex>
                <Flex align="center" gap="2">
                  <Switch
                    id="batch-browser-private-filter"
                    checked={showPrivateBatchBrowser}
                    onCheckedChange={setShowPrivateBatchBrowser}
                  />
                  <label
                    htmlFor="batch-browser-private-filter"
                    style={{ fontSize: "var(--font-size-2)", color: "var(--gray-12)", cursor: "pointer" }}
                  >
                    Private
                  </label>
                </Flex>
              </Flex>
            </Flex>
            <Flex align="center" justify="between" gap="3" wrap="wrap">
              <ResultCountControl
                itemLabelSingular="batch"
                itemLabelPlural="batches"
                pageStart={batchBrowserPagination.pageStart}
                pageEnd={batchBrowserPagination.pageEnd}
                totalCount={filteredBatchBrowserBatches.length}
                onShowLess={() => setBatchBrowserPageIndex((prev) => prev - 1)}
                onShowMore={() => setBatchBrowserPageIndex((prev) => prev + 1)}
              />
              {batchBrowserQuery.isFetching ? (
                <Text size="1" color="gray">Refreshing...</Text>
              ) : null}
            </Flex>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--space-2)",
                maxHeight: "60vh",
                overflowY: "auto",
                paddingRight: "var(--space-1)",
              }}
            >
              {!visibleBatchBrowserRows.length ? (
                <Text size="2" color="gray">
                  {batchBrowserQuery.isLoading
                    ? "Loading batches..."
                    : batchBrowserBatches.length
                      ? "No batches match these filters."
                      : "No batches available."}
                </Text>
              ) : visibleBatchBrowserRows.map((batch) => {
                const key = encodeBatchKey(batch.deviceId, batch.batchId);
                const isSelected = key === selectedBatchKey;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      upsertBatchSummary(batch);
                      handleBatchSelect(key);
                      setBatchBrowserOpen(false);
                    }}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "var(--space-3)",
                      borderRadius: "var(--radius-3)",
                      border: isSelected ? "1px solid var(--accent-8)" : "1px solid var(--gray-a5)",
                      background: isSelected ? "var(--accent-a3)" : "var(--color-surface)",
                      color: "var(--gray-12)",
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: "var(--space-3)",
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{formatBatchLabel(batch)}</span>
                      <span style={{ fontFamily: "monospace", fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                        {batch.batchId}
                      </span>
                    </div>
                    <span style={{ display: "block", marginTop: 4, fontSize: "var(--font-size-1)", color: "var(--gray-11)" }}>
                      {batch.visibility === "public" ? "Public" : "Private"} batch on {batch.deviceName?.trim().length ? batch.deviceName : batch.deviceId}
                    </span>
                  </button>
                );
              })}
            </div>
            <Flex justify="end">
              <Button type="button" variant="soft" onClick={() => setBatchBrowserOpen(false)}>
                Close
              </Button>
            </Flex>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}
