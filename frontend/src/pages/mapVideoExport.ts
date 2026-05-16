import { timestampToMillis } from "@crowdpm/types";
import type { MapMeasurementRecord } from "./mapPageData";

export const VIDEO_EXPORT_DURATION_OPTIONS = [
  { label: "6s", value: 6_000 },
  { label: "12s", value: 12_000 },
  { label: "24s", value: 24_000 },
  { label: "30s", value: 30_000 },
] as const;
export const VIDEO_EXPORT_FPS_OPTIONS = [24, 30, 60] as const;
export const VIDEO_EXPORT_QUALITY_OPTIONS = [
  { label: "Low (2.5 Mbps)", value: "low", videoBitsPerSecond: 2_500_000 },
  { label: "Medium (5 Mbps)", value: "medium", videoBitsPerSecond: 5_000_000 },
  { label: "High (10 Mbps)", value: "high", videoBitsPerSecond: 10_000_000 },
] as const;
export const VIDEO_EXPORT_HOLD_OPTIONS = [
  { label: "Off", value: 0 },
  { label: "1s", value: 1_000 },
  { label: "2s", value: 2_000 },
] as const;
export const VIDEO_EXPORT_VISUAL_SETTLE_FRAMES = 4;
export const VIDEO_EXPORT_NON_BLACK_RETRIES = 10;
export const VIDEO_EXPORT_ORBIT_DEGREES = 24;

const VIDEO_EXPORT_MIN_POINT_MS = 300;
const VIDEO_EXPORT_START_TILT = 45;
const VIDEO_EXPORT_TARGET_TILT = 67.5;
const VIDEO_EXPORT_TILT_RAMP_PORTION = 0.2;

export type VideoExportDurationMs = (typeof VIDEO_EXPORT_DURATION_OPTIONS)[number]["value"];
export type VideoExportFps = (typeof VIDEO_EXPORT_FPS_OPTIONS)[number];
export type VideoExportQuality = (typeof VIDEO_EXPORT_QUALITY_OPTIONS)[number]["value"];
export type VideoExportHoldMs = (typeof VIDEO_EXPORT_HOLD_OPTIONS)[number]["value"];
export type VideoExportSettings = {
  durationMs: VideoExportDurationMs;
  fps: VideoExportFps;
  quality: VideoExportQuality;
  holdMs: VideoExportHoldMs;
  enableHeadingOrbit: boolean;
  enableTiltRamp: boolean;
};

export const DEFAULT_VIDEO_EXPORT_SETTINGS: VideoExportSettings = {
  durationMs: 12_000,
  fps: 30,
  quality: "medium",
  holdMs: 1_000,
  enableHeadingOrbit: true,
  enableTiltRamp: true,
};

export class VideoExportCancelledError extends Error {
  constructor() {
    super("Video export cancelled.");
    this.name = "VideoExportCancelledError";
  }
}

export function throwIfVideoExportAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new VideoExportCancelledError();
  }
}

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfVideoExportAborted(signal);
  if (!signal) return promise;

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      reject(new VideoExportCancelledError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      }
    );
  });
}

function waitForAnimationFrame(signal?: AbortSignal): Promise<number> {
  throwIfVideoExportAborted(signal);
  return new Promise((resolve, reject) => {
    let rafId = 0;
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      cleanup();
      reject(new VideoExportCancelledError());
    };
    if (signal) signal.addEventListener("abort", handleAbort, { once: true });
    rafId = window.requestAnimationFrame((timestamp) => {
      cleanup();
      resolve(timestamp);
    });
  });
}

export async function waitForAnimationFrames(count: number, signal?: AbortSignal) {
  for (let index = 0; index < count; index += 1) {
    await waitForAnimationFrame(signal);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfVideoExportAborted(signal);
  return new Promise((resolve, reject) => {
    let timeoutId = 0;
    const cleanup = () => {
      if (signal) signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      reject(new VideoExportCancelledError());
    };
    if (signal) signal.addEventListener("abort", handleAbort, { once: true });
    timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
  });
}

function easeInOutCubic(t: number): number {
  const clamped = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), 1);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

export function getVideoExportBitrate(quality: VideoExportQuality): number {
  return VIDEO_EXPORT_QUALITY_OPTIONS.find((option) => option.value === quality)?.videoBitsPerSecond
    ?? 5_000_000;
}

