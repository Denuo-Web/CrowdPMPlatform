import { forwardRef, useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef } from "react";
import type { UserThemeAppearance } from "@crowdpm/types";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { SphereGeometry } from "@luma.gl/engine";
import type { Layer } from "@deck.gl/core";
import { getMapsLoader, normalizeGoogleMapId } from "../lib/mapsLoader";
import { logError, logWarning } from "../lib/logger";
import { canCaptureCanvas } from "../lib/videoExport";
import {
  planExportCameraBase,
  planExportCameraFrame,
  planSelectionCamera,
  type CameraState,
} from "../lib/mapCamera";

type MeasurementPoint = {
  lat: number;
  lon: number;
  timestamp: number;
  value: number;
  precision: number | null;
  altitude: number | null;
  batchKey?: string;
  batchPointIndex?: number;
};

export type PlaybackPathMode = "full" | "progressive";

export type Map3DCaptureSession = {
  canvas: HTMLCanvasElement;
  requestFrame: () => void;
  stop: () => void;
};

type Map3DCaptureOptions = {
  watermarkText?: string | null;
  captureFps?: number;
  frameOverlayLines?: () => string[];
};

type Map3DVisualReadyOptions = {
  forExport?: boolean;
  idleTimeoutMs?: number;
};

export type Map3DExportCameraFrame = {
  fromIndex: number;
  toIndex: number;
  progress: number;
  headingOffsetDeg?: number;
  tilt?: number;
  zoom?: number;
};

export type Map3DHandle = {
  getCaptureCanvas: () => HTMLCanvasElement | null;
  startCaptureSession: (options?: Map3DCaptureOptions) => Promise<Map3DCaptureSession | null>;
  waitForVisualReady: (options?: Map3DVisualReadyOptions) => Promise<void>;
  setExportCameraFrame: (frame: Map3DExportCameraFrame | null) => void;
};

type MapCameraState = CameraState;

type Map3DProps = {
  data: MeasurementPoint[];
  appearance: UserThemeAppearance;
  selectedIndex: number;
  onSelectIndex?: (index: number) => void;
  onSelectPoint?: (point: MeasurementPoint) => void;
  onZoomChange?: (zoom: number) => void;
  autoCenterKey?: string;
  interleaved?: boolean;
  showAllMode?: boolean;
  defaultCenter?: { lat: number; lng: number };
  defaultZoom?: number;
  forceFollowSelection?: boolean;
  playbackPathMode?: PlaybackPathMode;
};

// Pacific NW default
const FALLBACK_CENTER = { lat: 44.56, lng: -123.26 };
const FALLBACK_ZOOM = 7;
type PathDatum = { path: [number, number, number][] };
type GuardedOverlayView = google.maps.OverlayView & {
  getMap?: () => google.maps.Map | null;
  requestRedraw?: () => void;
};
type GoogleMapsOverlayPrivateState = {
  _map?: google.maps.Map | null;
  _overlay?: GuardedOverlayView | null;
  _positioningOverlay?: GuardedOverlayView | null;
  _onAdd?: () => void;
  _onAddVectorOverlay?: () => void;
};

function isGoogleMapsOverlayNotInitializedError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Not initialized");
}

function isGoogleMapsWebGlInternalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.includes("Cannot read properties of null (reading 'indexOf')")
    && (error.stack?.includes("webgl.js") ?? false);
}

function waitForNextAnimationFrame(): Promise<number> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(resolve);
  });
}

async function waitForAnimationFrames(count: number) {
  for (let index = 0; index < count; index += 1) {
    await waitForNextAnimationFrame();
  }
}

function waitForMapIdle(map: google.maps.Map | null, timeoutMs: number): Promise<void> {
  if (!map) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (typeof listener.remove === "function") listener.remove();
      window.clearTimeout(timeoutId);
      resolve();
    };

    const listener = map.addListener("idle", finish);
    const timeoutId = window.setTimeout(finish, timeoutMs);
  });
}

function getVisualReadyIdleTimeoutMs(forceFollowSelection: boolean, options?: Map3DVisualReadyOptions): number {
  if (typeof options?.idleTimeoutMs === "number" && Number.isFinite(options.idleTimeoutMs)) {
    return Math.max(0, options.idleTimeoutMs);
  }
  if (options?.forExport) {
    return forceFollowSelection ? 1_200 : 1_000;
  }
  return forceFollowSelection ? 450 : 250;
}

function readMapCameraState(map: google.maps.Map | null): MapCameraState | null {
  if (!map) return null;

  const center = map.getCenter();
  if (!center) return null;

  return {
    center: { lat: center.lat(), lng: center.lng() },
    zoom: map.getZoom() ?? undefined,
    tilt: map.getTilt() ?? undefined,
    heading: map.getHeading() ?? undefined,
  };
}

