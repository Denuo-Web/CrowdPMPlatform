import { useEffect, useMemo, useState } from "react";
import Map3D from "../components/Map3D";
import { fetchMeasurements, listDevices, type DeviceSummary, type MeasurementRecord } from "../lib/api";

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
  const [deviceId, setDeviceId] = useState<string>("");
  const [rows, setRows] = useState<MeasurementRecord[]>([]);

  useEffect(()=>{ listDevices().then(setDevices).catch(()=>setDevices([])); },[]);
  useEffect(()=>{
    if (!deviceId) return;
    const now = new Date();
    const t1 = now.toISOString();
    const t0 = new Date(now.getTime() - 60*60*1000).toISOString();
    fetchMeasurements({ device_id: deviceId, pollutant:"pm25", t0, t1, limit: 2000 }).then(setRows).catch(()=>setRows([]));
  }, [deviceId]);

  const data = useMemo(
    () => rows.map((r) => ({
      lat: r.lat,
      lon: r.lon,
      timestamp: normaliseTimestamp(r.timestamp),
      value: r.value,
    })),
    [rows]
  );

  return (
    <div style={{ padding: 12 }}>
      <h2>CrowdPM Map</h2>
      <select value={deviceId} onChange={e=>setDeviceId(e.target.value)}>
        <option value="">Select device</option>
        {devices.map(d=><option key={d.id} value={d.id}>{d.name || d.id}</option>)}
      </select>
      <Map3D data={data}/>
    </div>
  );
}
