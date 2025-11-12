export type Pm25Point = {
  lat: number;
  lon: number;
  value: number;
};

export type Pm25Response = {
  batchId: string;
  deviceId?: string;
  startTime: string;
  endTime: string;
  updatedAt: string;
  bbox: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  points: Pm25Point[];
};

export type Pm25Request = {
  batchId: string;
  deviceId?: string;
  start: string;
  end: string;
  bbox: string;
  allowStale?: boolean;
  force?: boolean;
};

function resolveBaseUrl(): string {
  const raw = import.meta.env.VITE_PM25_API_BASE_URL as string | undefined;
  if (!raw || !raw.trim()) {
    throw new Error("VITE_PM25_API_BASE_URL is not configured. Set it to your PM2.5 microservice base URL.");
  }
  return raw.replace(/\/$/, "");
}

export async function fetchPm25Heatmap(request: Pm25Request): Promise<Pm25Response> {
  const baseUrl = resolveBaseUrl();
  const params = new URLSearchParams({
    batchId: request.batchId,
    start: request.start,
    end: request.end,
    bbox: request.bbox,
    allowStale: request.allowStale ? "1" : "0"
  });
  if (request.deviceId) params.set("deviceId", request.deviceId);
  if (request.force) params.set("force", request.force ? "1" : "0");

  const url = `${baseUrl}/pm25?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json"
    }
  });

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    const message = (() => {
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        return parsed.message || parsed.error || text;
      }
      catch {
        return text;
      }
    })();
    throw new Error(message || `PM2.5 request failed with ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Unable to parse PM2.5 payload: ${message}`);
  }

  const candidate = parsed as Partial<Pm25Response>;
  if (!candidate || !Array.isArray(candidate.points)) {
    throw new Error("PM2.5 response malformed: missing points array");
  }

  return candidate as Pm25Response;
}