function moveMapCamera(map: google.maps.Map, camera: MapCameraState) {
  if (typeof map.moveCamera === "function") {
    const cameraOptions: google.maps.CameraOptions = { center: camera.center };
    if (typeof camera.zoom === "number") cameraOptions.zoom = camera.zoom;
    if (typeof camera.tilt === "number") cameraOptions.tilt = camera.tilt;
    if (typeof camera.heading === "number") cameraOptions.heading = camera.heading;
    map.moveCamera(cameraOptions);
    return;
  }

  map.setCenter(camera.center);
  if (typeof camera.zoom === "number") map.setZoom(camera.zoom);
  if (typeof camera.tilt === "number") map.setTilt(camera.tilt);
  if (typeof camera.heading === "number") map.setHeading(camera.heading);
}

function ensureRange(min: number, max: number): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === Infinity || max === -Infinity) return [0, 1];
  if (Math.abs(max - min) < 1e-6) return [min, min + 1];
  return [min, max];
}

function interpolateColor(value: number, min: number, max: number): [number, number, number] {
  const span = Math.max(1e-6, max - min);
  const t = (value - min) / span;
  const r = t <= 0.5 ? t / 0.5 : 1;
  const g = t <= 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
  return [Math.round(r * 255), Math.round(g * 255), 0];
}

function signature(series: MeasurementPoint[]) {
  if (!series.length) return "empty";
  const first = series[0];
  const last = series[series.length - 1];
  return [
    series.length,
    first.lat.toFixed(6),
    first.lon.toFixed(6),
    last.lat.toFixed(6),
    last.lon.toFixed(6),
    last.timestamp
  ].join(":");
}

function markerRadiusMeters(precision: number | null): number {
  if (typeof precision !== "number" || !Number.isFinite(precision)) {
    return 10;
  }
  return Math.max(5, precision / 2);
}

function createLayers(
  series: MeasurementPoint[],
  selectedIndex: number,
  onSelectIndex: ((index: number) => void) | undefined,
  onSelectPoint: ((point: MeasurementPoint) => void) | undefined,
  sphereGeometry: SphereGeometry,
  showAllMode: boolean,
  playbackPathMode: PlaybackPathMode
): Layer[] {
  if (!series.length) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const point of series) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  const [scaledMin, scaledMax] = ensureRange(min, max);

  if (showAllMode) {
    const allSpheres = new SimpleMeshLayer<MeasurementPoint & { index: number }>({
      id: "measurement-spheres-all",
      data: series.map((point, index) => ({ ...point, index })),
      mesh: sphereGeometry,
      getPosition: (d) => [d.lon, d.lat, (d.altitude ?? 0)],
      getColor: (d) => {
        const base = interpolateColor(d.value, scaledMin, scaledMax);
        return [...base, 200] as [number, number, number, number];
      },
      getScale: (d) => {
        const radiusMeters = markerRadiusMeters(d.precision ?? null);
        return [radiusMeters, radiusMeters, radiusMeters];
      },
      pickable: true,
      onClick: (info) => {
        const point = info.object;
        if (!point) return;
        onSelectPoint?.(point);
      }
    });
    return [allSpheres];
  }

  const clampedIndex = Math.min(Math.max(selectedIndex, 0), series.length - 1);
  const pathSeries = playbackPathMode === "progressive"
    ? series.slice(0, clampedIndex + 1)
    : series;
  const pathPoints = pathSeries.map((point) => [point.lon, point.lat, 0]);
  const selected = series[clampedIndex] ?? series[series.length - 1];

  const pathLayer = new PathLayer<PathDatum>({
    id: "measurement-path",
    data: [{ path: pathPoints }],
    getPath: (d) => d.path,
    getColor: () => [80, 160, 255, 200],
    getWidth: () => 6,
    widthUnits: "pixels",
    parameters: {
      depthCompare: "always",
      depthWriteEnabled: false
    },
    pickable: false
  });

  const sphereLayer = new SimpleMeshLayer<MeasurementPoint & { index: number }>({
    id: "measurement-sphere",
    data: selected ? [{ ...selected, index: clampedIndex }] : [],
    mesh: sphereGeometry,
    getPosition: (d) => [d.lon, d.lat, (d.altitude ?? 0)],
    getColor: (d) => {
      const base = interpolateColor(d.value, scaledMin, scaledMax);
      return [...base, 220] as [number, number, number, number];
    },
    getScale: (d) => {
      const radiusMeters = markerRadiusMeters(d.precision ?? null);
      return [radiusMeters, radiusMeters, radiusMeters];
    },
    pickable: true,
    onClick: (info) => {
      const index = info.object?.index;
      if (typeof index === "number" && onSelectIndex) onSelectIndex(index);
    }
  });

  return [pathLayer, sphereLayer];
}

