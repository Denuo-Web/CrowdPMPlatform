import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Map3D from "../components/Map3D";
import {
  fetchMeasurements,
  listDevices,
  type DeviceSummary,
  type MeasurementRecord,
  type IngestSmokeTestResponse,
} from "../lib/api";

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
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [deviceId, setDeviceId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try {
      return window.localStorage.getItem("crowdpm:lastSmokeTestDevice") ?? "";
    } catch (err) {
      console.warn(err);
      return "";
    }
  });
  const [rows, setRows] = useState<MeasurementRecord[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pendingSmoke, setPendingSmoke] = useState(false);
  const pendingSmokeRef = useRef(pendingSmoke);
  useEffect(() => { pendingSmokeRef.current = pendingSmoke; }, [pendingSmoke]);

  useEffect(() => { listDevices().then(setDevices).catch(() => setDevices([])); }, []);

  const loadMeasurements = useCallback(async () => {
    if (!deviceId) return false;
    const now = new Date();
    const t1 = now.toISOString();
    const windowSizes = pendingSmokeRef.current ? [1] : [1, 6, 24];
    for (const hours of windowSizes) {
      const t0 = new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
      try {
        const records = await fetchMeasurements({ device_id: deviceId, pollutant: "pm25", t0, t1, limit: 2000 });
        if (records.length) {
          setPendingSmoke(false);
          setRows(records);
          setSelectedIndex(records.length - 1);
          return true;
        }
      }
      catch (err) {
        console.warn("Failed to load measurements", err);
        if (hours === windowSizes[windowSizes.length - 1] && !pendingSmokeRef.current) {
          setRows([]);
          setSelectedIndex(0);
        }
        return false;
      }
    }
    if (!pendingSmokeRef.current) {
      setRows([]);
      setSelectedIndex(0);
    }
    return false;
  }, [deviceId]);

  useEffect(() => { loadMeasurements(); }, [loadMeasurements]);

  useEffect(() => {
    if (!pendingSmoke || !deviceId) return;
    let cancelled = false;
    let attempt = 0;
    let timer: number | null = null;
    const poll = async () => {
      if (cancelled) return;
      attempt += 1;
      const fulfilled = await loadMeasurements();
      if (cancelled || fulfilled || attempt >= 6) return;
      timer = window.setTimeout(poll, 4000);
    };
    timer = window.setTimeout(poll, 4000);
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pendingSmoke, deviceId, loadMeasurements]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<IngestSmokeTestResponse>).detail;
      if (!detail) return;
      const newDevice = detail.deviceId || detail.seededDeviceId;
      if (newDevice) {
        setDeviceId(newDevice);
        setPendingSmoke(Boolean(detail.points?.length));
        try { localStorage.setItem("crowdpm:lastSmokeTestDevice", newDevice); } catch (err) { console.warn(err); }
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
        listDevices().then(setDevices).catch(() => setDevices([]));
      }
    };
    window.addEventListener("ingest-smoke-test:completed", handler);
    const cleanupHandler = () => {
      setPendingSmoke(false);
      setRows([]);
      setSelectedIndex(0);
      setDeviceId("");
      try { localStorage.removeItem("crowdpm:lastSmokeTestDevice"); } catch (err) { console.warn(err); }
    };
    window.addEventListener("ingest-smoke-test:cleared", cleanupHandler);
    return () => {
      window.removeEventListener("ingest-smoke-test:completed", handler);
      window.removeEventListener("ingest-smoke-test:cleared", cleanupHandler);
    };
  }, []);

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
    setRows([]);
    setSelectedIndex(0);
    setDeviceId(value);
    try {
      if (value) window.localStorage.setItem("crowdpm:lastSmokeTestDevice", value);
      else window.localStorage.removeItem("crowdpm:lastSmokeTestDevice");
    }
    catch (err) {
      console.warn(err);
    }
  }

  return (
    <div style={{ padding: 12 }}>
      <h2>CrowdPM Map</h2>
      <select value={deviceId} onChange={(e) => handleDeviceSelect(e.target.value)}>
        <option value="">Select device</option>
        {devices.map((d) => <option key={d.id} value={d.id}>{d.name || d.id}</option>)}
      </select>
      <Map3D data={data} selectedIndex={selectedIndex} onSelectIndex={setSelectedIndex}/>
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
            <div style={{ marginTop: 12, background: "#f4f4f4", padding: 12, borderRadius: 4 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>
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
    </div>
  );
}
