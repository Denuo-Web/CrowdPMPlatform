import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { SphereGeometry } from "@luma.gl/engine";
import type { Layer } from "@deck.gl/core";
import { getMapsLoader } from "../lib/mapsLoader";
import { canCaptureCanvas } from "../lib/videoExport";

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
  stop: () => void;
};

export type Map3DHandle = {
  getCaptureCanvas: () => HTMLCanvasElement | null;
  startCaptureSession: () => Promise<Map3DCaptureSession | null>;
  waitForVisualReady: () => Promise<void>;
};

type Map3DProps = {
  data: MeasurementPoint[];
  selectedIndex: number;
  onSelectIndex?: (index: number) => void;
  onSelectPoint?: (point: MeasurementPoint) => void;
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
        const radiusMeters = Math.max(0.5, (d.precision ?? 20) / 2);
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
      const radiusMeters = Math.max(0.5, (d.precision ?? 20) / 2);
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
    if (area > bestArea) {
      best = canvas;
      bestArea = area;
    }
  });

  return best;
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

function createCompositeCaptureSession(root: HTMLDivElement | null): Map3DCaptureSession | null {
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

  let disposed = false;
  let rafId = 0;

  const drawFrame = () => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(drawFrame);

    const currentRootRect = root.getBoundingClientRect();
    const originLeft = currentRootRect.width > 0 ? currentRootRect.left : (fallbackRect?.left ?? 0);
    const originTop = currentRootRect.height > 0 ? currentRootRect.top : (fallbackRect?.top ?? 0);

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    context.scale(dpr, dpr);

    getVisibleCanvases(root).sort(compareCanvasOrder).forEach((canvas) => {
      const rect = canvas.getBoundingClientRect();
      const dx = rect.left - originLeft;
      const dy = rect.top - originTop;
      try {
        context.drawImage(canvas, dx, dy, rect.width, rect.height);
      }
      catch (err) {
        console.warn("Unable to composite map canvas layer for export.", err);
      }
    });
  };

  drawFrame();

  return {
    canvas: compositeCanvas,
    stop: () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
    },
  };
}

async function createStreamBackedCaptureSession(root: HTMLDivElement | null): Promise<Map3DCaptureSession | null> {
  if (!root) return null;

  const canvases = getVisibleCanvases(root).sort(compareCanvasOrder);
  if (!canvases.length) return null;

  const baseCanvas = pickLargestCaptureCanvas(root);
  if (!baseCanvas || !canCaptureCanvas(baseCanvas)) {
    return createCompositeCaptureSession(root);
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

  let baseStream: MediaStream;
  try {
    baseStream = baseCanvas.captureStream(30);
  }
  catch {
    return createCompositeCaptureSession(root);
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
    return createCompositeCaptureSession(root);
  }

  let disposed = false;
  let rafId = 0;

  const drawFrame = () => {
    if (disposed) return;
    rafId = window.requestAnimationFrame(drawFrame);

    const currentRootRect = root.getBoundingClientRect();
    const originLeft = currentRootRect.width > 0 ? currentRootRect.left : baseRect.left;
    const originTop = currentRootRect.height > 0 ? currentRootRect.top : baseRect.top;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, compositeCanvas.width, compositeCanvas.height);
    context.scale(dpr, dpr);

    const currentBaseRect = baseCanvas.getBoundingClientRect();
    const baseDx = currentBaseRect.left - originLeft;
    const baseDy = currentBaseRect.top - originTop;
    if (baseVideo.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      context.drawImage(baseVideo, baseDx, baseDy, currentBaseRect.width, currentBaseRect.height);
    }

    getVisibleCanvases(root).sort(compareCanvasOrder).forEach((canvas) => {
      if (canvas === baseCanvas) return;
      const rect = canvas.getBoundingClientRect();
      const dx = rect.left - originLeft;
      const dy = rect.top - originTop;
      try {
        context.drawImage(canvas, dx, dy, rect.width, rect.height);
      }
      catch (err) {
        console.warn("Unable to composite map canvas layer for export.", err);
      }
    });
  };

  drawFrame();

  return {
    canvas: compositeCanvas,
    stop: () => {
      disposed = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      baseVideo.pause();
      baseVideo.srcObject = null;
      baseStream.getTracks().forEach((track) => track.stop());
    },
  };
}

