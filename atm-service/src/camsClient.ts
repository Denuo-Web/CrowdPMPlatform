import { setTimeout as delay } from "node:timers/promises";
import type { ServiceConfig } from "./config.js";
import type { BatchDescriptor } from "./types.js";

type CopernicusJobState = "queued" | "running" | "completed" | "failed";

type CopernicusJobResponse = {
  request_id: string;
  state: CopernicusJobState;
  message?: string;
  result?: {
    size?: number;
    url?: string;
    href?: string;
    content_type?: string;
  };
  _links?: {
    self?: { href: string };
    results?: Array<{ href: string }>;
  };
};

async function fetchJson<T>(config: ServiceConfig, url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Copernicus request failed (${response.status}): ${text || response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function resolveUrl(config: ServiceConfig, path: string): string {
  return new URL(path, config.CAMS_API_URL).toString();
}

function buildRequestBody(config: ServiceConfig, descriptor: BatchDescriptor) {
  const startDate = new Date(descriptor.startTime);
  const endDate = new Date(descriptor.endTime);
  const isoStart = startDate.toISOString().slice(0, 10);
  const isoEnd = endDate.toISOString().slice(0, 10);

  const hours = Array.from({ length: 24 }, (_, idx) => idx.toString().padStart(2, "0") + ":00");

  return {
    format: "netcdf",
    dataset: config.CAMS_DATASET_ID,
    variables: [config.CAMS_PM_VARIABLE],
    date: `${isoStart}/${isoEnd}`,
    time: hours,
    leadtime_hour: ["0"],
    type: ["forecast"],
    area: [
      Number.isFinite(descriptor.bbox.north) ? descriptor.bbox.north : 90,
      Number.isFinite(descriptor.bbox.west) ? descriptor.bbox.west : -180,
      Number.isFinite(descriptor.bbox.south) ? descriptor.bbox.south : -90,
      Number.isFinite(descriptor.bbox.east) ? descriptor.bbox.east : 180
    ]
  };
}

async function submitJob(config: ServiceConfig, descriptor: BatchDescriptor): Promise<string> {
  const body = buildRequestBody(config, descriptor);
  const url = resolveUrl(config, `/resources/${config.CAMS_DATASET_ID}`);
  const authHeader = `Basic ${Buffer.from(config.CAMS_API_KEY).toString("base64")}`;
  const payload = await fetchJson<CopernicusJobResponse>(config, url, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const statusPath = payload._links?.self?.href ?? payload.result?.href ?? payload.result?.url;
  if (!statusPath) {
    throw new Error("Copernicus response missing status link");
  }
  return resolveUrl(config, statusPath);
}

async function getJobStatus(config: ServiceConfig, statusUrl: string): Promise<CopernicusJobResponse> {
  const authHeader = `Basic ${Buffer.from(config.CAMS_API_KEY).toString("base64")}`;
  return fetchJson<CopernicusJobResponse>(config, statusUrl, {
    method: "GET",
    headers: {
      Authorization: authHeader
    }
  });
}

async function resolveResultUrl(config: ServiceConfig, job: CopernicusJobResponse, statusUrl: string): Promise<string> {
  if (job.result?.url) return job.result.url;
  if (job.result?.href) return resolveUrl(config, job.result.href);
  const resultLink = job._links?.results?.[0]?.href;
  if (resultLink) {
    const authHeader = `Basic ${Buffer.from(config.CAMS_API_KEY).toString("base64")}`;
    const resultDescriptor = await fetchJson<{ location?: string; href?: string }>(config, resolveUrl(config, resultLink), {
      method: "GET",
      headers: {
        Authorization: authHeader
      }
    });
    if (resultDescriptor.location) return resolveUrl(config, resultDescriptor.location);
    if (resultDescriptor.href) return resolveUrl(config, resultDescriptor.href);
  }
  throw new Error(`Copernicus job ${job.request_id} completed but no result URL was provided (${statusUrl})`);
}

export async function downloadForecast(config: ServiceConfig, descriptor: BatchDescriptor): Promise<ArrayBuffer> {
  const statusUrl = await submitJob(config, descriptor);
  const authHeader = `Basic ${Buffer.from(config.CAMS_API_KEY).toString("base64")}`;

  const started = Date.now();
  while (true) {
    const job = await getJobStatus(config, statusUrl);
    if (job.state === "failed") {
      throw new Error(job.message ?? `Copernicus job ${job.request_id} failed`);
    }
    if (job.state === "completed") {
      const downloadUrl = await resolveResultUrl(config, job, statusUrl);
      const response = await fetch(downloadUrl, {
        method: "GET",
        headers: {
          Authorization: authHeader
        }
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Failed to download NetCDF (${response.status}): ${text || response.statusText}`);
      }
      const buffer = await response.arrayBuffer();
      return buffer;
    }
    if (Date.now() - started > config.API_TIMEOUT_MS) {
      throw new Error(`Timed out waiting for Copernicus job ${job.request_id}`);
    }
    await delay(5000);
  }
}
