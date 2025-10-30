import { useCallback, useEffect, useState } from "react";
import {
  cleanupIngestSmokeTest,
  listDevices,
  runIngestSmokeTest,
  type DeviceSummary,
  type IngestSmokeTestPayload,
  type IngestSmokeTestResponse,
} from "../lib/api";

const PAYLOAD_STORAGE_KEY = "crowdpm:lastSmokePayload";
const HISTORY_STORAGE_KEY = "crowdpm:smokeHistory";

type SmokeHistoryItem = {
  id: string;
  createdAt: number;
  deviceIds: string[];
  response: IngestSmokeTestResponse;
};

function createDefaultSmokePayload(deviceId = "device-123"): IngestSmokeTestPayload {
  const baseLat = 40.7128;
  const baseLon = -74.0060;
  const now = Date.now();
  const points = Array.from({ length: 60 }, (_, idx) => {
    const secondsAgo = 59 - idx;
    const ts = new Date(now - secondsAgo * 1000);
    const progress = idx / 59;
    const latOffset = Math.sin(progress * Math.PI * 2) * 0.0002;
    const lonOffset = Math.cos(progress * Math.PI * 2) * 0.0002;
    const altitude = 25 + Math.sin(progress * Math.PI * 6) * 5 + Math.random() * 2;
    const baseValue = 15 + Math.sin(progress * Math.PI * 4) * 10 + Math.random();
    const precision = 5 + Math.round(Math.abs(Math.cos(progress * Math.PI * 2)) * 20);
    return {
      device_id: deviceId,
      pollutant: "pm25",
      value: Math.round(baseValue * 10) / 10,
      unit: "\u00b5g/m\u00b3",
      lat: Number((baseLat + latOffset).toFixed(6)),
      lon: Number((baseLon + lonOffset).toFixed(6)),
      timestamp: ts.toISOString(),
      precision,
      altitude: Number(altitude.toFixed(1)),
    };
  });
  return { points };
}

function restoreSmokeHistory(): SmokeHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const candidate = item as Partial<SmokeHistoryItem>;
        if (!candidate.response || typeof candidate.id !== "string" || typeof candidate.createdAt !== "number") return null;
        const initialIds = Array.isArray(candidate.deviceIds) && candidate.deviceIds.length
          ? candidate.deviceIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          : [];
        const fallback = candidate.response.seededDeviceIds?.length
          ? candidate.response.seededDeviceIds
          : [candidate.response.deviceId, candidate.response.seededDeviceId];
        const deviceIds = Array.from(new Set([...initialIds, ...fallback.filter((id): id is string => typeof id === "string" && id.trim().length > 0)]));
        return {
          id: candidate.id,
          createdAt: candidate.createdAt,
          deviceIds,
          response: candidate.response,
        } as SmokeHistoryItem;
      })
      .filter((item): item is SmokeHistoryItem => Boolean(item));
  }
  catch (err) {
    console.warn("Unable to restore smoke test history", err);
    return [];
  }
}

function determinePayloadForEditor(result: IngestSmokeTestResponse | null): string {
  if (!result) return JSON.stringify(createDefaultSmokePayload(), null, 2);
  const payload = result.payload?.points?.length
    ? result.payload
    : { points: result.points ?? [] };
  return JSON.stringify(payload, null, 2);
}

function uniqueDeviceIdsFromResult(result: IngestSmokeTestResponse | null): string[] {
  if (!result) return [];
  const ids = result.seededDeviceIds?.length
    ? result.seededDeviceIds
    : [result.deviceId, result.seededDeviceId];
  return Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0)));
}

