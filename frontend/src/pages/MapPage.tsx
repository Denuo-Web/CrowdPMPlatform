import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const LEGACY_LAST_DEVICE_KEY = "crowdpm:lastSmokeTestDevice";
const LAST_SELECTION_KEY = "crowdpm:lastSmokeSelection";
const LAST_SMOKE_CACHE_KEY = "crowdpm:lastSmokeBatchCache";

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
  const userScopedSelectionKey = useMemo(() => scopedKey(LAST_SELECTION_KEY, user?.uid ?? undefined), [user?.uid]);
  const userScopedLegacyKey = useMemo(() => scopedKey(LEGACY_LAST_DEVICE_KEY, user?.uid ?? undefined), [user?.uid]);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [isLoadingBatch, setIsLoadingBatch] = useState(false);
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
  const [rows, setRows] = useState<MeasurementRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const batchCacheRef = useRef(new Map<string, MeasurementRecord[]>());
  const pendingSelectionRef = useRef<{ key: string | null; attempts: number }>({ key: null, attempts: 0 });
  const cacheHydratedRef = useRef<string | null>(null);
  const userScopedCacheKey = useMemo(() => scopedKey(LAST_SMOKE_CACHE_KEY, user?.uid ?? undefined), [user?.uid]);
  const getCachedBatch = useCallback(() => {
    if (typeof window === "undefined") return null;
    return parseStoredSmokeBatch(window.localStorage.getItem(userScopedCacheKey));
  }, [userScopedCacheKey]);

  const visibleBatches = useMemo(
    () => (user ? batches : []),
    [batches, user]
  );

  const summaryForSelection = useMemo(() => {
    if (!selectedBatchKey) return null;
    const parsed = decodeBatchKey(selectedBatchKey);
    if (!parsed) return null;
    return visibleBatches.find((batch) => batch.deviceId === parsed.deviceId && batch.batchId === parsed.batchId) ?? null;
  }, [selectedBatchKey, visibleBatches]);

  const resetRows = useCallback(() => {
    setRows([]);
    setSelectedIndex(0);
  }, []);

  const refreshBatches = useCallback(async () => {
    if (!user) return;
    const mergeWithCached = (list: BatchSummary[]) => mergeCachedSummary(list, getCachedBatch());
    try {
      const list = await listBatches();
      setBatches(mergeWithCached(list));
    }
    catch {
      setBatches(mergeWithCached([]));
    }
  }, [getCachedBatch, user]);

  useEffect(() => {
    if (!user) {
      deferStateUpdate(() => {
        setSelectedBatchKey("");
        batchCacheRef.current.clear();
        resetRows();
        setBatches([]);
      });
      return;
    }
    deferStateUpdate(() => { void refreshBatches(); });
  }, [refreshBatches, resetRows, user]);

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
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

  const applyRecords = useCallback((records: MeasurementRecord[]) => {
    if (records.length) {
      setRows(records);
      setSelectedIndex(records.length - 1);
      setIsLoadingBatch(false);
      return true;
    }
    resetRows();
    setIsLoadingBatch(false);
    return false;
  }, [resetRows]);

  const hydrateCachedBatch = useCallback(() => {
    if (typeof window === "undefined" || !user) return;
    if (cacheHydratedRef.current === userScopedCacheKey) return;
    const cached = getCachedBatch();
    if (!cached) return;
    cacheHydratedRef.current = userScopedCacheKey;
    const key = encodeBatchKey(cached.summary.deviceId, cached.summary.batchId);
    const records = pointsToMeasurementRecords(cached.points, cached.summary.deviceId, cached.summary.batchId);
    batchCacheRef.current.set(key, records);
    setBatches((prev) => {
      const filtered = prev.filter((batch) => encodeBatchKey(batch.deviceId, batch.batchId) !== key);
      return [cached.summary, ...filtered];
    });
    if (!selectedBatchKey) {
      setSelectedBatchKey(key);
      applyRecords(records);
    }
    else if (selectedBatchKey === key) {
      applyRecords(records);
    }
  }, [applyRecords, getCachedBatch, selectedBatchKey, setBatches, setSelectedBatchKey, user, userScopedCacheKey]);

  useEffect(() => {
    deferStateUpdate(() => { hydrateCachedBatch(); });
  }, [hydrateCachedBatch]);

  const loadBatchRecords = useCallback(async (key: string) => {
    if (!key) return [];
    const cached = batchCacheRef.current.get(key);
    if (cached) return cached;
    const parsed = decodeBatchKey(key);
    if (!parsed) return [];
    const detail = await fetchBatchDetail(parsed.deviceId, parsed.batchId);
    const records = pointsToMeasurementRecords(detail.points, detail.deviceId, detail.batchId);
    batchCacheRef.current.set(key, records);
    return records;
  }, []);

  useEffect(() => {
    if (!user || !selectedBatchKey) {
      if (!selectedBatchKey) deferStateUpdate(resetRows);
      deferStateUpdate(() => { setIsLoadingBatch(false); });
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const expectsData = Boolean(summaryForSelection && summaryForSelection.count > 0);
    deferStateUpdate(() => { setIsLoadingBatch(true); });

    const attemptLoad = async (attempt: number) => {
      try {
        const records = await loadBatchRecords(selectedBatchKey);
        if (cancelled) return;
        if (!records.length && expectsData && attempt < 5) {
          retryTimer = setTimeout(() => { attemptLoad(attempt + 1); }, 1_500);
          return;
        }
        applyRecords(records);
      }
      catch (err) {
        if (!cancelled) {
          console.warn("Failed to load batch measurements", err);
          deferStateUpdate(() => { setIsLoadingBatch(false); });
        }
      }
    };

    attemptLoad(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [applyRecords, loadBatchRecords, resetRows, selectedBatchKey, summaryForSelection, user]);

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
    if (!value) {
      resetRows();
    }
  }, [resetRows, user, userScopedSelectionKey]);

  const processSmokeResult = useCallback((detail: IngestSmokeTestResponse) => {
    if (!user || !detail?.batchId) return;
    const deviceForBatch = detail.deviceId || detail.seededDeviceId;
    if (!deviceForBatch) return;
    const key = encodeBatchKey(deviceForBatch, detail.batchId);
    const rawPoints = detail.points?.length ? detail.points : detail.payload?.points ?? [];
    if (rawPoints.length) {
      const provisional = pointsToMeasurementRecords(rawPoints as IngestSmokeTestPoint[], deviceForBatch, detail.batchId);
      batchCacheRef.current.set(key, provisional);
      setRows(provisional);
      setSelectedIndex(provisional.length - 1);
    }
    else {
      batchCacheRef.current.delete(key);
      resetRows();
    }
    const summary: BatchSummary = {
      batchId: detail.batchId,
      deviceId: deviceForBatch,
      deviceName: null,
      count: rawPoints.length,
      processedAt: new Date().toISOString(),
      visibility: detail.visibility ?? "private",
    };
    setBatches((prev) => {
      const filtered = prev.filter((batch) => !(batch.batchId === summary.batchId && batch.deviceId === summary.deviceId));
      return [summary, ...filtered];
    });
    setSelectedBatchKey(key);
    pendingSelectionRef.current = { key, attempts: 0 };
    setIsLoadingBatch(false);
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
    refreshBatches();
  }, [refreshBatches, resetRows, user, userScopedCacheKey, userScopedSelectionKey]);

  const processCleanupDetail = useCallback((detail: IngestSmokeTestCleanupResponse) => {
    if (!user) return;
    const cleared = buildClearedSet(detail);
    if (!cleared.size) return;
    for (const key of Array.from(batchCacheRef.current.keys())) {
      const parsed = decodeBatchKey(key);
      if (parsed && cleared.has(parsed.deviceId)) {
        batchCacheRef.current.delete(key);
      }
    }
    const current = decodeBatchKey(selectedBatchKey);
    if (current && cleared.has(current.deviceId)) {
      setSelectedBatchKey("");
      resetRows();
      setIsLoadingBatch(false);
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
    refreshBatches();
  }, [getCachedBatch, refreshBatches, resetRows, selectedBatchKey, user, userScopedCacheKey, userScopedSelectionKey]);

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

  useEffect(() => {
    if (!user || !selectedBatchKey) {
      pendingSelectionRef.current = { key: null, attempts: 0 };
      deferStateUpdate(() => { setIsLoadingBatch(false); });
      return;
    }
    if (pendingSelectionRef.current.key !== selectedBatchKey) {
      pendingSelectionRef.current = { key: selectedBatchKey, attempts: 0 };
    }
    const hasSelection = visibleBatches.some(
      (batch) => encodeBatchKey(batch.deviceId, batch.batchId) === selectedBatchKey
    );
    if (hasSelection) {
      pendingSelectionRef.current.attempts = 0;
      return;
    }
    if (pendingSelectionRef.current.attempts >= 5) return;
    const timer = setTimeout(() => {
      pendingSelectionRef.current.attempts += 1;
      refreshBatches();
    }, 1_500);
    return () => clearTimeout(timer);
  }, [refreshBatches, selectedBatchKey, user, visibleBatches]);

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
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
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
      <Map3D data={data} selectedIndex={selectedIndex} onSelectIndex={setSelectedIndex} autoCenterKey={autoCenterKey}/>
    </div>
  );
}
