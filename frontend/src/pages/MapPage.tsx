import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Map3D from "../components/Map3D";
import {
  fetchBatchDetail,
  listBatches,
  type BatchSummary,
  type MeasurementRecord,
  type IngestSmokeTestResponse,
  type IngestSmokeTestPoint,
  type IngestSmokeTestCleanupResponse,
} from "../lib/api";
import { useAuth } from "../providers/AuthProvider";

// Keys used to scope localStorage entries per user so shared browsers do not mix data.
const LEGACY_LAST_DEVICE_KEY = "crowdpm:lastSmokeTestDevice";
const LAST_SELECTION_KEY = "crowdpm:lastSmokeSelection";
const LAST_SMOKE_CACHE_KEY = "crowdpm:lastSmokeBatchCache";

// React Query cache keys. Keeping them as helpers avoids typos across the file.
const BATCHES_QUERY_KEY = (uid: string | null | undefined) => ["batches", uid ?? "guest"] as const;
const BATCH_DETAIL_QUERY_KEY = (uid: string, batchKey: string) => ["batchDetail", uid, batchKey] as const;

function scopedKey(base: string, uid?: string | null) {
  return uid ? `${base}:${uid}` : base;
}

function normaliseTimestamp(ts: MeasurementRecord["timestamp"]) {
  if (typeof ts === "number") return ts;
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }
  if (ts instanceof Date) return ts.getTime();
  return ts.toMillis();
}

type BatchKey = { deviceId: string; batchId: string };

function encodeBatchKey(deviceId: string, batchId: string): string {
  return `${deviceId}::${batchId}`;
}

function decodeBatchKey(value: string): BatchKey | null {
  if (!value) return null;
  const separator = value.indexOf("::");
  if (separator === -1) return null;
  const deviceId = value.slice(0, separator);
  const batchId = value.slice(separator + 2);
  if (!deviceId || !batchId) return null;
  return { deviceId, batchId };
}

type StoredSmokeBatch = {
  summary: BatchSummary;
  points: IngestSmokeTestPoint[];
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
      processedAt: typeof summary.processedAt === "string" ? summary.processedAt : new Date().toISOString(),
      visibility: summary.visibility === "public" ? "public" : "private",
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
  const time = batch.processedAt ? new Date(batch.processedAt) : null;
  const timeLabel = time ? time.toLocaleString() : "Pending timestamp";
  const name = batch.deviceName?.trim().length ? batch.deviceName : batch.deviceId;
  const countLabel = batch.count ? ` (${batch.count})` : "";
  return `${timeLabel} — ${name}${countLabel}`;
}