export default function AdminPage() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [smokeResult, setSmokeResult] = useState<IngestSmokeTestResponse | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const defaultPayloadString = JSON.stringify(createDefaultSmokePayload(), null, 2);
  const [smokePayload, setSmokePayload] = useState<string>(() => {
    if (typeof window === "undefined") return defaultPayloadString;
    try {
      return window.localStorage.getItem(PAYLOAD_STORAGE_KEY) || defaultPayloadString;
    }
    catch {
      return defaultPayloadString;
    }
  });
  const [smokeHistory, setSmokeHistory] = useState<SmokeHistoryItem[]>(restoreSmokeHistory);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await listDevices();
      setDevices(list);
    }
    catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => { refreshDevices(); }, [refreshDevices]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PAYLOAD_STORAGE_KEY, smokePayload);
    }
    catch (err) {
      console.warn("Unable to store smoke payload", err);
    }
  }, [smokePayload]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(smokeHistory));
    }
    catch (err) {
      console.warn("Unable to store smoke history", err);
    }
  }, [smokeHistory]);

  function parsePayload(raw: string): IngestSmokeTestPayload {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    }
    catch (err) {
      throw new Error(err instanceof Error ? err.message : "Invalid JSON payload");
    }
    if (!parsed || typeof parsed !== "object") throw new Error("Payload must be a JSON object with a points array");
    const points = (parsed as { points?: unknown }).points;
    if (!Array.isArray(points) || points.length === 0) throw new Error("Payload must include at least one point in a points array");
    return { points } as IngestSmokeTestPayload;
  }

  async function handleSmokeTest() {
    setIsRunning(true);
    setSmokeError(null);
    setPayloadError(null);
    let payload: IngestSmokeTestPayload;
    try {
      payload = parsePayload(smokePayload);
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Invalid payload";
      setPayloadError(message);
      setIsRunning(false);
      return;
    }
    try {
      const result = await runIngestSmokeTest(payload);
      setSmokeResult(result);
      const deviceIds = uniqueDeviceIdsFromResult(result);
      const historyEntry: SmokeHistoryItem = {
        id: `${result.deviceId}:${result.batchId}`,
        createdAt: Date.now(),
        deviceIds,
        response: result,
      };
      setSmokeHistory((prev) => {
        const next = [historyEntry, ...prev.filter((item) => item.response.batchId !== result.batchId)];
        return next.slice(0, 10); // keep most recent entries manageable
      });
      try {
        window.localStorage.setItem("crowdpm:lastSmokeTestDevice", result.deviceId);
        window.dispatchEvent(new CustomEvent("ingest-smoke-test:completed", { detail: result }));
      }
      catch (storageErr) {
        console.warn("Unable to persist smoke test details", storageErr);
      }
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Smoke test failed";
      setSmokeError(message);
      setSmokeResult(null);
    }
    finally {
      setIsRunning(false);
    }
  }

  async function handleCleanup() {
    setIsCleaning(true);
    try {
      const ids = new Set<string>();
      uniqueDeviceIdsFromResult(smokeResult).forEach((id) => ids.add(id));
      smokeHistory.forEach((entry) => entry.deviceIds.forEach((id) => ids.add(id)));
      if (typeof window !== "undefined") {
        const last = window.localStorage.getItem("crowdpm:lastSmokeTestDevice");
        if (last) ids.add(last);
      }
      const targetIds = ids.size ? Array.from(ids) : undefined;
      const response = await cleanupIngestSmokeTest(targetIds);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("crowdpm:lastSmokeTestDevice");
      }
      setSmokeResult(null);
      setSmokeError(null);
      window.dispatchEvent(new CustomEvent("ingest-smoke-test:cleared", { detail: response }));
      if (response.clearedDeviceIds?.length) {
        setSmokeHistory((prev) => prev.filter((entry) => !entry.deviceIds.some((id) => response.clearedDeviceIds?.includes(id))));
      } else {
        setSmokeHistory([]);
      }
      refreshDevices();
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Cleanup failed";
      setSmokeError(message);
    }
    finally {
      setIsCleaning(false);
    }
  }

  async function handleHistoryCleanup(entry: SmokeHistoryItem) {
    if (!entry.deviceIds.length) return;
    const primary = entry.deviceIds[0];
    setDeletingDeviceId(primary);
    setSmokeError(null);
    try {
      const response = await cleanupIngestSmokeTest(entry.deviceIds);
      if (typeof window !== "undefined") {
        const last = window.localStorage.getItem("crowdpm:lastSmokeTestDevice");
        if (last && entry.deviceIds.includes(last)) {
          window.localStorage.removeItem("crowdpm:lastSmokeTestDevice");
        }
      }
      window.dispatchEvent(new CustomEvent("ingest-smoke-test:cleared", { detail: response }));
      const clearedIds = response.clearedDeviceIds?.length ? new Set(response.clearedDeviceIds) : new Set(entry.deviceIds);
      setSmokeHistory((prev) => prev.filter((item) => !item.deviceIds.some((id) => clearedIds.has(id))));
      if (smokeResult && uniqueDeviceIdsFromResult(smokeResult).some((id) => clearedIds.has(id))) {
        setSmokeResult(null);
      }
      refreshDevices();
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Cleanup failed";
      setSmokeError(message);
    }
    finally {
      setDeletingDeviceId(null);
    }
  }

  function loadHistoryPayload(entry: SmokeHistoryItem) {
    setSmokePayload(determinePayloadForEditor(entry.response));
    setPayloadError(null);
    setSmokeResult(entry.response);
  }

  return (
    <div style={{ padding:12 }}>
      <h2>Admin</h2>
      <table><thead><tr><th>ID</th><th>Name</th><th>Status</th></tr></thead>
      <tbody>{devices.map(d=><tr key={d.id}><td>{d.id}</td><td>{d.name}</td><td>{d.status}</td></tr>)}</tbody></table>
      <section style={{ marginTop:24 }}>
        <h3>Ingest Pipeline Smoke Test</h3>
        <p>Review or tweak the JSON payload below before sending it to the ingest endpoint. Update any device IDs or measurement details to fit the live demo scenario.</p>
        <textarea
          value={smokePayload}
          onChange={(event)=>{ setSmokePayload(event.target.value); setPayloadError(null); }}
          style={{ width:"100%", minHeight:260, marginTop:12, fontFamily:"monospace", fontSize:13, borderRadius:4, padding:12, border:"1px solid #ccc" }}
        />
        {payloadError ? (
          <p style={{ color:"red", marginTop: 8 }}>{payloadError}</p>
        ) : null}
        <div style={{ marginTop:12, display:"flex", gap:12 }}>
          <button onClick={handleSmokeTest} disabled={isRunning} style={{ padding:"8px 12px", cursor: isRunning ? "wait" : "pointer" }}>
            {isRunning ? "Sending..." : "Send Smoke Test"}
          </button>
          <button
            onClick={handleCleanup}
            disabled={isCleaning}
            style={{ padding:"8px 12px", cursor: isCleaning ? "wait" : "pointer" }}
          >
            {isCleaning ? "Clearing..." : "Delete Selected Smoke Data"}
          </button>
          <button
            onClick={()=>{ setSmokePayload(defaultPayloadString); setPayloadError(null); }}
            style={{ padding:"8px 12px" }}
          >
            Reset to Default Payload
          </button>
        </div>
        {smokeError ? (
          <p style={{ color: "red", marginTop: 12 }}>{smokeError}</p>
        ) : null}
        {smokeResult ? (
          <div style={{ marginTop: 12, border: "1px solid #ccc", padding: 12, borderRadius: 4 }}>
            <p style={{ margin: 0 }}>Batch ID: <code>{smokeResult.batchId}</code></p>
            <p style={{ margin: "4px 0 0" }}>Storage Path: <code>{smokeResult.storagePath}</code></p>
            <p style={{ margin: "4px 0 0" }}>
              Inserted Points: <strong>{smokeResult.points?.length ?? smokeResult.payload?.points?.length ?? 0}</strong>
            </p>
            <button
              onClick={() => setSmokePayload(determinePayloadForEditor(smokeResult))}
              style={{ marginTop: 8, padding: "6px 10px" }}
            >
              Load Payload Into Editor
            </button>
            <pre style={{ marginTop:12, background:"#f8f8f8", padding:12, borderRadius:4 }}>
              {JSON.stringify(smokeResult.points ?? smokeResult.payload ?? {}, null, 2)}
            </pre>
            <p style={{ marginTop: 12, fontSize: 12, color: "#555" }}>
              Verify the Storage and Firestore data sources in your live project after running a smoke test. Check Cloud Functions logs for ingestWorker activity.
            </p>
          </div>
        ) : null}
      </section>
      <section style={{ marginTop:24 }}>
        <h3>Recent Smoke Test Runs</h3>
        {smokeHistory.length === 0 ? (
          <p style={{ marginTop: 8 }}>No smoke tests have been submitted yet in this browser.</p>
        ) : (
          <ul style={{ listStyle:"none", padding:0, margin:0, display:"flex", flexDirection:"column", gap:12 }}>
            {smokeHistory.map((entry) => (
              <li key={entry.id} style={{ border:"1px solid #ddd", borderRadius:4, padding:12 }}>
                <div style={{ display:"flex", flexWrap:"wrap", gap:12, alignItems:"center" }}>
                  <div>
                    <div style={{ fontSize:12, color:"#666" }}>{new Date(entry.createdAt).toLocaleString()}</div>
                    <div>Batch: <code>{entry.response.batchId}</code></div>
                    <div>Device IDs: {entry.deviceIds.map((id) => <code key={id} style={{ marginRight:6 }}>{id}</code>)}</div>
                  </div>
                  <div style={{ display:"flex", gap:8, marginLeft:"auto" }}>
                    <button onClick={() => loadHistoryPayload(entry)} style={{ padding:"6px 10px" }}>
                      Load Payload
                    </button>
                    <button
                      onClick={() => handleHistoryCleanup(entry)}
                      disabled={deletingDeviceId === entry.deviceIds[0]}
                      style={{ padding:"6px 10px", cursor: deletingDeviceId === entry.deviceIds[0] ? "wait" : "pointer" }}
                    >
                      {deletingDeviceId === entry.deviceIds[0] ? "Deleting..." : "Delete Data"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