function getVisibleCanvases(root: HTMLDivElement | null): HTMLCanvasElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll("canvas")).filter((canvas): canvas is HTMLCanvasElement => {
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const style = window.getComputedStyle(canvas);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(canvas.width, Math.round(rect.width));
    const height = Math.max(canvas.height, Math.round(rect.height));
    return width > 0 && height > 0;
  });
}

function pickLargestCaptureCanvas(root: HTMLDivElement | null): HTMLCanvasElement | null {
  if (!root) return null;

  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;

  getVisibleCanvases(root).forEach((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement) || !canCaptureCanvas(canvas)) return;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(canvas.width, Math.round(rect.width));
    const height = Math.max(canvas.height, Math.round(rect.height));
    const area = width * height;
    if (area >= bestArea) {
      best = canvas;
      bestArea = area;
    }
  });

  return best;
}

function requestOverlayRedraw(overlay: GoogleMapsOverlay | null) {
  if (!overlay) return;
  const internalOverlay = overlay as unknown as GoogleMapsOverlayPrivateState;
  if (!internalOverlay._map || !internalOverlay._overlay?.getMap?.()) return;

  try {
    internalOverlay._overlay.requestRedraw?.();
  }
  catch (error) {
    if (!isGoogleMapsOverlayNotInitializedError(error)) {
      logWarning("Unable to request map overlay redraw.", undefined, error);
    }
  }
}

function setOverlayPropsSafely(overlay: GoogleMapsOverlay, props: ConstructorParameters<typeof GoogleMapsOverlay>[0]): boolean {
  try {
    overlay.setProps(props);
    return true;
  }
  catch (error) {
    if (!isGoogleMapsOverlayNotInitializedError(error)) {
      logWarning("Unable to update map overlay props.", undefined, error);
    }
    return false;
  }
}

function guardOverlayLifecycle(overlay: GoogleMapsOverlay) {
  const internalOverlay = overlay as unknown as GoogleMapsOverlayPrivateState;
  const originalSetMap = overlay.setMap.bind(overlay);

  overlay.setMap = (map: google.maps.Map | null) => {
    try {
      originalSetMap(map);
    }
    catch (error) {
      if (map !== null || !isGoogleMapsOverlayNotInitializedError(error)) {
        throw error;
      }

      try {
        internalOverlay._overlay?.setMap?.(null);
      }
      catch (detachError) {
        void detachError;
      }
      try {
        internalOverlay._positioningOverlay?.setMap?.(null);
      }
      catch (detachError) {
        void detachError;
      }

      internalOverlay._overlay = null;
      internalOverlay._positioningOverlay = null;
      internalOverlay._map = null;
    }
  };

  if (typeof internalOverlay._onAdd === "function") {
    const originalOnAdd = internalOverlay._onAdd.bind(overlay);
    internalOverlay._onAdd = () => {
      if (!internalOverlay._map || !internalOverlay._overlay?.getMap?.()) return;
      originalOnAdd();
    };
  }

  if (typeof internalOverlay._onAddVectorOverlay === "function") {
    const originalOnAddVectorOverlay = internalOverlay._onAddVectorOverlay.bind(overlay);
    internalOverlay._onAddVectorOverlay = () => {
      if (!internalOverlay._map || !internalOverlay._positioningOverlay?.getMap?.()) return;
      originalOnAddVectorOverlay();
    };
  }
}

function compareCanvasOrder(left: HTMLCanvasElement, right: HTMLCanvasElement): number {
  const leftZ = Number.parseInt(window.getComputedStyle(left).zIndex || "0", 10);
  const rightZ = Number.parseInt(window.getComputedStyle(right).zIndex || "0", 10);
  const safeLeftZ = Number.isFinite(leftZ) ? leftZ : 0;
  const safeRightZ = Number.isFinite(rightZ) ? rightZ : 0;
  if (safeLeftZ !== safeRightZ) return safeLeftZ - safeRightZ;

  const relation = left.compareDocumentPosition(right);
  if (relation & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (relation & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function drawWatermark(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
  watermarkText: string,
) {
  const safeText = watermarkText.trim();
  if (!safeText) return;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);
  const fontSize = Math.max(14, Math.round(Math.min(canvas.width / dpr, canvas.height / dpr) * 0.028));
  const paddingX = fontSize * 0.8;
  const paddingY = fontSize * 0.55;
  const x = (canvas.width / dpr) - paddingX;
  const y = (canvas.height / dpr) - paddingY;
  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = "right";
  context.textBaseline = "bottom";
  const metrics = context.measureText(safeText);
  const boxWidth = metrics.width + fontSize * 1.1;
  const boxHeight = fontSize * 1.9;
  context.fillStyle = "rgba(0, 0, 0, 0.52)";
  context.beginPath();
  context.roundRect(x - boxWidth, y - boxHeight + 4, boxWidth, boxHeight, 8);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.92)";
  context.fillText(safeText, x - fontSize * 0.55, y - fontSize * 0.35);
  context.restore();
}

function getFrameOverlayLines(options?: Map3DCaptureOptions): string[] {
  if (!options?.frameOverlayLines) return [];

  try {
    return options.frameOverlayLines()
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 6);
  }
  catch (err) {
    logWarning("Unable to render video export frame overlay.", undefined, err);
    return [];
  }
}

function fitCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (context.measureText(text).width <= maxWidth) return text;

  const ellipsis = "...";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (context.measureText(candidate).width <= maxWidth) {
      low = mid;
    }
    else {
      high = mid - 1;
    }
  }
  return `${text.slice(0, low)}${ellipsis}`;
}

function drawFrameOverlay(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dpr: number,
  lines: string[],
) {
  if (!lines.length) return;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.scale(dpr, dpr);

  const widthCss = canvas.width / dpr;
  const heightCss = canvas.height / dpr;
  const fontSize = Math.max(12, Math.round(Math.min(widthCss, heightCss) * 0.023));
  const lineHeight = Math.round(fontSize * 1.35);
  const paddingX = Math.round(fontSize * 0.85);
  const paddingY = Math.round(fontSize * 0.7);
  const margin = Math.max(10, Math.round(fontSize * 0.8));
  const maxTextWidth = Math.max(180, widthCss - (margin * 2) - (paddingX * 2));

  context.font = `600 ${fontSize}px system-ui, sans-serif`;
  const fittedLines = lines.map((line) => fitCanvasText(context, line, maxTextWidth));
  const boxWidth = Math.min(
    widthCss - (margin * 2),
    Math.max(...fittedLines.map((line) => context.measureText(line).width)) + (paddingX * 2)
  );
  const boxHeight = (lineHeight * fittedLines.length) + (paddingY * 2);
  const x = margin;
  const y = margin;

  context.fillStyle = "rgba(0, 0, 0, 0.58)";
  context.beginPath();
  context.roundRect(x, y, boxWidth, boxHeight, 10);
  context.fill();
  context.fillStyle = "rgba(255, 255, 255, 0.94)";
  context.textAlign = "left";
  context.textBaseline = "top";

  fittedLines.forEach((line, index) => {
    context.font = index === 0
      ? `700 ${fontSize}px system-ui, sans-serif`
      : `500 ${Math.max(11, fontSize - 1)}px system-ui, sans-serif`;
    context.fillText(line, x + paddingX, y + paddingY + (index * lineHeight));
  });
  context.restore();
}

function createCompositeCaptureSession(root: HTMLDivElement | null, options?: Map3DCaptureOptions): Map3DCaptureSession | null {
  if (!root) return null;

  const canvases = getVisibleCanvases(root).sort(compareCanvasOrder);
  if (!canvases.length) return null;

  const rootRect = root.getBoundingClientRect();
  const fallbackCanvas = canvases.reduce<HTMLCanvasElement | null>((best, current) => {
    if (!best) return current;
    const bestRect = best.getBoundingClientRect();
    const currentRect = current.getBoundingClientRect();
    return (currentRect.width * currentRect.height) > (bestRect.width * bestRect.height) ? current : best;
  }, null);
  const fallbackRect = fallbackCanvas?.getBoundingClientRect() ?? null;
  const widthCss = Math.max(Math.round(rootRect.width), Math.round(fallbackRect?.width ?? 0));
  const heightCss = Math.max(Math.round(rootRect.height), Math.round(fallbackRect?.height ?? 0));
  if (widthCss <= 0 || heightCss <= 0) return null;

  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = Math.max(1, Math.round(widthCss * dpr));
  compositeCanvas.height = Math.max(1, Math.round(heightCss * dpr));
  compositeCanvas.style.width = `${widthCss}px`;
  compositeCanvas.style.height = `${heightCss}px`;

  const context = compositeCanvas.getContext("2d");
  if (!context) return null;
  const stagingCanvas = document.createElement("canvas");
  stagingCanvas.width = compositeCanvas.width;
  stagingCanvas.height = compositeCanvas.height;
  const stagingContext = stagingCanvas.getContext("2d");
  if (!stagingContext) return null;

  let disposed = false;
  let rafId = 0;

  const drawFrame = () => {
    if (disposed) return;

    const currentRootRect = root.getBoundingClientRect();
    const originLeft = currentRootRect.width > 0 ? currentRootRect.left : (fallbackRect?.left ?? 0);
    const originTop = currentRootRect.height > 0 ? currentRootRect.top : (fallbackRect?.top ?? 0);
    const currentCanvases = getVisibleCanvases(root)
      .sort(compareCanvasOrder)
      .filter((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;
      });
    if (!currentCanvases.length) return;

    stagingContext.setTransform(1, 0, 0, 1, 0, 0);
    stagingContext.clearRect(0, 0, stagingCanvas.width, stagingCanvas.height);
    stagingContext.scale(dpr, dpr);

    let drewFrame = false;
    currentCanvases.forEach((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const dx = rect.left - originLeft;
      const dy = rect.top - originTop;
      try {
        stagingContext.drawImage(canvas, dx, dy, rect.width, rect.height);
        drewFrame = true;
      }
      catch (err) {
        logWarning("Unable to composite map canvas layer for export.", {
          width: rect.width,
          height: rect.height
        }, err);
      }
    });
    if (!drewFrame) return;
    drawFrameOverlay(stagingContext, stagingCanvas, dpr, getFrameOverlayLines(options));
    if (options?.watermarkText) {
      drawWatermark(stagingContext, stagingCanvas, dpr, options.watermarkText);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    context.drawImage(stagingCanvas, 0, 0);
  };

  const scheduleFrame = () => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(() => {
      drawFrame();
      scheduleFrame();
    });
  };

  drawFrame();
  scheduleFrame();

  return {
    canvas: compositeCanvas,
    requestFrame: drawFrame,
    stop: () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    },
  };
}

