import { useEffect, useRef } from "react";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { HeatmapLayer, GridLayer } from "@deck.gl/aggregation-layers";
import { PathLayer } from "@deck.gl/layers";
import { SimpleMeshLayer } from "@deck.gl/mesh-layers";
import { SphereGeometry } from "@luma.gl/engine";
import type { Layer } from "@deck.gl/core";
import { getMapsLoader } from "../lib/mapsLoader";

type MeasurementPoint = {
  lat: number;
  lon: number;
  timestamp: number;
  value: number;
  precision: number | null;
  altitude: number | null;
};

type HeatmapPoint = {
  lat: number;
  lon: number;
  value: number;
};

type Map3DProps = {
  data: MeasurementPoint[];
  selectedIndex: number;
  onSelectIndex?: (index: number) => void;
  heatmap?: HeatmapPoint[] | null;
  heatmapMode?: "heatmap" | "grid";
};

const FALLBACK_CENTER = { lat: 45.5, lng: -122.67 };
const HEATMAP_COLOR_RANGE: [number, number, number, number][] = [
  [33, 102, 172, 90],
  [67, 147, 195, 120],
  [146, 197, 222, 160],
  [209, 229, 240, 200],
  [253, 219, 199, 220],
  [239, 138, 98, 240],
  [178, 24, 43, 255]
];
const DEFAULT_HEATMAP_RADIUS = 48;
const GRID_LAYER_CELL_SIZE_METERS = 15000;
type PathDatum = { path: [number, number, number][] };

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

const PIXEL_RATIO_EPSILON = 0.05;
const LINUX_PIXEL_RATIO_CAP = 1.25;
const DEFAULT_PIXEL_RATIO_CAP = 1.75;

function readUserAgent(): string {
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") return "";
  return navigator.userAgent.toLowerCase();
}

function resolvePreferredDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  const baseRatio = Math.max(1, Number(window.devicePixelRatio) || 1);
  const ua = readUserAgent();
  const prefersReducedMotion = typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
  if (prefersReducedMotion) return 1;
  if (ua.includes("wayland")) return 1;
  if (ua.includes("linux")) return Math.min(baseRatio, LINUX_PIXEL_RATIO_CAP);
  return Math.min(baseRatio, DEFAULT_PIXEL_RATIO_CAP);
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
  heatmapPoints: HeatmapPoint[] | undefined,
  heatmapMode: "heatmap" | "grid",
  selectedIndex: number,
  onSelectIndex: ((index: number) => void) | undefined,
  sphereGeometry: SphereGeometry
): Layer[] {
  const layers: Layer[] = [];

  if (heatmapPoints && heatmapPoints.length) {
    let minHeat = Infinity;
    let maxHeat = -Infinity;
    for (const point of heatmapPoints) {
      if (point.value < minHeat) minHeat = point.value;
      if (point.value > maxHeat) maxHeat = point.value;
    }
    const [heatMin, heatMax] = ensureRange(minHeat, maxHeat);
    if (heatmapMode === "grid") {
      layers.push(new GridLayer<HeatmapPoint>({
        id: "pm25-grid-layer",
        data: heatmapPoints,
        cellSize: GRID_LAYER_CELL_SIZE_METERS,
        getPosition: (d) => [d.lon, d.lat],
        getColorWeight: (d) => d.value,
        colorAggregation: "MEAN",
        colorDomain: [heatMin, heatMax],
        colorRange: HEATMAP_COLOR_RANGE,
        getElevationWeight: (d) => d.value,
        elevationAggregation: "MEAN",
        elevationDomain: [heatMin, heatMax],
        elevationScale: 200,
        extruded: true,
        pickable: false,
        // Google Maps' WebGL overlay regularly lacks the drawBuffers extension, so
        // forcing GPU aggregation raises INVALID_OPERATION warnings in the console.
        // Stay on the CPU path for compatibility.
        gpuAggregation: false
      }));
    }
    else {
      layers.push(new HeatmapLayer<HeatmapPoint>({
        id: "pm25-heatmap-layer",
        data: heatmapPoints,
        getPosition: (d) => [d.lon, d.lat],
        getWeight: (d) => d.value,
        radiusPixels: DEFAULT_HEATMAP_RADIUS,
        intensity: 1,
        colorRange: HEATMAP_COLOR_RANGE,
        colorDomain: [heatMin, heatMax],
        aggregation: "SUM",
        threshold: 0.05,
        pickable: false,
        // See note above; disable GPU aggregation to avoid unsupported drawBuffers usage.
        gpuAggregation: false
      }));
    }
  }

  if (!series.length) return layers;

  let min = Infinity;
  let max = -Infinity;
  for (const point of series) {
    if (point.value < min) min = point.value;
    if (point.value > max) max = point.value;
  }
  const [scaledMin, scaledMax] = ensureRange(min, max);
  const pathPoints = series.map((point) => [point.lon, point.lat, 0]);
  const selected = series[selectedIndex] ?? series[series.length - 1];

  layers.push(new PathLayer<PathDatum>({
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
  }));

  layers.push(new SimpleMeshLayer<MeasurementPoint & { index: number }>({
    id: "measurement-sphere",
    data: selected ? [{ ...selected, index: selectedIndex }] : [],
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
  }));

  return layers;
}