function pointsToMeasurementRecords(points: IngestSmokeTestPoint[], fallbackDeviceId: string, batchId: string): MeasurementRecord[] {
  return [...points]
    .sort((a, b) => {
      const aTs = normaliseTimestamp(a.timestamp as unknown as MeasurementRecord["timestamp"]);
      const bTs = normaliseTimestamp(b.timestamp as unknown as MeasurementRecord["timestamp"]);
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
      } satisfies MeasurementRecord;
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

export default function MapPage({
  pendingSmokeResult = null,
  onSmokeResultConsumed,
  pendingCleanupDetail = null,
  onCleanupDetailConsumed,
}: MapPageProps = {}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const userScopedSelectionKey = useMemo(() => scopedKey(LAST_SELECTION_KEY, user?.uid ?? undefined), [user?.uid]);
  const userScopedLegacyKey = useMemo(() => scopedKey(LEGACY_LAST_DEVICE_KEY, user?.uid ?? undefined), [user?.uid]);
  const userScopedCacheKey = useMemo(() => scopedKey(LAST_SMOKE_CACHE_KEY, user?.uid ?? undefined), [user?.uid]);

  // Keep track of which batch is selected plus the position in the measurement timeline.
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>(() => {
    if (typeof window === "undefined" || !user) return "";
    try {
      const stored = window.localStorage.getItem(userScopedSelectionKey);
      if (stored) return stored;
      const legacyScoped = window.localStorage.getItem(userScopedLegacyKey);
      if (legacyScoped) {
        window.localStorage.removeItem(userScopedLegacyKey);
      }
      const legacy = window.localStorage.getItem(LEGACY_LAST_DEVICE_KEY);
      if (legacy) {
        window.localStorage.removeItem(LEGACY_LAST_DEVICE_KEY);
      }
    }
    catch (err) {
      console.warn(err);
    }
    return "";
  });
  // const [selectedIndex, setSelectedIndex] = useState(0);
  const cacheHydratedRef = useRef<string | null>(null);


  const getCachedBatch = useCallback(() => {
    if (typeof window === "undefined") return null;
    return parseStoredSmokeBatch(window.localStorage.getItem(userScopedCacheKey));
  }, [userScopedCacheKey]);

  // Query #1: list of batches visible to the user.
  const batchesQuery = useQuery<BatchSummary[]>({
    queryKey: BATCHES_QUERY_KEY(user?.uid ?? null),
    queryFn: async () => {
      if (!user) return [];
      const list = await listBatches();
      return mergeCachedSummary(list, getCachedBatch());
    },
    enabled: Boolean(user),
    placeholderData: (prev) => prev ?? [],
    staleTime: 30_000,
  });

  const visibleBatches = useMemo(
    () => (user ? batchesQuery.data ?? [] : []),
    [batchesQuery.data, user]
  );

  useMemo(() => {
    if (!selectedBatchKey) return null;
    const parsed = decodeBatchKey(selectedBatchKey);
    if (!parsed) return null;
    return visibleBatches.find((batch) => batch.deviceId === parsed.deviceId && batch.batchId === parsed.batchId) ?? null;
  }, [selectedBatchKey, visibleBatches]);

  const batchDetailQueryKey = useMemo(
    () => (user && selectedBatchKey ? BATCH_DETAIL_QUERY_KEY(user.uid, selectedBatchKey) : null),
    [selectedBatchKey, user]
  );

  // Query #2: measurement detail for the currently selected batch.
  const measurementQuery = useQuery<MeasurementRecord[]>({
    queryKey: batchDetailQueryKey ?? ["batchDetail", "idle", "none"],
    enabled: Boolean(batchDetailQueryKey),
    retry: 5,
    retryDelay: 1_500,
    queryFn: async () => {
      if (!batchDetailQueryKey || !user || !selectedBatchKey) return [];
      const parsed = decodeBatchKey(selectedBatchKey);
      if (!parsed) return [];
      const detail = await fetchBatchDetail(parsed.deviceId, parsed.batchId);
      return pointsToMeasurementRecords(detail.points, detail.deviceId, detail.batchId);
    },
  });

  const rows = useMemo(
    () => measurementQuery.data ?? [],
    [measurementQuery.data]
  );

  const isLoadingBatch = measurementQuery.isFetching || measurementQuery.isLoading;

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
      setIndexOverride(null);
    });
  }, [selectedBatchKey]); // Remove rows.length from dependencies

  // // Reset override when data changes
  // useEffect(() => {
  //   setIndexOverride(null);
  // }, [selectedBatchKey, rows.length]);

  // Restore the last selection after sign-in so the map shows familiar data.
  useEffect(() => {
    if (!user) {
      deferStateUpdate(() => {
        setSelectedBatchKey("");
        setIndexOverride(0);
      });
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(userScopedSelectionKey);
      if (stored) {
        deferStateUpdate(() => { setSelectedBatchKey(stored); });
      }
    }
    catch (err) {
      console.warn(err);
    }
  }, [user, userScopedSelectionKey]);

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
    if (!selectedBatchKey) {
      deferStateUpdate(() => {
        setSelectedBatchKey(key);
      })
    }
  }, [getCachedBatch, queryClient, selectedBatchKey, user, userScopedCacheKey]);

  const handleBatchSelect = useCallback((value: string) => {
    setSelectedBatchKey(value);
    if (typeof window !== "undefined" && user) {
      try {
        if (value) window.localStorage.setItem(userScopedSelectionKey, value);
        else window.localStorage.removeItem(userScopedSelectionKey);
      }
      catch (err) {
        console.warn(err);
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
    const records = rawPoints.length ? pointsToMeasurementRecords(rawPoints as IngestSmokeTestPoint[], deviceForBatch, detail.batchId) : [];
    const summary: BatchSummary = {
      batchId: detail.batchId,
      deviceId: deviceForBatch,
      deviceName: null,
      count: rawPoints.length,
      processedAt: new Date().toISOString(),
      visibility: detail.visibility ?? "private",
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
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(userScopedSelectionKey, key);
        if (rawPoints.length) {
          window.localStorage.setItem(userScopedCacheKey, JSON.stringify({ summary, points: rawPoints }));
        }
        else {
          window.localStorage.removeItem(userScopedCacheKey);
        }
      }
      catch (err) {
        console.warn(err);
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
      if (typeof window !== "undefined") {
        try {
          window.localStorage.removeItem(userScopedSelectionKey);
          const cached = getCachedBatch();
          if (cached && cleared.has(cached.summary.deviceId)) {
            window.localStorage.removeItem(userScopedCacheKey);
          }
        }
        catch (err) {
          console.warn(err);
        }
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

  const data = useMemo(
    () => rows.map((r) => ({
      lat: r.lat,
      lon: r.lon,
      timestamp: normaliseTimestamp(r.timestamp),
      value: r.value,
      precision: r.precision ?? null,
      altitude: r.altitude ?? null,
    })),
    [rows]
  );

  const autoCenterKey = useMemo(() => {
    if (!rows.length) return "";
    const first = rows[0];
    const last = rows[rows.length - 1];
    return [selectedBatchKey, first?.id ?? "first", last?.id ?? "last", rows.length].join(":");
  }, [rows, selectedBatchKey]);

  const selectedPoint = rows[selectedIndex];
  const selectedMoment = selectedPoint ? new Date(normaliseTimestamp(selectedPoint.timestamp)) : null;

  return (
    <div style={{ padding: 12 }}>
      <h2>CrowdPM Map</h2>
      <select
        value={selectedBatchKey}
        onChange={(e) => handleBatchSelect(e.target.value)}
        disabled={!user}
      >
        <option value="">{user ? "Select batch" : "Sign in to select a batch"}</option>
        {visibleBatches.map((batch) => {
          const key = encodeBatchKey(batch.deviceId, batch.batchId);
          return <option key={key} value={key}>{formatBatchLabel(batch)}</option>;
        })}
      </select>
      {user && !visibleBatches.length ? (
        <p style={{ marginTop: 8, fontSize: 14 }}>No batches available yet. Run a smoke test from the dashboard to generate one.</p>
      ) : null}
      {rows.length ? (
        <div style={{ marginTop: 16 }}>
          <label htmlFor="measurement-slider">Measurement timeline</label>
          <input
            id="measurement-slider"
            type="range"
            min={0}
            max={rows.length - 1}
            step={1}
            value={selectedIndex}
            onChange={(e) => setIndexOverride(Number(e.target.value))}
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
        </div>
      ) : (
        <p style={{ marginTop: 16 }}>
          {selectedBatchKey
            ? (isLoadingBatch ? "Loading measurements for the selected batch..." : "No measurements available for this batch.")
            : "Select a batch with recent measurements to explore the timeline."}
        </p>
      )}
      <Map3D data={data} selectedIndex={selectedIndex} onSelectIndex={setIndexOverride} autoCenterKey={autoCenterKey}/>
    </div>
  );
}
