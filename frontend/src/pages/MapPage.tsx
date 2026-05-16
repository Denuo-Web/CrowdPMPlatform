import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { timestampToMillis, type IngestPoint, type UserThemeAppearance } from "@crowdpm/types";
import { Button, Dialog, Flex, Select, Switch, Text } from "@radix-ui/themes";
import {
  fetchBatchDetail,
  fetchPublicBatchMap,
  fetchDemoBatch,
  fetchPublicBatchDetail,
  listBatches,
  listPublicBatches,
  type BatchSummary,
  type MeasurementRecord,
} from "../lib/api";
import { decodeBatchKey, encodeBatchKey } from "../lib/batchKeys";
import { APP_ROUTES, openAppRouteInNewTab } from "../lib/appRoutes";
import { logWarning } from "../lib/logger";
import { safeLocalStorageGet, safeLocalStorageRemove, safeLocalStorageSet, scopedStorageKey } from "../lib/storage";
import {
  clampTimelineIndex,
  MAP_SELECTION_STORAGE_KEYS,
  MAX_PERSISTED_MAP_ZOOM,
  MIN_PERSISTED_MAP_ZOOM,
  normalizeStoredBatchSelection,
  parseStoredMapZoom,
  readStoredTimelineIndex,
  SHOW_ALL_PUBLIC_24H_KEY,
  writeStoredTimelineIndex,
} from "../lib/mapSelection";
import {
  detectCanvasVideoExportSupport,
  startCanvasRecording,
} from "../lib/videoExport";
import { useAuth } from "../providers/AuthProvider";
import { useUserSettings } from "../providers/UserSettingsProvider";
import type { Map3DCaptureSession, Map3DHandle } from "../components/Map3D";
import { clampPageIndex, getPaginationWindow, ResultCountControl } from "../components/PaginationControl";

const BATCH_LIST_STALE_MS = 30_000; // keep batch list warm for 30 seconds to avoid redundant refetches
const DROPDOWN_BATCH_LIMIT = 20;
const NO_BATCH_SELECTED_KEY = "__no_batch_selected__";
const SEE_ALL_BATCHES_KEY = "__see_all_batches__";
const SHOW_ALL_PUBLIC_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SHOW_ALL_PUBLIC_BATCH_LIMIT = 200;
const EXPANDED_BATCH_FETCH_LIMIT = 500;
const VIDEO_EXPORT_DURATION_OPTIONS = [
  { label: "6s", value: 6_000 },
  { label: "12s", value: 12_000 },
  { label: "24s", value: 24_000 },
  { label: "30s", value: 30_000 },
] as const;
const VIDEO_EXPORT_FPS_OPTIONS = [24, 30, 60] as const;
const VIDEO_EXPORT_QUALITY_OPTIONS = [
  { label: "Low (2.5 Mbps)", value: "low", videoBitsPerSecond: 2_500_000 },
  { label: "Medium (5 Mbps)", value: "medium", videoBitsPerSecond: 5_000_000 },
  { label: "High (10 Mbps)", value: "high", videoBitsPerSecond: 10_000_000 },
] as const;
const VIDEO_EXPORT_HOLD_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "1s", value: 1_000 },
  { label: "2s", value: 2_000 },
] as const;
const VIDEO_EXPORT_MIN_POINT_MS = 300;
const VIDEO_EXPORT_VISUAL_SETTLE_FRAMES = 4;
const VIDEO_EXPORT_NON_BLACK_RETRIES = 10;
const VIDEO_EXPORT_ORBIT_DEGREES = 24;
const VIDEO_EXPORT_START_TILT = 45;
const VIDEO_EXPORT_TARGET_TILT = 67.5;
const VIDEO_EXPORT_TILT_RAMP_PORTION = 0.2;
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
const EXPANDED_BATCHES_QUERY_KEY = (uid: string | null | undefined) => ["batchesExpanded", uid ?? "guest", EXPANDED_BATCH_FETCH_LIMIT] as const;
const BATCH_DETAIL_QUERY_KEY = (uid: string, batchKey: string) => ["batchDetail", uid, batchKey] as const;
const Map3D = lazy(() => import("../components/Map3D"));
const TERMINAL_BATCH_ERROR_MESSAGES = ["unauthorized", "authentication required", "not_found", "batch not found"] as const;

