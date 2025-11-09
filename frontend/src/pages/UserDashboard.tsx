import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  cleanupIngestSmokeTest,
  listDevices,
  runIngestSmokeTest,
  type DeviceSummary,
  type IngestSmokeTestPayload,
  type IngestSmokeTestResponse,
} from "../lib/api";
import { useAuth } from "../providers/AuthProvider";

const PAYLOAD_STORAGE_KEY = "crowdpm:lastSmokePayload";
const HISTORY_STORAGE_KEY = "crowdpm:smokeHistory";
const LAST_DEVICE_STORAGE_KEY = "crowdpm:lastSmokeTestDevice";

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

function parseSmokeHistory(raw: string | null): SmokeHistoryItem[] {
  if (!raw) return [];
  try {
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
    console.warn("Unable to parse smoke test history", err);
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

export default function UserDashboard() {
  const { user } = useAuth();
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [smokeResult, setSmokeResult] = useState<IngestSmokeTestResponse | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);
  const [payloadError, setPayloadError] = useState<string | null>(null);
  const defaultPayloadString = useMemo(
    () => JSON.stringify(createDefaultSmokePayload(), null, 2),
    []
  );
  const scopedPayloadKey = useMemo(
    () => user?.uid ? `${PAYLOAD_STORAGE_KEY}:${user.uid}` : PAYLOAD_STORAGE_KEY,
    [user?.uid]
  );
  const scopedHistoryKey = useMemo(
    () => user?.uid ? `${HISTORY_STORAGE_KEY}:${user.uid}` : HISTORY_STORAGE_KEY,
    [user?.uid]
  );
  const scopedLastDeviceKey = useMemo(
    () => user?.uid ? `${LAST_DEVICE_STORAGE_KEY}:${user.uid}` : LAST_DEVICE_STORAGE_KEY,
    [user?.uid]
  );
  const [smokePayload, setSmokePayload] = useState<string>(defaultPayloadString);
  const [smokeHistory, setSmokeHistory] = useState<SmokeHistoryItem[]>([]);
  const historyRef = useRef<SmokeHistoryItem[]>([]);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const welcomeEmail = user?.email ?? "";
  const ownedDeviceIds = useMemo(() => {
    const ids = new Set(devices.map((device) => device.id));
    smokeHistory.forEach((entry) => entry.deviceIds.forEach((id) => ids.add(id)));
    uniqueDeviceIdsFromResult(smokeResult).forEach((id) => ids.add(id));
    return ids;
  }, [devices, smokeHistory, smokeResult]);

  const refreshDevices = useCallback(async () => {
    if (!user) {
      await Promise.resolve();
      setDevices([]);
      return;
    }
    try {
      const list = await listDevices();
      setDevices(list);
    }
    catch {
      setDevices([]);
    }
  }, [user]);

  useEffect(() => { refreshDevices(); }, [refreshDevices]);

  useEffect(() => {
    if (!user) {
      setSmokeResult(null);
      setSmokeError(null);
      setPayloadError(null);
    }
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setSmokePayload(defaultPayloadString);
      return;
    }
    if (!user) {
      setSmokePayload(defaultPayloadString);
      return;
    }
    try {
      const legacy = window.localStorage.getItem(PAYLOAD_STORAGE_KEY);
      if (legacy && !window.localStorage.getItem(scopedPayloadKey)) {
        window.localStorage.setItem(scopedPayloadKey, legacy);
      }
      window.localStorage.removeItem(PAYLOAD_STORAGE_KEY);
      const stored = window.localStorage.getItem(scopedPayloadKey);
      setSmokePayload(stored || defaultPayloadString);
    }
    catch (err) {
      console.warn("Unable to load smoke payload", err);
      setSmokePayload(defaultPayloadString);
    }
  }, [scopedPayloadKey, defaultPayloadString, user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setSmokeHistory([]);
      historyRef.current = [];
      return;
    }
    if (!user) {
      setSmokeHistory([]);
      historyRef.current = [];
      return;
    }
    try {
      const legacy = window.localStorage.getItem(HISTORY_STORAGE_KEY);
      if (legacy && !window.localStorage.getItem(scopedHistoryKey)) {
        window.localStorage.setItem(scopedHistoryKey, legacy);
      }
      window.localStorage.removeItem(HISTORY_STORAGE_KEY);
      const stored = window.localStorage.getItem(scopedHistoryKey);
      const parsed = parseSmokeHistory(stored);
      setSmokeHistory(parsed);
      historyRef.current = parsed;
    }
    catch (err) {
      console.warn("Unable to load smoke test history", err);
      setSmokeHistory([]);
      historyRef.current = [];
    }
  }, [scopedHistoryKey, user]);

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;
    try {
      window.localStorage.setItem(scopedPayloadKey, smokePayload);
    }
    catch (err) {
      console.warn("Unable to store smoke payload", err);
    }
  }, [smokePayload, scopedPayloadKey, user]);

  useEffect(() => {
    historyRef.current = smokeHistory;
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
    if (!user) {
      setSmokeError("Sign in is required to run smoke tests.");
      return;
    }
    setIsRunning(true);
    setSmokeError(null);
    setPayloadError(null);
    try {
      const payload = parsePayload(smokePayload);
      const result = await runIngestSmokeTest(payload);
      setSmokeResult(result);
      const historyEntry: SmokeHistoryItem = {
        id: `${result.deviceId}:${result.batchId}`,
        createdAt: Date.now(),
        deviceIds: uniqueDeviceIdsFromResult(result),
        response: result,
      };
      const updatedHistory = [
        historyEntry, ...historyRef.current.filter((item) => item.response.batchId !== result.batchId)
      ].slice(0, 10);
      setSmokeHistory(updatedHistory);
      if (typeof window !== "undefined" && user) {
        window.localStorage.setItem(scopedHistoryKey, JSON.stringify(updatedHistory));
        window.localStorage.setItem(scopedLastDeviceKey, result.deviceId);
      }
      // Notify MapPage
      window.dispatchEvent(new CustomEvent("ingest-smoke-test:completed", { detail: result }));
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "An error occurred";
      // Check if it's a parsing error vs API error
      if (err instanceof Error && err.message.includes("payload")) {
        setPayloadError(message);
      } else {
        setSmokeError(message);
        setSmokeResult(null);
      }
    } finally {
      setIsRunning(false);
    }
  }


  async function handleHistoryCleanup(entry: SmokeHistoryItem) {
    if (!user) {
      setSmokeError("Sign in is required to delete smoke data.");
      return;
    }
    if (!entry.deviceIds.length) return;
    const primary = entry.deviceIds[0];
    const targetIds = entry.deviceIds.filter((id) => ownedDeviceIds.has(id));
    if (!targetIds.length) {
      setSmokeError("No devices available to delete for this account.");
      return;
    }
    setDeletingDeviceId(primary);
    setSmokeError(null);
    try {
      const response = await cleanupIngestSmokeTest(targetIds);
      if (typeof window !== "undefined" && user) {
        const last = window.localStorage.getItem(scopedLastDeviceKey);
        if (last && entry.deviceIds.includes(last)) {
          window.localStorage.removeItem(scopedLastDeviceKey);
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

  async function handleBatchCleanup(entry: SmokeHistoryItem) {
    if (!user) {
      setSmokeError("Sign in is required to delete smoke data.");
      return;
    }
    const targetIds = entry.deviceIds.filter((id) => ownedDeviceIds.has(id));
    if (!targetIds.length) {
      setSmokeError("No devices available to delete for this account.");
      return;
    }
    setDeletingBatchId(entry.response.batchId);
    setSmokeError(null);
    try {
      const updatedHistory = historyRef.current.filter((item) => item.response.batchId !== entry.response.batchId);
      const devicesInRemainingEntries = new Set(updatedHistory.flatMap((item) => item.deviceIds));
      const devicesToDelete = targetIds.filter((id) => !devicesInRemainingEntries.has(id));
      if (devicesToDelete.length > 0) {
        const response = await cleanupIngestSmokeTest(devicesToDelete);
        window.dispatchEvent(new CustomEvent("ingest-smoke-test:cleared", { detail: response }));
      }
      setSmokeHistory(updatedHistory);
      if (typeof window !== "undefined" && user) {
        window.localStorage.setItem(scopedHistoryKey, JSON.stringify(updatedHistory));
      }
      if (smokeResult?.batchId === entry.response.batchId) {
        setSmokeResult(null);
      }
      refreshDevices();
    }
    catch (err) {
      setSmokeError(err instanceof Error ? err.message : "Cleanup failed");
    }
    finally {
      setDeletingBatchId(null);
    }
  }

  function loadHistoryPayload(entry: SmokeHistoryItem) {
    setSmokePayload(determinePayloadForEditor(entry.response));
    setPayloadError(null);
    setSmokeResult(entry.response);
  }

  return (
    <div style={{ padding: 12 }}>
      <h2 style={{ margin: "0 0 4px" }}>Welcome {welcomeEmail}</h2>
      <p style={{ margin: "0 0 16px", color: "#555", fontWeight: 500 }}>User Dashboard</p>
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>Status</th></tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id}>
              <td>{device.id}</td>
              <td>{device.name}</td>
              <td>{device.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section style={{ marginTop: 24 }}>
        <h3>Ingest Pipeline Smoke Test</h3>
        <p>Review or tweak the JSON payload below before sending it to the ingest endpoint. Update any device IDs or measurement details to fit the live demo scenario.</p>
        <textarea
          value={smokePayload}
          onChange={(event) => { setSmokePayload(event.target.value); setPayloadError(null); }}
          style={{ width: "100%", minHeight: 260, marginTop: 12, fontFamily: "monospace", fontSize: 13, borderRadius: 4, padding: 12, border: "1px solid #ccc" }}
        />
        {payloadError ? (
          <p style={{ color: "red", marginTop: 8 }}>{payloadError}</p>
        ) : null}
        <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
          <button onClick={handleSmokeTest} disabled={isRunning} style={{ padding: "8px 12px", cursor: isRunning ? "wait" : "pointer" }}>
            {isRunning ? "Sending..." : "Send Smoke Test"}
          </button>
          <button
            onClick={() => { setSmokePayload(defaultPayloadString); setPayloadError(null); }}
            style={{ padding: "8px 12px" }}
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
            <pre style={{ marginTop: 12, background: "#f8f8f8", padding: 12, borderRadius: 4 }}>
              {JSON.stringify(smokeResult.points ?? smokeResult.payload ?? {}, null, 2)}
            </pre>
            <p style={{ marginTop: 12, fontSize: 12, color: "#555" }}>
              Verify the Storage and Firestore data sources in your live project after running a smoke test. Check Cloud Functions logs for ingestWorker activity.
            </p>
          </div>
        ) : null}
      </section>
      <section style={{ marginTop: 24 }}>
        <h3>Recent Smoke Test Runs</h3>
        {smokeHistory.length === 0 ? (
          <p style={{ marginTop: 8 }}>No smoke tests have been submitted yet in this browser.</p>
        ) : (
          <>
            <div style={{ display: "flex", marginLeft: "auto" }}>
              <button
                // currently deleting all history data BUT, not updating active devices
                // So a device appears active when there's no history data.
                onClick={() => handleHistoryCleanup(smokeHistory[0])}
                disabled={deletingDeviceId === smokeHistory[0].deviceIds[0]}
                style={{ padding: "6px 10px", cursor: deletingDeviceId === smokeHistory[0].deviceIds[0] ? "wait" : "pointer" }}
              >
                {deletingDeviceId === smokeHistory[0].deviceIds[0] ? "Deleting..." : "Clear All"}
              </button>
            </div>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {smokeHistory.map((entry) => (
                <li key={entry.id} style={{ border: "1px solid #ddd", borderRadius: 4, padding: 12 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 12, color: "#666" }}>{new Date(entry.createdAt).toLocaleString()}</div>
                      <div>Batch: <code>{entry.response.batchId}</code></div>
                      <div>Device IDs: {entry.deviceIds.map((id) => <code key={id} style={{ marginRight: 6 }}>{id}</code>)}</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                      <button onClick={() => loadHistoryPayload(entry)} style={{ padding: "6px 10px" }}>
                        Load Payload
                      </button>
                      <button
                        onClick={() => handleBatchCleanup(entry)}
                        disabled={deletingBatchId === entry.response.batchId}
                        style={{ padding: "6px 10px", cursor: deletingBatchId === entry.response.batchId ? "wait" : "pointer" }}
                      >
                        {deletingBatchId === entry.response.batchId ? "Deleting..." : "Delete Data"}
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