const Map3D = forwardRef<Map3DHandle, Map3DProps>(function Map3D({
  data,
  selectedIndex,
  onSelectIndex,
  onSelectPoint,
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
  const onSelectRef = useRef<typeof onSelectIndex>(onSelectIndex);
  const onSelectPointRef = useRef<typeof onSelectPoint>(onSelectPoint);
  const showAllModeRef = useRef(showAllMode);
  const playbackPathModeRef = useRef(playbackPathMode);
  const sphereGeometryRef = useRef<SphereGeometry | null>(null);
  const hasUserControlRef = useRef(false);
  const dataSignatureRef = useRef(signature(data));
  const defaultCenterLat = defaultCenter?.lat;
  const defaultCenterLng = defaultCenter?.lng;
  const syncOverlayRef = useRef<((options?: { forceCenter?: boolean }) => void) | null>(null);

  useEffect(() => { latestDataRef.current = data; }, [data]);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);
  useEffect(() => { onSelectRef.current = onSelectIndex; }, [onSelectIndex]);
  useEffect(() => { onSelectPointRef.current = onSelectPoint; }, [onSelectPoint]);
  useEffect(() => { showAllModeRef.current = showAllMode; }, [showAllMode]);
  useEffect(() => { playbackPathModeRef.current = playbackPathMode; }, [playbackPathMode]);
  useEffect(() => {
    const sig = signature(data);
    if (dataSignatureRef.current !== sig) {
      dataSignatureRef.current = sig;
      hasUserControlRef.current = false;
    }
  }, [data]);

  const getCaptureCanvas = useCallback(
    () => pickLargestCaptureCanvas(divRef.current),
    []
  );

  useImperativeHandle(ref, () => ({
    getCaptureCanvas,
    startCaptureSession: () => createStreamBackedCaptureSession(divRef.current),
    waitForVisualReady: async () => {
      await waitForNextAnimationFrame();
      await waitForMapIdle(mapRef.current, forceFollowSelection ? 450 : 250);
      await waitForAnimationFrames(2);
    },
  }), [forceFollowSelection, getCaptureCanvas]);

  const syncOverlay = useCallback((options?: { forceCenter?: boolean }) => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!sphereGeometryRef.current) {
      sphereGeometryRef.current = new SphereGeometry({ radius: 1, nlat: 24, nlong: 24 });
    }

    overlay.setProps({
      layers: createLayers(
        latestDataRef.current,
        selectedIndexRef.current,
        (index) => onSelectRef.current?.(index),
        (point) => onSelectPointRef.current?.(point),
        sphereGeometryRef.current,
        showAllMode,
        playbackPathMode
      )
    });

    const series = latestDataRef.current;
    const current = series[selectedIndexRef.current] ?? series[0];
    if (current) {
      const center = { lat: current.lat, lng: current.lon };
      const map = mapRef.current;
      if (map && (!hasUserControlRef.current || options?.forceCenter || forceFollowSelection)) {
        const targetZoom = forceFollowSelection
          ? Math.max(map.getZoom() ?? 18, 18)
          : Math.max(map.getZoom() ?? 17, 16);
        const currentTilt = map.getTilt() ?? 0;
        const targetTilt = currentTilt < 10 ? 67.5 : undefined;
        if (typeof map.moveCamera === "function") map.moveCamera({ center, zoom: targetZoom, tilt: targetTilt });
        else {
          map.setCenter(center);
          map.setZoom(targetZoom);
          if (targetTilt !== undefined) map.setTilt(targetTilt);
        }
      }
    }
  }, [forceFollowSelection, playbackPathMode, showAllMode]);

  useEffect(() => {
    syncOverlayRef.current = syncOverlay;
  }, [syncOverlay]);

  useEffect(() => {
    syncOverlay();
  }, [data, selectedIndex, syncOverlay]);

  useEffect(() => {
    if (!autoCenterKey) return;
    hasUserControlRef.current = false;
    syncOverlay({ forceCenter: true });
  }, [autoCenterKey, syncOverlay]);

  useEffect(() => {
    if (!divRef.current) return;
    let cancelled = false;
    const element = divRef.current;

    let listeners: google.maps.MapsEventListener[] = [];

    (async () => {
      const loader = getMapsLoader();
      const mapsLib = await loader.importLibrary("maps");
      if (cancelled) return;

      const mapId = import.meta.env.VITE_GOOGLE_MAP_ID;
      if (!mapId) {
        console.error("VITE_GOOGLE_MAP_ID is not configured; unable to initialize WebGL overlay.");
        return;
      }

      const currentSeries = latestDataRef.current;
      const firstPoint = currentSeries[0];
      const resolvedCenter = (typeof defaultCenterLat === "number" && typeof defaultCenterLng === "number")
        ? { lat: defaultCenterLat, lng: defaultCenterLng }
        : FALLBACK_CENTER;
      const resolvedZoom = defaultZoom ?? FALLBACK_ZOOM;
      const center = firstPoint ? { lat: firstPoint.lat, lng: firstPoint.lon } : resolvedCenter;
      const initialZoom = firstPoint ? 15 : resolvedZoom;
      const initialTilt = firstPoint ? 67.5 : 0;

      const MapCtor = mapsLib.Map as typeof google.maps.Map;
      const map = new MapCtor(element, {
        mapId,
        center,
        zoom: initialZoom,
        tilt: initialTilt,
        heading: 0,
        gestureHandling: "greedy",
        disableDefaultUI: true,
        keyboardShortcuts: true,
      }) as google.maps.Map;
      if (cancelled) return;
      mapRef.current = map;

      const markUserControl = () => { hasUserControlRef.current = true; };
      listeners = [
        map.addListener("dragstart", markUserControl),
        map.addListener("zoom_changed", markUserControl),
        map.addListener("tilt_changed", markUserControl),
        map.addListener("heading_changed", markUserControl)
      ];

      type MapWithCapabilities = google.maps.Map & {
        getMapCapabilities?: () => { isWebGLOverlayViewAvailable?: boolean };
      };
      const deckClass = GoogleMapsOverlay as unknown as { isSupported?: () => boolean | Promise<boolean> };
      const overlaySupported = typeof deckClass.isSupported === "function"
        ? !!(await deckClass.isSupported())
        : !!(map as MapWithCapabilities).getMapCapabilities?.().isWebGLOverlayViewAvailable;

      if (!overlaySupported) {
        console.warn("WebGLOverlayView is not supported in this environment; falling back to standard map rendering.");
        return;
      }

      const sphereGeometry = sphereGeometryRef.current ?? new SphereGeometry({ radius: 1, nlat: 24, nlong: 24 });
      sphereGeometryRef.current = sphereGeometry;
      const overlay = new GoogleMapsOverlay({
        layers: createLayers(
          currentSeries,
          selectedIndexRef.current,
          (index) => onSelectRef.current?.(index),
          (point) => onSelectPointRef.current?.(point),
          sphereGeometry,
          showAllModeRef.current,
          playbackPathModeRef.current
        ),
        interleaved
      });
      overlay.setMap(map);

      if (currentSeries.length && typeof map.moveCamera === "function") {
        map.moveCamera({ tilt: 67.5, heading: 0, zoom: 18 });
      }
      overlayRef.current = overlay;
      syncOverlayRef.current?.();
    })();

    return () => {
      cancelled = true;
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.setMap(null);
        if (typeof overlay.finalize === "function") overlay.finalize();
      }
      listeners.forEach((listener) => {
        if (typeof listener.remove === "function") listener.remove();
      });
      listeners = [];
      overlayRef.current = null;
      mapRef.current = null;
    };
  }, [interleaved, defaultCenterLat, defaultCenterLng, defaultZoom]);

  return <div ref={divRef} style={{ width: "100%", height: "100%" }} />;
});

Map3D.displayName = "Map3D";

export default Map3D;