export default function Map3D({ data, selectedIndex, onSelectIndex, heatmap, heatmapMode = "heatmap" }: Map3DProps) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const latestDataRef = useRef<MeasurementPoint[]>(data);
  const heatmapDataRef = useRef<HeatmapPoint[]>(heatmap ?? []);
  const heatmapModeRef = useRef<"heatmap" | "grid">(heatmapMode ?? "heatmap");
  const selectedIndexRef = useRef<number>(selectedIndex);
  const onSelectRef = useRef<typeof onSelectIndex>(onSelectIndex);
  const sphereGeometryRef = useRef<SphereGeometry | null>(null);
  const hasUserControlRef = useRef(false);
  const dataSignatureRef = useRef(signature(data));
  const devicePixelRatioRef = useRef(resolvePreferredDevicePixelRatio());

  useEffect(() => { latestDataRef.current = data; }, [data]);
  useEffect(() => { heatmapDataRef.current = heatmap ?? []; }, [heatmap]);
  useEffect(() => { heatmapModeRef.current = heatmapMode ?? "heatmap"; }, [heatmapMode]);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);
  useEffect(() => { onSelectRef.current = onSelectIndex; }, [onSelectIndex]);
  useEffect(() => {
    const sig = signature(data);
    if (dataSignatureRef.current !== sig) {
      dataSignatureRef.current = sig;
      hasUserControlRef.current = false;
    }
  }, [data]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateRatio = () => {
      const next = resolvePreferredDevicePixelRatio();
      if (Math.abs(next - devicePixelRatioRef.current) < PIXEL_RATIO_EPSILON) return;
      devicePixelRatioRef.current = next;
      if (overlayRef.current) {
        overlayRef.current.setProps({ useDevicePixels: next });
      }
    };
    updateRatio();
    window.addEventListener("resize", updateRatio);
    window.addEventListener("orientationchange", updateRatio);
    return () => {
      window.removeEventListener("resize", updateRatio);
      window.removeEventListener("orientationchange", updateRatio);
    };
  }, []);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (!sphereGeometryRef.current) {
      sphereGeometryRef.current = new SphereGeometry({ radius: 1, nlat: 24, nlong: 24 });
    }

    overlay.setProps({
      layers: createLayers(
        latestDataRef.current,
        heatmapDataRef.current,
        heatmapModeRef.current,
        selectedIndexRef.current,
        (index) => onSelectRef.current?.(index),
        sphereGeometryRef.current
      ),
      useDevicePixels: devicePixelRatioRef.current
    });

    const series = latestDataRef.current;
    const current = series[selectedIndexRef.current] ?? series[0];
    if (current) {
      const center = { lat: current.lat, lng: current.lon };
      const map = mapRef.current;
      if (map && !hasUserControlRef.current) {
        if (typeof map.moveCamera === "function") map.moveCamera({ center, zoom: Math.max(map.getZoom() ?? 17, 16) });
        else {
          map.setCenter(center);
          map.setZoom(Math.max(map.getZoom() ?? 17, 16));
        }
      }
    }
  }, [data, selectedIndex, heatmap, heatmapMode]);

  useEffect(() => {
    if (!divRef.current) return;
    let cancelled = false;
    const element = divRef.current;

    let listeners: google.maps.MapsEventListener[] = [];

    (async () => {
      const loader = getMapsLoader();
      const [mapsLib, maps3dLib] = await Promise.all([
        loader.importLibrary("maps"),
        loader.importLibrary("maps3d").catch(() => null)
      ]);
      if (cancelled) return;

      const mapId = import.meta.env.VITE_GOOGLE_MAP_ID;
      if (!mapId) {
        console.error("VITE_GOOGLE_MAP_ID is not configured; unable to initialize WebGL overlay.");
        return;
      }

      const currentSeries = latestDataRef.current;
      const firstPoint = currentSeries[0];
      const center = firstPoint ? { lat: firstPoint.lat, lng: firstPoint.lon } : FALLBACK_CENTER;

      const MapCtor = mapsLib.Map as typeof google.maps.Map;
      const map = new MapCtor(element, {
        mapId,
        center,
        zoom: 15,
        tilt: 67.5,
        heading: 0,
        gestureHandling: "greedy"
      }) as google.maps.Map;
      if (cancelled) return;
      mapRef.current = map;
      map.setOptions({
        streetViewControl: false,
        rotateControl: true,
        mapTypeControl: false,
        keyboardShortcuts: true
      });

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
        : !!(map as MapWithCapabilities).getMapCapabilities?.().isWebGLOverlayViewAvailable
          || maps3dLib !== null;

      if (!overlaySupported) {
        console.warn("WebGLOverlayView is not supported in this environment; falling back to standard map rendering.");
        return;
      }

      const sphereGeometry = sphereGeometryRef.current ?? new SphereGeometry({ radius: 1, nlat: 24, nlong: 24 });
      sphereGeometryRef.current = sphereGeometry;
      const overlay = new GoogleMapsOverlay({
        layers: createLayers(
          currentSeries,
          heatmapDataRef.current,
          heatmapModeRef.current,
          selectedIndexRef.current,
          (index) => onSelectRef.current?.(index),
          sphereGeometry
        ),
        useDevicePixels: devicePixelRatioRef.current
      });
      overlay.setMap(map);

      if (typeof map.moveCamera === "function") {
        map.moveCamera({ tilt: 67.5, heading: 0, zoom: 18 });
      }
      overlayRef.current = overlay;
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
  }, []);

  return <div ref={divRef} style={{ width: "100%", height: "80vh" }} />;
}
