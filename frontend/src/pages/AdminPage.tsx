import { useEffect, useState } from "react";
import { cleanupIngestSmokeTest, listDevices, runIngestSmokeTest, type DeviceSummary, type IngestSmokeTestResponse } from "../lib/api";
export default function AdminPage() {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [smokeResult, setSmokeResult] = useState<IngestSmokeTestResponse | null>(null);
  const [smokeError, setSmokeError] = useState<string | null>(null);

  useEffect(()=>{ listDevices().then(setDevices).catch(()=>setDevices([])); },[]);

  async function handleSmokeTest() {
    setIsRunning(true);
    setSmokeError(null);
    try {
      const result = await runIngestSmokeTest();
      setSmokeResult(result);
      try {
        localStorage.setItem("crowdpm:lastSmokeTestDevice", result.deviceId);
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
      const lastDevice = smokeResult?.deviceId || smokeResult?.seededDeviceId || localStorage.getItem("crowdpm:lastSmokeTestDevice") || undefined;
      const response = await cleanupIngestSmokeTest(lastDevice);
      localStorage.removeItem("crowdpm:lastSmokeTestDevice");
      setSmokeResult(null);
      setSmokeError(null);
      window.dispatchEvent(new CustomEvent("ingest-smoke-test:cleared", { detail: response }));
      listDevices().then(setDevices).catch(()=>setDevices([]));
    }
    catch (err) {
      const message = err instanceof Error ? err.message : "Cleanup failed";
      setSmokeError(message);
    }
    finally {
      setIsCleaning(false);
    }
  }

  return (
    <div style={{ padding:12 }}>
      <h2>Admin</h2>
      <table><thead><tr><th>ID</th><th>Name</th><th>Status</th></tr></thead>
      <tbody>{devices.map(d=><tr key={d.id}><td>{d.id}</td><td>{d.name}</td><td>{d.status}</td></tr>)}</tbody></table>
      <section style={{ marginTop:24 }}>
        <h3>Ingest Pipeline Smoke Test</h3>
        <p>Ensure the Functions emulator is running with a valid `INGEST_HMAC_SECRET` in <code>functions/.env.local</code>.</p>
        <button onClick={handleSmokeTest} disabled={isRunning} style={{ padding:"8px 12px", cursor: isRunning ? "wait" : "pointer" }}>
          {isRunning ? "Running..." : "Run Smoke Test"}
        </button>
        <button
          onClick={handleCleanup}
          disabled={isCleaning}
          style={{ padding:"8px 12px", marginLeft:12, cursor: isCleaning ? "wait" : "pointer" }}
        >
          {isCleaning ? "Clearing..." : "Delete Smoke Test Data"}
        </button>
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
            <pre style={{ marginTop:12, background:"#f8f8f8", padding:12, borderRadius:4 }}>
              {JSON.stringify(smokeResult.points ?? smokeResult.payload ?? {}, null, 2)}
            </pre>
            <p style={{ marginTop: 12, fontSize: 12, color: "#555" }}>
              Verify the Storage and Firestore emulators for the batch and measure documents. Check the Functions emulator logs for ingestWorker activity.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