export function getVideoExportTilt(settings: VideoExportSettings, progress: number): number {
  if (!settings.enableTiltRamp) return VIDEO_EXPORT_TARGET_TILT;
  const rampProgress = Math.min(Math.max(progress / VIDEO_EXPORT_TILT_RAMP_PORTION, 0), 1);
  const easedProgress = easeInOutCubic(rampProgress);
  return VIDEO_EXPORT_START_TILT + (VIDEO_EXPORT_TARGET_TILT - VIDEO_EXPORT_START_TILT) * easedProgress;
}

function formatVideoExportTimestamp(point: MapMeasurementRecord): string {
  const timestampMs = timestampToMillis(point.timestamp);
  return timestampMs === null ? "Timestamp unavailable" : new Date(timestampMs).toLocaleString();
}

export function getVideoExportMeasurementOverlayLines(
  point: MapMeasurementRecord | undefined,
  index: number,
  totalCount: number,
  label: string
): string[] {
  if (!point) return [label, `Point ${Math.min(index + 1, totalCount)} of ${totalCount}`];

  const pollutant = String(point.pollutant);
  const pollutantLabel = pollutant === "pm25" ? "PM2.5" : pollutant.toUpperCase();
  const valueLabel = `${pollutantLabel}: ${point.value} ${point.unit || "\u00b5g/m\u00b3"}`;
  const precisionLabel = point.precision != null ? ` \u00b7 \u00b1${Math.round(point.precision)}m` : "";
  const altitudeLabel = point.altitude != null ? ` \u00b7 alt ${Math.round(point.altitude)}m` : "";

  return [
    label,
    `Point ${index + 1} of ${totalCount} \u00b7 ${formatVideoExportTimestamp(point)}`,
    valueLabel,
    `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}${precisionLabel}${altitudeLabel}`,
  ];
}

export function getVideoExportWaypointIndexes(pointCount: number, motionDurationMs: number): number[] {
  const lastIndex = pointCount - 1;
  if (lastIndex <= 0) return [0];

  const maxSegments = Math.max(1, Math.floor(motionDurationMs / VIDEO_EXPORT_MIN_POINT_MS));
  const segmentCount = Math.min(lastIndex, maxSegments);
  if (segmentCount >= lastIndex) {
    return Array.from({ length: pointCount }, (_, index) => index);
  }

  const indexes: number[] = [];
  for (let step = 0; step <= segmentCount; step += 1) {
    const index = Math.round((lastIndex * step) / segmentCount);
    const previous = indexes[indexes.length - 1];
    indexes.push(previous === undefined ? index : Math.max(index, previous + 1));
  }
  indexes[indexes.length - 1] = lastIndex;
  return indexes;
}

function hasNonBlackCaptureSamples(canvas: HTMLCanvasElement): boolean | null {
  if (canvas.width <= 0 || canvas.height <= 0) return false;

  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = Math.min(canvas.width, 64);
  sampleCanvas.height = Math.min(canvas.height, 36);
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = sampleCanvas.getContext("2d", { willReadFrequently: true });
    context?.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
  }
  catch {
    return null;
  }
  if (!context) return null;

  const samplePoints = [
    [0.08, 0.08],
    [0.5, 0.08],
    [0.92, 0.08],
    [0.2, 0.35],
    [0.5, 0.5],
    [0.8, 0.35],
    [0.08, 0.92],
    [0.5, 0.92],
    [0.92, 0.92],
  ] as const;

  try {
    return samplePoints.some(([ratioX, ratioY]) => {
      const x = Math.min(Math.max(Math.round(sampleCanvas.width * ratioX), 0), sampleCanvas.width - 1);
      const y = Math.min(Math.max(Math.round(sampleCanvas.height * ratioY), 0), sampleCanvas.height - 1);
      const [red, green, blue, alpha] = context.getImageData(x, y, 1, 1).data;
      return alpha > 8 && red + green + blue > 30;
    });
  }
  catch {
    return null;
  }
}

export async function waitForNonBlackCaptureFrame(
  canvas: HTMLCanvasElement,
  onRetry?: () => Promise<void>,
  maxRetries = VIDEO_EXPORT_NON_BLACK_RETRIES,
  signal?: AbortSignal
) {
  for (let retry = 0; retry <= maxRetries; retry += 1) {
    throwIfVideoExportAborted(signal);
    const result = hasNonBlackCaptureSamples(canvas);
    if (result !== false) return;
    await waitForAnimationFrames(1, signal);
    await onRetry?.();
  }
}

export function sanitizeFileSegment(value: string | null | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "batch";
}