type VisibleBatchAccess = "owned" | "public" | "both";
type VisibleBatchSummary = BatchSummary & {
  access: VisibleBatchAccess;
};

type BatchBrowserTimeRange = "all" | "8h" | "24h" | "7d" | "30d";
type VideoExportDurationMs = (typeof VIDEO_EXPORT_DURATION_OPTIONS)[number]["value"];
type VideoExportFps = (typeof VIDEO_EXPORT_FPS_OPTIONS)[number];
type VideoExportQuality = (typeof VIDEO_EXPORT_QUALITY_OPTIONS)[number]["value"];
type VideoExportHoldMs = (typeof VIDEO_EXPORT_HOLD_OPTIONS)[number]["value"];
type VideoExportSettings = {
  durationMs: VideoExportDurationMs;
  fps: VideoExportFps;
  quality: VideoExportQuality;
  holdMs: VideoExportHoldMs;
  enableHeadingOrbit: boolean;
  enableTiltRamp: boolean;
};

const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = {
  durationMs: 12_000,
  fps: 30,
  quality: "medium",
  holdMs: 1_000,
  enableHeadingOrbit: true,
  enableTiltRamp: true,
};

type MapMeasurementRecord = MeasurementRecord & {
  batchKey?: string;
  batchPointIndex?: number;
};

type MapPageProps = {
  mapAppearance: UserThemeAppearance;
};

class VideoExportCancelledError extends Error {
  constructor() {
    super("Video export cancelled.");
    this.name = "VideoExportCancelledError";
  }
}

function throwIfVideoExportAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new VideoExportCancelledError();
  }
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfVideoExportAborted(signal);
  if (!signal) return promise;

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      reject(new VideoExportCancelledError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
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
  points: IngestPoint[],
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

function waitForAnimationFrame(signal?: AbortSignal): Promise<number> {
  throwIfVideoExportAborted(signal);
  return new Promise((resolve, reject) => {
    let rafId = 0;
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      cleanup();
      reject(new VideoExportCancelledError());
    };
    if (signal) signal.addEventListener("abort", handleAbort, { once: true });
    rafId = window.requestAnimationFrame((timestamp) => {
      cleanup();
      resolve(timestamp);
    });
  });
}

async function waitForAnimationFrames(count: number, signal?: AbortSignal) {
  for (let index = 0; index < count; index += 1) {
    await waitForAnimationFrame(signal);
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfVideoExportAborted(signal);
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      reject(new VideoExportCancelledError());
    };
    if (signal) signal.addEventListener("abort", handleAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
  });
}

