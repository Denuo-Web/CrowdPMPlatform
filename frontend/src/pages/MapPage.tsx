import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map3D from "../components/Map3D";
import {
  fetchMeasurements,
  listDevices,
  type DeviceSummary,
  type MeasurementRecord,
  type IngestSmokeTestResponse,
} from "../lib/api";
import { useAuth } from "../providers/AuthProvider";

const LAST_DEVICE_KEY = "crowdpm:lastSmokeTestDevice";

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

export default function MapPage() {
  const { user } = useAuth();
  const userScopedDeviceKey = useMemo(() => scopedKey(LAST_DEVICE_KEY, user?.uid ?? undefined), [user?.uid]);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [devicesOwner, setDevicesOwner] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string>(() => {
    if (typeof window === "undefined" || !user) return "";
    try {
      const legacy = window.localStorage.getItem(LAST_DEVICE_KEY);
      if (legacy && !window.localStorage.getItem(userScopedDeviceKey)) {
        window.localStorage.setItem(userScopedDeviceKey, legacy);
      }
      window.localStorage.removeItem(LAST_DEVICE_KEY);
      return window.localStorage.getItem(userScopedDeviceKey) ?? "";
    }
    catch (err) {
      console.warn(err);
      return "";
    }
  });
  const [rows, setRows] = useState<MeasurementRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingSmoke, setPendingSmoke] = useState(false);
  const pendingSmokeRef = useRef(pendingSmoke);
  useEffect(() => { pendingSmokeRef.current = pendingSmoke; }, [pendingSmoke]);
  const effectiveDeviceId = user ? deviceId : "";
  const visibleDevices = user && devicesOwner === user.uid ? devices : [];

  const resetRows = useCallback(() => {
    setRows([]);
    setSelectedIndex(0);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!user) return;
    const targetUid = user.uid;
    try {
      const list = await listDevices();
      setDevices(list);
      setDevicesOwner(targetUid);
    }
    catch {
      setDevices([]);
      setDevicesOwner(targetUid);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const targetUid = user.uid;
    (async () => {
      try {
        const list = await listDevices();
        if (!cancelled) {
          setDevices(list);
          setDevicesOwner(targetUid);
        }
      }
      catch {
        if (!cancelled) {
          setDevices([]);
          setDevicesOwner(targetUid);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const applyRecords = useCallback((records: MeasurementRecord[]) => {
    if (records.length) {
      setPendingSmoke(false);
      setRows(records);
      setSelectedIndex(records.length - 1);
      return true;
    }
    if (!pendingSmokeRef.current) {
      resetRows();
    }
    return false;
  }, [resetRows]);

  const loadMeasurements = useCallback(async () => {
    if (!effectiveDeviceId) return [];
    const now = new Date();
    const t1 = now.toISOString();
    const windowSizes = pendingSmokeRef.current ? [1] : [1, 6, 24];
    for (const hours of windowSizes) {
      const t0 = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
      const records = await fetchMeasurements({ device_id: effectiveDeviceId, pollutant: "pm25", t0, t1, limit: 2000 });
      if (records.length) return records;
    }
    return [];
  }, [effectiveDeviceId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const records = await loadMeasurements();
        if (!cancelled) applyRecords(records);
      }
      catch (err) {
        if (cancelled) return;
        console.warn("Failed to load measurements", err);
        if (!pendingSmokeRef.current) {
          resetRows();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [loadMeasurements, applyRecords, resetRows]);

  useEffect(() => {
    if (!pendingSmoke || !effectiveDeviceId) return;
    let cancelled = false;
    let attempt = 0;
    let timer: number | null = null;
    const poll = async () => {
      if (cancelled) return;
      attempt += 1;
      let fulfilled = false;
      try {
        const records = await loadMeasurements();
        if (cancelled) return;
        fulfilled = applyRecords(records);
      }
      catch (err) {
        if (!cancelled) {
          console.warn("Failed to load measurements", err);
          if (!pendingSmokeRef.current) {
            resetRows();
          }
        }
      }
      if (cancelled || fulfilled || attempt >= 6) return;
      timer = window.setTimeout(poll, 4000);
    };
    timer = window.setTimeout(poll, 4000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pendingSmoke, effectiveDeviceId, loadMeasurements, applyRecords, resetRows]);

  useEffect(() => {
    const handler = (event: Event) => {
      if (!user) return;
      const detail = (event as CustomEvent<IngestSmokeTestResponse>).detail;
      if (!detail) return;
      const newDevice = detail.deviceId || detail.seededDeviceId;
      if (newDevice) {
        setDeviceId(newDevice);
        setPendingSmoke(Boolean(detail.points?.length));
        try {
          if (typeof window !== "undefined") {
            window.localStorage.setItem(userScopedDeviceKey, newDevice);
          }
        } catch (err) { console.warn(err); }
        if (detail.points?.length) {
          const provisionalRows: MeasurementRecord[] = detail.points.map((point, idx) => ({
            id: `smoke-${detail.batchId}-${idx}`,
            deviceId: newDevice,
            pollutant: point.pollutant as "pm25",
            value: point.value,
            unit: point.unit ?? "ug/m3",
            lat: point.lat ?? 0,
            lon: point.lon ?? 0,
            altitude: point.altitude ?? null,
            precision: point.precision ?? null,
            timestamp: point.timestamp,
            flags: point.flags ?? 0
          }));
          setRows(provisionalRows);
          setSelectedIndex(provisionalRows.length ? provisionalRows.length - 1 : 0);
        }
        refreshDevices();
      }
    };
    window.addEventListener("ingest-smoke-test:completed", handler);
    const cleanupHandler = () => {
      if (!user) return;
      setPendingSmoke(false);
      resetRows();
      setDeviceId("");
      try {
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(userScopedDeviceKey);
        }
      } catch (err) { console.warn(err); }
    };
    window.addEventListener("ingest-smoke-test:cleared", cleanupHandler);
    return () => {
      window.removeEventListener("ingest-smoke-test:completed", handler);
      window.removeEventListener("ingest-smoke-test:cleared", cleanupHandler);
    };
  }, [refreshDevices, resetRows, user, userScopedDeviceKey]);

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

  const selectedPoint = rows[selectedIndex];
  const selectedMoment = selectedPoint ? new Date(normaliseTimestamp(selectedPoint.timestamp)) : null;
  function handleDeviceSelect(value: string) {
    setPendingSmoke(false);
    resetRows();
    setDeviceId(value);
    try {
      if (typeof window !== "undefined" && user) {
        if (value) window.localStorage.setItem(userScopedDeviceKey, value);
        else window.localStorage.removeItem(userScopedDeviceKey);
      }
    }
    catch (err) {
      console.warn(err);
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <h2>CrowdPM Map</h2>
      <select value={effectiveDeviceId} onChange={(e) => handleDeviceSelect(e.target.value)}>
        <option value="">Select device</option>
        {visibleDevices.map((d) => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}
      </select>
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
        <p style={{ marginTop: 16 }}>Select a device with recent measurements to explore the timeline.</p>
      )}
      <Map3D data={data} selectedIndex={selectedIndex} onSelectIndex={setSelectedIndex}/>
    </div>
  );
}