function createDirectCanvasCaptureSession(root: HTMLDivElement | null): Map3DCaptureSession | null {
  const canvas = pickLargestCaptureCanvas(root);
  if (!canvas || !canCaptureCanvas(canvas)) return null;

  return {
    canvas,
    requestFrame: () => {},
    stop: () => {},
  };
}

async function createStreamBackedCaptureSession(
  root: HTMLDivElement | null,
  options?: Map3DCaptureOptions & { allowCompositeFallback?: boolean }
): Promise<Map3DCaptureSession | null> {
  if (!root) return null;
  const allowCompositeFallback = options?.allowCompositeFallback ?? true;

  const canvases = getVisibleCanvases(root).sort(compareCanvasOrder);
  if (!canvases.length) return null;

  const baseCanvas = pickLargestCaptureCanvas(root);
  if (!baseCanvas || !canCaptureCanvas(baseCanvas)) {
    return allowCompositeFallback ? createCompositeCaptureSession(root, options) : null;
  }

  const rootRect = root.getBoundingClientRect();
  const baseRect = baseCanvas.getBoundingClientRect();
  const widthCss = Math.max(Math.round(rootRect.width), Math.round(baseRect.width));
  const heightCss = Math.max(Math.round(rootRect.height), Math.round(baseRect.height));
  if (widthCss <= 0 || heightCss <= 0) return null;

  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const compositeCanvas = document.createElement("canvas");
  compositeCanvas.width = Math.max(1, Math.round(widthCss * dpr));
  compositeCanvas.height = Math.max(1, Math.round(heightCss * dpr));
  compositeCanvas.style.width = `${widthCss}px`;
  compositeCanvas.style.height = `${heightCss}px`;

  const context = compositeCanvas.getContext("2d");
  if (!context) return null;
  const stagingCanvas = document.createElement("canvas");
  stagingCanvas.width = compositeCanvas.width;
  stagingCanvas.height = compositeCanvas.height;
  const stagingContext = stagingCanvas.getContext("2d");
  if (!stagingContext) return null;

  let baseStream: MediaStream;
  try {
    baseStream = baseCanvas.captureStream(options?.captureFps ?? 30);
  }
  catch {
    return allowCompositeFallback ? createCompositeCaptureSession(root, options) : null;
  }

  const baseVideo = document.createElement("video");
  baseVideo.muted = true;
  baseVideo.playsInline = true;
  baseVideo.autoplay = true;
  baseVideo.srcObject = baseStream;

  try {
    await baseVideo.play();
  }
  catch {
    baseStream.getTracks().forEach((track) => track.stop());
    return allowCompositeFallback ? createCompositeCaptureSession(root, options) : null;
  }

  let disposed = false;
  let rafId = 0;

  const drawFrame = () => {
    if (disposed) return;

    const currentRootRect = root.getBoundingClientRect();
    const originLeft = currentRootRect.width > 0 ? currentRootRect.left : baseRect.left;
    const originTop = currentRootRect.height > 0 ? currentRootRect.top : baseRect.top;

    stagingContext.setTransform(1, 0, 0, 1, 0, 0);
    stagingContext.clearRect(0, 0, stagingCanvas.width, stagingCanvas.height);
    stagingContext.scale(dpr, dpr);

    let drewFrame = false;
    const currentBaseRect = baseCanvas.getBoundingClientRect();
    const baseDx = currentBaseRect.left - originLeft;
    const baseDy = currentBaseRect.top - originTop;
    if (
      baseVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && currentBaseRect.width > 0
      && currentBaseRect.height > 0
      && baseVideo.videoWidth > 0
      && baseVideo.videoHeight > 0
    ) {
      try {
        stagingContext.drawImage(baseVideo, baseDx, baseDy, currentBaseRect.width, currentBaseRect.height);
        drewFrame = true;
      }
      catch (err) {
        logWarning("Unable to composite streamed map canvas layer for export.", {
          width: currentBaseRect.width,
          height: currentBaseRect.height
        }, err);
      }
    }

    getVisibleCanvases(root).sort(compareCanvasOrder).forEach((canvas) => {
      if (canvas === baseCanvas) return;
      const rect = canvas.getBoundingClientRect();
      if (canvas.width <= 0 || canvas.height <= 0 || rect.width <= 0 || rect.height <= 0) return;
      const dx = rect.left - originLeft;
      const dy = rect.top - originTop;
      try {
        stagingContext.drawImage(canvas, dx, dy, rect.width, rect.height);
        drewFrame = true;
      }
      catch (err) {
        logWarning("Unable to composite map canvas layer for export.", {
          width: rect.width,
          height: rect.height
        }, err);
      }
    });
    if (!drewFrame) return;
    drawFrameOverlay(stagingContext, stagingCanvas, dpr, getFrameOverlayLines(options));
    if (options?.watermarkText) {
      drawWatermark(stagingContext, stagingCanvas, dpr, options.watermarkText);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    context.drawImage(stagingCanvas, 0, 0);
  };

  const scheduleFrame = () => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(() => {
      drawFrame();
      scheduleFrame();
    });
  };

  drawFrame();
  scheduleFrame();

  return {
    canvas: compositeCanvas,
    requestFrame: drawFrame,
    stop: () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      baseVideo.pause();
      baseVideo.srcObject = null;
      baseStream.getTracks().forEach((track) => track.stop());
    },
  };
}