function easeInOutCubic(t: number): number {
  const clamped = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function getVideoExportBitrate(quality: VideoExportQuality): number {
  return VIDEO_EXPORT_QUALITY_OPTIONS.find((option) => option.value === quality)?.videoBitsPerSecond
    ?? 5_000_000;
}

function getVideoExportTilt(settings: VideoExportSettings, progress: number): number {
  if (!settings.enableTiltRamp) return VIDEO_EXPORT_TARGET_TILT;
  const rampProgress = Math.min(Math.max(progress / VIDEO_EXPORT_TILT_RAMP_PORTION, 0), 1);
  const easedProgress = easeInOutCubic(rampProgress);
  return VIDEO_EXPORT_START_TILT + (VIDEO_EXPORT_TARGET_TILT - VIDEO_EXPORT_START_TILT) * easedProgress;
}

function formatVideoExportTimestamp(point: MapMeasurementRecord): string {
  const timestampMs = timestampToMillis(point.timestamp);
  return timestampMs === null ? "Timestamp unavailable" : new Date(timestampMs).toLocaleString();
}

function getVideoExportMeasurementOverlayLines(
  point: MapMeasurementRecord | undefined,
  index: number,
  totalCount: number,
  label: string
): string[] {
  if (!point) return [label, `Point ${Math.min(index + 1, totalCount)} of ${totalCount}`];

  const pollutant = String(point.pollutant);
  const pollutantLabel = pollutant === "pm25" ? "PM2.5" : pollutant.toUpperCase();
  const valueLabel = `${pollutantLabel}: ${point.value} ${point.unit || "µg/m³"}`;
  const precisionLabel = point.precision != null ? ` · ±${Math.round(point.precision)}m` : "";
  const altitudeLabel = point.altitude != null ? ` · alt ${Math.round(point.altitude)}m` : "";

  return [
    label,
    `Point ${index + 1} of ${totalCount} · ${formatVideoExportTimestamp(point)}`,
    valueLabel,
    `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}${precisionLabel}${altitudeLabel}`,
  ];
}

function getVideoExportWaypointIndexes(pointCount: number, motionDurationMs: number): number[] {
  const lastIndex = pointCount - 1;
  if (lastIndex <= 0) return [0];

  const maxSegments = Math.max(1, Math.floor(motionDurationMs / VIDEO_EXPORT_MIN_POINT_MS));
  const segmentCount = Math.min(lastIndex, maxSegments);
  if (segmentCount >= lastIndex) {
    return Array.from({ length: pointCount }, (_, index) => index);
  }

  const indexes: number[] = [];
  for (let step = 0; step <= segmentCount; step += 1) {
    const index = Math.round((lastIndex * step) / segmentCount);
    const previous = indexes[indexes.length - 1];
    indexes.push(previous === undefined ? index : Math.max(index, previous + 1));
  }
  indexes[indexes.length - 1] = lastIndex;
  return indexes;
}

function hasNonBlackCaptureSamples(canvas: HTMLCanvasElement): boolean | null {
  if (canvas.width <= 0 || canvas.height <= 0) return false;

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = Math.min(canvas.width, 64);
  sampleCanvas.height = Math.min(canvas.height, 36);
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = sampleCanvas.getContext("2d", { willReadFrequently: true });
    context?.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
  }
  catch {
    return null;
  }
  if (!context) return null;

  const samplePoints = [
    [0.08, 0.08],
    [0.5, 0.08],
    [0.92, 0.08],
    [0.2, 0.35],
    [0.5, 0.5],
    [0.8, 0.35],
    [0.08, 0.92],
    [0.5, 0.92],
    [0.92, 0.92],
  ] as const;

  try {
    return samplePoints.some(([ratioX, ratioY]) => {
      const x = Math.min(Math.max(Math.round(sampleCanvas.width * ratioX), 0), sampleCanvas.width - 1);
      const y = Math.min(Math.max(Math.round(sampleCanvas.height * ratioY), 0), sampleCanvas.height - 1);
      const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;
      return alpha > 8 && red + green + blue > 30;
    });
  }
  catch {
    return null;
  }
}

async function waitForNonBlackCaptureFrame(
  canvas: HTMLCanvasElement,
  onRetry?: () => Promise<void>,
  maxRetries = VIDEO_EXPORT_NON_BLACK_RETRIES,
  signal?: AbortSignal
) {
  for (let retry = 0; retry <= maxRetries; retry += 1) {
    throwIfVideoExportAborted(signal);
    const result = hasNonBlackCaptureSamples(canvas);
    if (result !== false) return;
    await waitForAnimationFrames(1, signal);
    await onRetry?.();
  }
}

function sanitizeFileSegment(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "batch";
}

