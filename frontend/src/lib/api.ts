const BASE = import.meta.env.VITE_API_BASE;

export type DeviceSummary = {
  id: string;
  name?: string | null;
  status?: string | null;
  ownerUserId?: string | null;
  createdAt?: string | null;
};

export type FirestoreTimestampLike = {
  toDate(): Date;
  toMillis(): number;
};

export type MeasurementRecord = {
  id: string;
  deviceId: string;
  pollutant: "pm25";
  value: number;
  unit?: string | null;
  lat: number;
  lon: number;
  altitude?: number | null;
  precision?: number | null;
  timestamp: string | number | Date | FirestoreTimestampLike;
  flags?: number;
};

export type IngestSmokeTestPoint = {
  device_id: string;
  pollutant: string;
  value: number;
  unit?: string | null;
  lat?: number;
  lon?: number;
  timestamp: string;
  altitude?: number | null;
  precision?: number | null;
  flags?: number;
};

export type IngestSmokeTestResponse = {
  accepted: boolean;
  batchId: string;
  deviceId: string;
  storagePath: string;
  seededDeviceId: string;
  payload?: {
    points?: IngestSmokeTestPoint[];
  };
  points?: IngestSmokeTestPoint[];
};

export async function listDevices(): Promise<DeviceSummary[]> {
  const r = await fetch(`${BASE}/v1/devices`);
  if (!r.ok) throw new Error("api");
  return r.json() as Promise<DeviceSummary[]>;
}
export async function fetchMeasurements(q: {
  device_id: string; pollutant?: "pm25"; t0: string; t1: string; limit?: number;
}): Promise<MeasurementRecord[]> {
  const qs = new URLSearchParams(Object.entries(q).map(([k,v])=>[k,String(v)]));
  const r = await fetch(`${BASE}/v1/measurements?${qs}`);
  if (!r.ok) throw new Error("api");
  return r.json() as Promise<MeasurementRecord[]>;
}

export async function runIngestSmokeTest(): Promise<IngestSmokeTestResponse> {
  const r = await fetch(`${BASE}/v1/admin/ingest-smoke-test`, { method: "POST" });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(text || `Smoke test failed with status ${r.status}`);
  }
  return r.json() as Promise<IngestSmokeTestResponse>;
}

export async function cleanupIngestSmokeTest(deviceId?: string): Promise<{ clearedDeviceId: string }> {
  const r = await fetch(`${BASE}/v1/admin/ingest-smoke-test/cleanup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(deviceId ? { deviceId } : {})
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(text || `Cleanup failed with status ${r.status}`);
  }
  return r.json() as Promise<{ clearedDeviceId: string }>;
}