async function createCaptureSession(
  root: HTMLDivElement | null,
  options?: Map3DCaptureOptions & { preferDirectCanvas?: boolean }
): Promise<Map3DCaptureSession | null> {
  const needsCompositedOverlay = Boolean(options?.watermarkText || options?.frameOverlayLines);
  if (needsCompositedOverlay) {
    return createStreamBackedCaptureSession(root, {
      allowCompositeFallback: true,
      watermarkText: options?.watermarkText,
      captureFps: options?.captureFps,
      frameOverlayLines: options?.frameOverlayLines,
    });
  }
  if (options?.preferDirectCanvas) {
    // Interleaved Google Maps renders deck.gl into the Maps WebGL canvas. Redrawing
    // that canvas through 2D drawImage can produce black frames, so record it directly.
    return createDirectCanvasCaptureSession(root)
      ?? createStreamBackedCaptureSession(root, {
        allowCompositeFallback: false,
        captureFps: options.captureFps,
      });
  }
  return createStreamBackedCaptureSession(root, { captureFps: options?.captureFps });
}

const Map3D = forwardRef<Map3DHandle, Map3DProps>(function Map3D({
  data,
  appearance,
  selectedIndex,
  onSelectIndex,
  onSelectPoint,
  onZoomChange,
  autoCenterKey,
  interleaved = false,
  showAllMode = false,
  defaultCenter,
  defaultZoom,
  forceFollowSelection = false,
  playbackPathMode = "full",
}: Map3DProps, ref) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const latestDataRef = useRef<MeasurementPoint[]>(data);
  const selectedIndexRef = useRef<number>(selectedIndex);
  const sphereGeometryRef = useRef<SphereGeometry | null>(null);
  const cameraStateRef = useRef<MapCameraState | null>(null);
  const hasUserControlRef = useRef(typeof defaultZoom === "number");
  const exportCameraActiveRef = useRef(false);
  const exportCameraBaseRef = useRef<{ zoom: number; tilt: number; heading: number } | null>(null);
  const initialDefaultZoomRef = useRef(defaultZoom);
  const dataSignatureRef = useRef(signature(data));
  const defaultCenterLat = defaultCenter?.lat;
  const defaultCenterLng = defaultCenter?.lng;
  const syncOverlayRef = useRef<((options?: { forceCenter?: boolean }) => void) | null>(null);

  useEffect(() => { latestDataRef.current = data; }, [data]);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);
  useEffect(() => {
    const sig = signature(data);
    if (dataSignatureRef.current !== sig) {
      dataSignatureRef.current = sig;
      hasUserControlRef.current = !forceFollowSelection;
    }
  }, [data, forceFollowSelection]);

  useEffect(() => {
    hasUserControlRef.current = !forceFollowSelection;
  }, [forceFollowSelection]);

  const handleSelectIndex = useEffectEvent((index: number) => {
    onSelectIndex?.(index);
  });

  const handleSelectPoint = useEffectEvent((point: MeasurementPoint) => {
    onSelectPoint?.(point);
  });

  const emitZoomChange = useEffectEvent((zoom: number) => {
    onZoomChange?.(zoom);
  });

  const syncOverlay = useCallback((options?: { forceCenter?: boolean }) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!sphereGeometryRef.current) {
      sphereGeometryRef.current = new SphereGeometry({ radius: 1, nlat: 24, nlong: 24 });
    }

    if (!setOverlayPropsSafely(overlay, {
      layers: createLayers(
        latestDataRef.current,
        selectedIndexRef.current,
        handleSelectIndex,
        handleSelectPoint,
        sphereGeometryRef.current,
        showAllMode,
        playbackPathMode
      )
    })) return;

    const series = latestDataRef.current;
    const current = series[selectedIndexRef.current] ?? series[0];
    if (current) {
      const map = mapRef.current;
      if (map && (!hasUserControlRef.current || options?.forceCenter || forceFollowSelection)) {
        if (exportCameraActiveRef.current) {
          requestOverlayRedraw(overlay);
          return;
        }
        moveMapCamera(map, planSelectionCamera({
          point: current,
          currentZoom: map.getZoom() ?? undefined,
          currentTilt: map.getTilt() ?? undefined,
          forceFollowSelection,
        }));
      }
    }

    requestOverlayRedraw(overlay);
  }, [forceFollowSelection, playbackPathMode, showAllMode]);

  useEffect(() => {
    syncOverlayRef.current = syncOverlay;
  }, [syncOverlay]);

  useEffect(() => {
    syncOverlay();
  }, [data, selectedIndex, syncOverlay]);

  useEffect(() => {
    if (!autoCenterKey || !forceFollowSelection) return;
    hasUserControlRef.current = false;
    syncOverlay({ forceCenter: true });
  }, [autoCenterKey, forceFollowSelection, syncOverlay]);

  const getCaptureCanvas = useCallback(
    () => pickLargestCaptureCanvas(divRef.current),
    []
  );

  const setExportCameraFrame = useCallback((frame: Map3DExportCameraFrame | null) => {
    if (!frame) {
      exportCameraActiveRef.current = false;
      exportCameraBaseRef.current = null;
      return;
    }

    exportCameraActiveRef.current = true;
    const map = mapRef.current;
    const series = latestDataRef.current;
    if (!map || !series.length) return;

    if (!exportCameraBaseRef.current) {
      exportCameraBaseRef.current = planExportCameraBase({
        currentCamera: readMapCameraState(map),
        currentZoom: map.getZoom() ?? undefined,
        currentTilt: map.getTilt() ?? undefined,
        currentHeading: map.getHeading() ?? undefined,
        forceFollowSelection,
      });
    }

    const nextCamera = planExportCameraFrame({
      frame,
      series,
      baseCamera: exportCameraBaseRef.current,
    });
    if (nextCamera) moveMapCamera(map, nextCamera);
  }, [forceFollowSelection]);

  useImperativeHandle(ref, () => ({
    getCaptureCanvas,
    startCaptureSession: (options) => createCaptureSession(divRef.current, {
      preferDirectCanvas: interleaved,
      watermarkText: options?.watermarkText,
      captureFps: options?.captureFps,
      frameOverlayLines: options?.frameOverlayLines,
    }),
    waitForVisualReady: async (options) => {
      syncOverlayRef.current?.();
      requestOverlayRedraw(overlayRef.current);
      await waitForNextAnimationFrame();
      await waitForMapIdle(mapRef.current, getVisualReadyIdleTimeoutMs(forceFollowSelection, options));
      syncOverlayRef.current?.();
      requestOverlayRedraw(overlayRef.current);
      await waitForAnimationFrames(options?.forExport ? 3 : 2);
    },
    setExportCameraFrame,
  }), [forceFollowSelection, getCaptureCanvas, interleaved, setExportCameraFrame]);

  useEffect(() => {
    if (!divRef.current) return;
    let cancelled = false;
    const element = divRef.current;
    const handleMapsWebGlUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (!isGoogleMapsWebGlInternalError(event.reason)) return;
      event.preventDefault();
      logWarning("Google Maps WebGL initialization failed; continuing without surfacing an uncaught promise.", undefined, event.reason);
    };
    window.addEventListener("unhandledrejection", handleMapsWebGlUnhandledRejection);

    let localMap: google.maps.Map | null = null;
    let localOverlay: GoogleMapsOverlay | null = null;
    let listeners: google.maps.MapsEventListener[] = [];

    (async () => {
      const loader = getMapsLoader();
      const mapsLib = await loader.importLibrary("maps");
      if (cancelled || divRef.current !== element) return;

      const mapId = normalizeGoogleMapId(import.meta.env.VITE_GOOGLE_MAP_ID);
      if (!mapId) {
        logWarning("VITE_GOOGLE_MAP_ID is not configured with a valid vector map id; rendering the base map without the 3D overlay.");
      }

      const currentSeries = latestDataRef.current;
      const firstPoint = currentSeries[0];
      const resolvedCenter = (typeof defaultCenterLat === "number" && typeof defaultCenterLng === "number")
        ? { lat: defaultCenterLat, lng: defaultCenterLng }
        : FALLBACK_CENTER;
      const initialDefaultZoom = initialDefaultZoomRef.current;
      const resolvedZoom = initialDefaultZoom ?? FALLBACK_ZOOM;
      const defaultCenter = firstPoint ? { lat: firstPoint.lat, lng: firstPoint.lon } : resolvedCenter;
      const defaultInitialZoom = firstPoint ? (initialDefaultZoom ?? 15) : resolvedZoom;
      const defaultInitialTilt = firstPoint ? 67.5 : 0;
      const savedCamera = cameraStateRef.current;
      const center = savedCamera?.center ?? defaultCenter;
      const initialZoom = savedCamera?.zoom ?? defaultInitialZoom;
      const initialTilt = savedCamera?.tilt ?? defaultInitialTilt;
      const initialHeading = savedCamera?.heading ?? 0;

      const MapCtor = mapsLib.Map as typeof google.maps.Map;
      const map = new MapCtor(element, {
        ...(mapId ? { mapId } : {}),
        colorScheme: appearance === "dark" ? "DARK" : "LIGHT",
        center,
        zoom: initialZoom,
        tilt: initialTilt,
        heading: initialHeading,
        gestureHandling: "greedy",
        disableDefaultUI: true,
        keyboardShortcuts: true,
      }) as google.maps.Map;
      localMap = map;
      if (cancelled || divRef.current !== element) return;
      mapRef.current = map;

      const markUserControl = () => { hasUserControlRef.current = true; };
      const handleMapZoomChange = () => {
        markUserControl();
        const zoom = map.getZoom();
        if (typeof zoom === "number" && Number.isFinite(zoom)) {
          emitZoomChange(zoom);
        }
      };
      listeners = [
        map.addListener("dragstart", markUserControl),
        map.addListener("zoom_changed", handleMapZoomChange),
        map.addListener("tilt_changed", markUserControl),
        map.addListener("heading_changed", markUserControl)
      ];

      type MapWithCapabilities = google.maps.Map & {
        getMapCapabilities?: () => { isWebGLOverlayViewAvailable?: boolean };
      };
      if (!mapId) return;
      const deckClass = GoogleMapsOverlay as unknown as { isSupported?: () => boolean | Promise<boolean> };
      const overlaySupported = typeof deckClass.isSupported === "function"
        ? !!(await deckClass.isSupported())
        : !!(map as MapWithCapabilities).getMapCapabilities?.().isWebGLOverlayViewAvailable;
      if (cancelled || divRef.current !== element) return;

      if (!overlaySupported) {
        logWarning("WebGLOverlayView is not supported in this environment; falling back to standard map rendering.");
        return;
      }

      const sphereGeometry = sphereGeometryRef.current ?? new SphereGeometry({ radius: 1, nlat: 24, nlong: 24 });
      sphereGeometryRef.current = sphereGeometry;
      const overlay = new GoogleMapsOverlay({
        layers: createLayers(
          currentSeries,
          selectedIndexRef.current,
          handleSelectIndex,
          handleSelectPoint,
          sphereGeometry,
          showAllMode,
          playbackPathMode
        ),
        interleaved
      });
      guardOverlayLifecycle(overlay);
      localOverlay = overlay;
      try {
        overlay.setMap(map);
      }
      catch (error) {
        logWarning("Unable to attach the 3D map overlay; continuing with the base map.", undefined, error);
        if (typeof overlay.finalize === "function") overlay.finalize();
        return;
      }
      if (cancelled) {
        overlay.setMap(null);
        if (typeof overlay.finalize === "function") overlay.finalize();
        return;
      }

      if (currentSeries.length && typeof map.moveCamera === "function") {
        map.moveCamera({
          center,
          tilt: savedCamera?.tilt ?? 67.5,
          heading: initialHeading,
          zoom: savedCamera?.zoom ?? initialDefaultZoom ?? 18,
        });
      }
      overlayRef.current = overlay;
      syncOverlayRef.current?.();
    })().catch((error: unknown) => {
      if (cancelled) return;
      logError("Unable to initialize the 3D map.", undefined, error);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("unhandledrejection", handleMapsWebGlUnhandledRejection);
      cameraStateRef.current = readMapCameraState(localMap ?? mapRef.current);
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.setMap(null);
        if (typeof overlay.finalize === "function") overlay.finalize();
      }
      listeners.forEach((listener) => {
        if (typeof listener.remove === "function") listener.remove();
      });
      listeners = [];
      if (overlayRef.current === localOverlay) overlayRef.current = null;
      if (mapRef.current === localMap) mapRef.current = null;
    };
  }, [appearance, defaultCenterLat, defaultCenterLng, interleaved, playbackPathMode, showAllMode]);

  return <div ref={divRef} style={{ width: "100%", height: "100%" }} />;
});

Map3D.displayName = "Map3D";

export default Map3D;