export default function MapPage({ mapAppearance }: MapPageProps) {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { settings } = useUserSettings();
  const queryClient = useQueryClient();

  const userScopedSelectionKey = useMemo(
    () => scopedStorageKey(MAP_SELECTION_STORAGE_KEYS.lastSelection, user?.uid ?? undefined),
    [user?.uid]
  );
  const userScopedZoomKey = useMemo(
    () => scopedStorageKey(MAP_SELECTION_STORAGE_KEYS.lastMapZoom, user?.uid ?? undefined),
    [user?.uid]
  );
  const userScopedTimelineKey = useMemo(
    () => scopedStorageKey(MAP_SELECTION_STORAGE_KEYS.lastTimelineIndex, user?.uid ?? undefined),
    [user?.uid]
  );

  // Keep track of which batch is selected plus the position in the measurement timeline.
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>("");
  const [isDemoBatchLoading, setDemoBatchLoading] = useState(false);
  const [persistedMapZoom, setPersistedMapZoom] = useState<number | null>(null);
  const [zoomHydrationKey, setZoomHydrationKey] = useState<string | null>(null);
  const [isBatchBrowserOpen, setBatchBrowserOpen] = useState(false);
  const [batchBrowserPageIndex, setBatchBrowserPageIndex] = useState(0);
  const [batchBrowserTimeRange, setBatchBrowserTimeRange] = useState<BatchBrowserTimeRange>("all");
  const [showPublicBatchBrowser, setShowPublicBatchBrowser] = useState(true);
  const [showPrivateBatchBrowser, setShowPrivateBatchBrowser] = useState(true);
  const selectionHydratedRef = useRef<string | null>(null);
  const zoomHydratedRef = useRef<string | null>(null);
  const timelineHydratedRef = useRef<string | null>(null);
  const skipIndexResetRef = useRef(false);
  const map3DRef = useRef<Map3DHandle | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const [captureAvailable, setCaptureAvailable] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [renderedVideoUrl, setRenderedVideoUrl] = useState<string | null>(null);
  const [renderedVideoName, setRenderedVideoName] = useState<string | null>(null);
  const [, setRenderedVideoMimeType] = useState<string | null>(null);
  const [isVideoExportSettingsOpen, setVideoExportSettingsOpen] = useState(false);
  const [videoExportSettings, setVideoExportSettings] = useState<VideoExportSettings>(DEFAULT_VIDEO_EXPORT_SETTINGS);
  const recordingSupport = useMemo(() => detectCanvasVideoExportSupport(), []);
  const [isMapViewportActivated, setMapViewportActivated] = useState(false);

  const loadBatchSummaries = useCallback(async (ownedLimit?: number, publicLimit?: number) => {
    if (!user) {
      return toPublicVisibleBatches(await listPublicBatches(publicLimit));
    }
    const [owned, publicBatches] = await Promise.all([
      listBatches(ownedLimit).catch(() => []),
      listPublicBatches(publicLimit),
    ]);
    return mergeBatchLists(owned, publicBatches);
  }, [user]);

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
    queryKey: EXPANDED_BATCHES_QUERY_KEY(user?.uid ?? null),
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
        const cutoffIso = new Date(Math.floor(cutoff / 60_000) * 60_000).toISOString();
        const mapResponse = await fetchPublicBatchMap({
          limit: SHOW_ALL_PUBLIC_BATCH_LIMIT,
          since: cutoffIso,
        });

        return mapResponse.batches
          .flatMap((detail) => {
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

    const storedIndex = readStoredTimelineIndex(
      safeLocalStorageGet(
        userScopedTimelineKey,
        null,
        { context: "map:timeline:read", userId: user?.uid }
      ),
      selectedBatchKey,
      rows.length - 1
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

    const storedSelection = normalizeStoredBatchSelection(safeLocalStorageGet(
      userScopedSelectionKey,
      null,
      { context: "map:selected-batch:hydrate", userId: user?.uid }
    ));
    setSelectedBatchKey(storedSelection.value);
    if (storedSelection.shouldClearInvalid) {
      safeLocalStorageRemove(
        userScopedSelectionKey,
        { context: "map:selected-batch:clear-invalid", userId: user?.uid }
      );
    }
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
  }, [
    isAuthLoading,
    measurementQuery.error,
    measurementQuery.isError,
    measurementQuery.isFetching,
    measurementQuery.isLoading,
    selectedBatchKey,
    user?.uid,
    userScopedSelectionKey,
  ]);

  // // Reset override when data changes
  // useEffect(() => {
  //   setIndexOverride(null);
  // }, [selectedBatchKey, rows.length]);

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

  const upsertBatchSummary = useCallback((summary: VisibleBatchSummary) => {
    const mergeSummaries = (prev: VisibleBatchSummary[] = []) => {
      const filtered = prev.filter((batch) => (
        batch.batchId !== summary.batchId || batch.deviceId !== summary.deviceId
      ));
      return sortBatchesByProcessedAtDesc([summary, ...filtered]);
    };

    queryClient.setQueryData<VisibleBatchSummary[]>(BATCHES_QUERY_KEY(user?.uid ?? null), mergeSummaries);
    queryClient.setQueryData<VisibleBatchSummary[]>(EXPANDED_BATCHES_QUERY_KEY(user?.uid ?? null), mergeSummaries);
  }, [queryClient, user?.uid]);

  const handleDemoBatchSelect = useCallback(async () => {
    setDemoBatchLoading(true);
    try {
      const demoBatch = await fetchDemoBatch();
      if (!demoBatch) {
        handleBatchSelect(SHOW_ALL_PUBLIC_24H_KEY);
        return;
      }

      const key = encodeBatchKey(demoBatch.deviceId, demoBatch.batchId);
      upsertBatchSummary({ ...demoBatch, access: "public" });
      handleBatchSelect(key);
    }
    catch (err) {
      logWarning("Unable to load demo batch", undefined, err);
      handleBatchSelect(SHOW_ALL_PUBLIC_24H_KEY);
    }
    finally {
      setDemoBatchLoading(false);
    }
  }, [handleBatchSelect, upsertBatchSummary]);

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
    const clampedIndex = clampTimelineIndex(nextIndex, maxIndex);
    setIndexOverride(clampedIndex);

    if (!selectedBatchKey || selectedBatchKey === SHOW_ALL_PUBLIC_24H_KEY || !rows.length) return;
    safeLocalStorageSet(
      userScopedTimelineKey,
      writeStoredTimelineIndex(
        safeLocalStorageGet(
          userScopedTimelineKey,
          null,
          { context: "map:timeline:read", userId: user?.uid }
        ),
        selectedBatchKey,
        clampedIndex
      ),
      { context: "map:timeline:update", userId: user?.uid }
    );
  }, [rows.length, selectedBatchKey, user?.uid, userScopedTimelineKey]);

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

  const handleMapPointSelect = useCallback((point: { batchKey?: string; batchPointIndex?: number }) => {
    if (!isShowingAllPublic24h) return;
    if (!point.batchKey) return;
    skipIndexResetRef.current = true;
    setSelectedBatchKey(point.batchKey);
    const pointIndex = typeof point.batchPointIndex === "number" ? point.batchPointIndex : null;
    setIndexOverride(pointIndex);
    if (pointIndex !== null) {
      safeLocalStorageSet(
        userScopedTimelineKey,
        writeStoredTimelineIndex(
          safeLocalStorageGet(
            userScopedTimelineKey,
            null,
            { context: "map:timeline:read-from-all", userId: user?.uid }
          ),
          point.batchKey,
          pointIndex
        ),
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
  const isWatermarkedExport = settings.subscription.videoDownloadAccess === "preview_watermarked";
  const canExportSelection = useMemo(() => {
    if (!selectedBatchKey || isShowingAllPublic24h) return false;
    return Boolean(user && selectedSummary);
  }, [isShowingAllPublic24h, selectedBatchKey, selectedSummary, user]);
  const exportDisabledReason = useMemo(() => {
    if (!isExportSectionVisible) return null;
    if (!user) return "Sign in to create a video preview or unlock full downloads.";
    if (isLoadingBatch) return "Wait for the selected batch to finish loading before exporting.";
    if (!canExportSelection) {
      return "The selected batch is not available for export.";
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

  const handleOpenVideoExportSettings = useCallback(() => {
    if (!canStartExport) return;
    setVideoExportSettingsOpen(true);
  }, [canStartExport]);

  const handleCancelVideoExport = useCallback(() => {
    exportAbortRef.current?.abort();
    setExportStatus("Cancelling export...");
  }, []);

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
    const exportSettings = videoExportSettings;
    const overlayLabel = [
      selectedSummary?.deviceName?.trim() || selectedBatchParsed.deviceId,
      selectedBatchParsed.batchId,
    ].filter(Boolean).join(" · ");
    let currentFrameOverlayLines = getVideoExportMeasurementOverlayLines(rows[0], 0, pointCount, overlayLabel);
    const deviceSegment = sanitizeFileSegment(selectedSummary?.deviceName ?? selectedBatchParsed.deviceId);
    const batchSegment = sanitizeFileSegment(selectedBatchParsed.batchId);
    let recordingSession: ReturnType<typeof startCanvasRecording> | null = null;
    let captureSession: Map3DCaptureSession | null = null;
    const abortController = new AbortController();
    const { signal } = abortController;

    if (renderedVideoUrl) {
      URL.revokeObjectURL(renderedVideoUrl);
    }
    setRenderedVideoUrl(null);
    setRenderedVideoName(null);
    setRenderedVideoMimeType(null);
    setExportError(null);
    setExportProgress(0);
    setExportStatus("Preparing active map capture...");
    setVideoExportSettingsOpen(false);
    setIsExporting(true);
    setIndexOverride(0);
    exportAbortRef.current = abortController;

    try {
      await waitForAnimationFrames(VIDEO_EXPORT_VISUAL_SETTLE_FRAMES, signal);

      captureSession = await (map3DRef.current?.startCaptureSession({
        watermarkText: isWatermarkedExport ? "CrowdPM Preview" : null,
        captureFps: exportSettings.fps,
        frameOverlayLines: () => currentFrameOverlayLines,
      }) ?? Promise.resolve(null));
      throwIfVideoExportAborted(signal);
      const captureCanvas = captureSession?.canvas ?? null;
      if (!captureCanvas) {
        throw new Error("Unable to prepare the active map and overlay for video export.");
      }

      const motionDurationMs = Math.max(0, exportSettings.durationMs - (exportSettings.holdMs * 2));
      const waypointIndexes = getVideoExportWaypointIndexes(pointCount, motionDurationMs);
      const segmentCount = Math.max(waypointIndexes.length - 1, 1);
      const targetSegmentDurationMs = motionDurationMs / segmentCount;
      const plannedDurationMs = exportSettings.durationMs;
      const videoBitsPerSecond = getVideoExportBitrate(exportSettings.quality);

      const requestExportFrame = () => {
        captureSession?.requestFrame();
        recordingSession?.requestFrame();
      };
      const setFrameOverlayIndex = (index: number) => {
        const safeIndex = Math.min(Math.max(Math.round(index), 0), lastIndex);
        currentFrameOverlayLines = getVideoExportMeasurementOverlayLines(
          rows[safeIndex],
          safeIndex,
          pointCount,
          overlayLabel
        );
        requestExportFrame();
      };
      const waitForExportVisualReady = async () => {
        await abortable(
          map3DRef.current?.waitForVisualReady({ forExport: true }) ?? waitForAnimationFrames(3, signal),
          signal
        );
        throwIfVideoExportAborted(signal);
        requestExportFrame();
      };
      const waitForSettledCaptureFrame = async () => {
        await waitForExportVisualReady();
        await waitForNonBlackCaptureFrame(captureCanvas, async () => {
          requestExportFrame();
        }, VIDEO_EXPORT_NON_BLACK_RETRIES, signal);
      };
      const applyExportCameraFrame = (
        fromIndex: number,
        toIndex: number,
        pointProgress: number,
        totalProgress: number
      ) => {
        map3DRef.current?.setExportCameraFrame({
          fromIndex,
          toIndex,
          progress: pointProgress,
          headingOffsetDeg: exportSettings.enableHeadingOrbit ? VIDEO_EXPORT_ORBIT_DEGREES * totalProgress : 0,
          tilt: getVideoExportTilt(exportSettings, totalProgress),
        });
      };

      applyExportCameraFrame(0, 0, 0, 0);
      setFrameOverlayIndex(0);
      await waitForAnimationFrames(VIDEO_EXPORT_VISUAL_SETTLE_FRAMES, signal);
      requestExportFrame();
      await waitForSettledCaptureFrame();

      recordingSession = startCanvasRecording(captureCanvas, {
        fps: exportSettings.fps,
        mimeType: recordingSupport.mimeType ?? undefined,
        videoBitsPerSecond,
      });
      recordingSession.requestFrame();

      await waitForAnimationFrames(VIDEO_EXPORT_VISUAL_SETTLE_FRAMES, signal);
      requestExportFrame();
      if (exportSettings.holdMs > 0) {
        setExportStatus(`Holding first point for ${exportSettings.holdMs / 1000}s...`);
        await sleep(exportSettings.holdMs, signal);
        requestExportFrame();
      }
      setExportProgress(plannedDurationMs > 0 ? exportSettings.holdMs / plannedDurationMs : 0);

      let completedMotionMs = 0;
      for (let waypointIndex = 0; waypointIndex < waypointIndexes.length - 1; waypointIndex += 1) {
        const fromIndex = waypointIndexes[waypointIndex] ?? 0;
        const nextIndex = waypointIndexes[waypointIndex + 1] ?? lastIndex;
        const stepStartedAt = performance.now();
        setFrameOverlayIndex(nextIndex);
        setExportStatus(`Flying to point ${nextIndex + 1} of ${pointCount}...`);

        for (;;) {
          const elapsedMs = performance.now() - stepStartedAt;
          const pointProgress = targetSegmentDurationMs > 0
            ? Math.min(elapsedMs / targetSegmentDurationMs, 1)
            : 1;
          const totalProgress = plannedDurationMs > 0
            ? Math.min((exportSettings.holdMs + completedMotionMs + (pointProgress * targetSegmentDurationMs)) / plannedDurationMs, 1)
            : 1;
          const overlayIndex = Math.round(fromIndex + ((nextIndex - fromIndex) * pointProgress));
          setFrameOverlayIndex(overlayIndex);
          applyExportCameraFrame(fromIndex, nextIndex, pointProgress, totalProgress);
          setExportProgress(totalProgress);
          if (pointProgress >= 1) break;
          await waitForAnimationFrame(signal);
          requestExportFrame();
        }

        completedMotionMs += targetSegmentDurationMs;
        setIndexOverride(nextIndex);
        applyExportCameraFrame(nextIndex, nextIndex, 1, Math.min((exportSettings.holdMs + completedMotionMs) / plannedDurationMs, 1));
        requestExportFrame();
      }

      applyExportCameraFrame(lastIndex, lastIndex, 1, 1);
      setFrameOverlayIndex(lastIndex);
      requestExportFrame();
      if (exportSettings.holdMs > 0) {
        setExportStatus(`Holding final point for ${exportSettings.holdMs / 1000}s...`);
        await sleep(exportSettings.holdMs, signal);
        requestExportFrame();
      }
      setExportProgress(1);
      setExportStatus("Finalizing video...");

      const blob = await recordingSession.stop();
      recordingSession = null;
      const objectUrl = URL.createObjectURL(blob);

      setRenderedVideoUrl(objectUrl);
      setRenderedVideoName(`${deviceSegment}-${batchSegment}${isWatermarkedExport ? "-preview" : ""}.webm`);
      setRenderedVideoMimeType(blob.type || recordingSupport.mimeType);
      setExportStatus(isWatermarkedExport ? "Your preview is ready to download." : "Your video is ready to download!");
    }
    catch (err) {
      if (recordingSession) {
        await recordingSession.stop().catch(() => {});
      }
      if (err instanceof VideoExportCancelledError) {
        setExportStatus(null);
        setExportError(null);
        return;
      }
      const message = err instanceof Error ? err.message : "Unable to render the batch video.";
      setExportError(message);
      setExportStatus(null);
    }
    finally {
      map3DRef.current?.setExportCameraFrame(null);
      captureSession?.stop();
      if (exportAbortRef.current === abortController) {
        exportAbortRef.current = null;
      }
      setIsExporting(false);
      setIndexOverride(Math.min(previousIndex, lastIndex));
    }
  }, [
    canStartExport,
    recordingSupport.mimeType,
    renderedVideoUrl,
    rows,
    isWatermarkedExport,
    videoExportSettings,
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
            appearance={mapAppearance}
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
                onClick={() => { void handleDemoBatchSelect(); }}
                disabled={isDemoBatchLoading}
                style={{
                  padding: "var(--space-2) var(--space-4)",
                  borderRadius: "var(--radius-3)",
                  border: "none",
                  background: "var(--accent-9)",
                  color: "var(--accent-contrast)",
                  fontWeight: 600,
                  fontSize: "var(--font-size-2)",
                  cursor: isDemoBatchLoading ? "wait" : "pointer",
                  opacity: isDemoBatchLoading ? 0.8 : 1,
                }}
              >
                See Demo Data
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
                      <button
                        type="button"
                        onClick={handleCancelVideoExport}
                        style={{
                          alignSelf: "flex-start",
                          padding: "var(--space-1) var(--space-3)",
                          borderRadius: "var(--radius-2)",
                          border: "1px solid var(--gray-a6)",
                          background: "transparent",
                          color: "var(--gray-12)",
                          fontSize: "var(--font-size-1)",
                          cursor: "pointer",
                        }}
                      >
                        Cancel Export
                      </button>
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
                              {isWatermarkedExport ? "Download Preview" : "Download Video"}
                            </a>
                            <button
                              type="button"
                              onClick={handleOpenVideoExportSettings}
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
                            onClick={handleOpenVideoExportSettings}
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
                            {isWatermarkedExport ? "Create Preview" : "Create Video Now"}
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
                          : (exportDisabledReason ?? (isWatermarkedExport
                            ? "Create a watermarked preview flythrough from the selected measurement batch."
                            : "Create a video flythrough from the selected measurement batch."))}
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
      <Dialog.Root
        open={isVideoExportSettingsOpen}
        onOpenChange={(open) => {
          if (!isExporting) setVideoExportSettingsOpen(open);
        }}
      >
        <Dialog.Content
          size="3"
          style={{
            width: "min(440px, 94vw)",
            maxWidth: "440px",
          }}
        >
          <Dialog.Title>{isWatermarkedExport ? "Preview export settings" : "Video export settings"}</Dialog.Title>
          <Dialog.Description size="2" color="gray">
            Choose recording parameters before rendering the map flythrough. Large batches may run longer to keep each point visible.
          </Dialog.Description>

          <Flex direction="column" gap="3" style={{ marginTop: "var(--space-4)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <Text size="2" weight="medium">Duration</Text>
              <Select.Root
                value={String(videoExportSettings.durationMs)}
                onValueChange={(value) => {
                  setVideoExportSettings((prev) => ({ ...prev, durationMs: Number(value) as VideoExportDurationMs }));
                }}
              >
                <Select.Trigger aria-label="Video export duration" />
                <Select.Content>
                  {VIDEO_EXPORT_DURATION_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={String(option.value)}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <Text size="2" weight="medium">FPS</Text>
              <Select.Root
                value={String(videoExportSettings.fps)}
                onValueChange={(value) => {
                  setVideoExportSettings((prev) => ({ ...prev, fps: Number(value) as VideoExportFps }));
                }}
              >
                <Select.Trigger aria-label="Video export frame rate" />
                <Select.Content>
                  {VIDEO_EXPORT_FPS_OPTIONS.map((fps) => (
                    <Select.Item key={fps} value={String(fps)}>
                      {fps}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <Text size="2" weight="medium">Video quality</Text>
              <Select.Root
                value={videoExportSettings.quality}
                onValueChange={(value) => {
                  setVideoExportSettings((prev) => ({ ...prev, quality: value as VideoExportQuality }));
                }}
              >
                <Select.Trigger aria-label="Video export quality" />
                <Select.Content>
                  {VIDEO_EXPORT_QUALITY_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={option.value}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <Text size="2" weight="medium">Intro/outro hold</Text>
              <Select.Root
                value={String(videoExportSettings.holdMs)}
                onValueChange={(value) => {
                  setVideoExportSettings((prev) => ({ ...prev, holdMs: Number(value) as VideoExportHoldMs }));
                }}
              >
                <Select.Trigger aria-label="Video export intro and outro hold" />
                <Select.Content>
                  {VIDEO_EXPORT_HOLD_OPTIONS.map((option) => (
                    <Select.Item key={option.value} value={String(option.value)}>
                      {option.label}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </label>

            <label
              htmlFor="video-export-heading-orbit"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}
            >
              <Text size="2" weight="medium">Slow heading orbit</Text>
              <Switch
                id="video-export-heading-orbit"
                checked={videoExportSettings.enableHeadingOrbit}
                onCheckedChange={(checked) => {
                  setVideoExportSettings((prev) => ({ ...prev, enableHeadingOrbit: checked }));
                }}
              />
            </label>

            <label
              htmlFor="video-export-tilt-ramp"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)" }}
            >
              <Text size="2" weight="medium">Dive-in tilt ramp</Text>
              <Switch
                id="video-export-tilt-ramp"
                checked={videoExportSettings.enableTiltRamp}
                onCheckedChange={(checked) => {
                  setVideoExportSettings((prev) => ({ ...prev, enableTiltRamp: checked }));
                }}
              />
            </label>
          </Flex>

          <Flex gap="2" justify="end" style={{ marginTop: "var(--space-5)" }}>
            <Dialog.Close>
              <Button type="button" variant="soft">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="button" onClick={handleRenderVideo} disabled={!canStartExport}>
              Start Export
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
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
