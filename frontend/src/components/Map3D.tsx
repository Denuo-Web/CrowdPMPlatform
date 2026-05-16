import { forwardRef, useCallback, useEffect, useEffectEvent, useImperativeHandle, useRef } from "react";
import type { UserThemeAppearance } from "@crowdpm/types";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { SphereGeometry } from "@luma.gl/engine";
import type { Layer } from "@deck.gl/core";
import { getMapsLoader, normalizeGoogleMapId } from "../lib/mapsLoader";
import { logError, logWarning } from "../lib/logger";
import {
  planExportCameraBase,
  planExportCameraFrame,
  planSelectionCamera,
  type CameraState,
} from "../lib/mapCamera";
import {
  createCaptureSession,
  pickLargestCaptureCanvas,
  type Map3DCaptureOptions,
  type Map3DCaptureSession,
} from "./map3dCapture";

export type { Map3DCaptureSession } from "./map3dCapture";

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
