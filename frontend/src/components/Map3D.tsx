import { useEffect, useRef } from "react";
import * as THREE from "three";
import { ThreeJSOverlayView, type ThreeJSOverlayViewOptions } from "@googlemaps/three";
import { getMapsLoader } from "../lib/mapsLoader";

type MeasurementPoint = { lat: number; lon: number; timestamp: number; value: number };
const FALLBACK_CENTER = { lat: 45.5, lng: -122.67 };

class LineOverlay extends ThreeJSOverlayView {
  private line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial> | null = null;
  private positions: THREE.BufferAttribute | null = null;
  private colors: THREE.BufferAttribute | null = null;
  private readonly tempVec = new THREE.Vector3();
  private capacity = 0;
  private series: MeasurementPoint[] = [];
  private needsRefresh = false;

  constructor(options: ThreeJSOverlayViewOptions) {
    super({ addDefaultLighting: false, ...options });
  }

  setSeries(points: MeasurementPoint[]) {
    this.series = points;
    this.ensureCapacity(points.length);
    this.needsRefresh = true;
    this.requestRedraw();
  }

  updateAnchor(anchor: google.maps.LatLngLiteral) {
    this.setAnchor({ ...anchor, altitude: 0 });
    this.needsRefresh = true;
    this.requestRedraw();
  }

  private ensureCapacity(size: number) {
    const required = Math.max(2, size);
    if (this.line && required <= this.capacity) return;

    if (this.line) {
      this.scene.remove(this.line);
      this.line.geometry.dispose();
      const material = this.line.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material.dispose();
      this.line = null;
      this.positions = null;
      this.colors = null;
    }

    this.capacity = required;
    const geometry = new THREE.BufferGeometry();
    this.positions = new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3);
    this.colors = new THREE.BufferAttribute(new Float32Array(this.capacity * 3), 3);
    geometry.setAttribute("position", this.positions);
    geometry.setAttribute("color", this.colors);
    geometry.setDrawRange(0, 0);

    this.line = new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true })
    );
    this.scene.add(this.line);
  }

  private refreshGeometry() {
    if (!this.line || !this.positions || !this.colors) return;

    const count = this.series.length;
    if (count < 2) {
      this.line.geometry.setDrawRange(0, 0);
      this.positions.needsUpdate = true;
      this.colors.needsUpdate = true;
      return;
    }

    let mn = Infinity;
    let mx = -Infinity;
    for (const point of this.series) {
      if (point.value < mn) mn = point.value;
      if (point.value > mx) mx = point.value;
    }
    const span = Math.max(1e-6, mx - mn);

    const positions = this.positions;
    const colors = this.colors;
    if (!positions || !colors) return;

    this.series.forEach((point, idx) => {
      const vec = this.latLngAltitudeToVector3(
        { lat: point.lat, lng: point.lon, altitude: 0 },
        this.tempVec
      );
      positions.setXYZ(idx, vec.x, vec.y, vec.z);
      const t = (point.value - mn) / span;
      const r = t <= 0.5 ? t / 0.5 : 1;
      const g = t <= 0.5 ? 1 : 1 - (t - 0.5) / 0.5;
      colors.setXYZ(idx, r, g, 0);
    });

    this.line.geometry.setDrawRange(0, count);
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    if (count >= 2) {
      (this.line.geometry as THREE.BufferGeometry).computeBoundingSphere();
    }
  }

  override onBeforeDraw(): void {
    if (!this.needsRefresh) return;
    this.refreshGeometry();
    this.needsRefresh = false;
  }

  override onRemove(): void {
    if (!this.line) return;
    this.scene.remove(this.line);
    this.line.geometry.dispose();
    const material = this.line.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material.dispose();
    this.line = null;
    this.positions = null;
    this.colors = null;
    this.capacity = 0;
  }
}

export default function Map3D({ data }: { data: MeasurementPoint[] }) {
  const divRef = useRef<HTMLDivElement|null>(null);
  const mapRef = useRef<google.maps.Map|null>(null);
  const overlayRef = useRef<LineOverlay|null>(null);
  const latestDataRef = useRef<MeasurementPoint[]>(data);

  useEffect(() => {
    latestDataRef.current = data;
    const overlay = overlayRef.current;
    if (!overlay) return;

    overlay.setSeries(data);
    if (data[0]) {
      const center = { lat: data[0].lat, lng: data[0].lon };
      overlay.updateAnchor(center);
      const map = mapRef.current;
      if (map) {
        if (typeof map.moveCamera === "function") map.moveCamera({ center });
        else map.setCenter(center);
      }
    }
  }, [data]);

  useEffect(() => {
    if (!divRef.current) return;
    let cancelled = false;
    const element = divRef.current;

    (async () => {
      const loader = getMapsLoader();
      const [{ Map, WebGLOverlayView }] = await Promise.all([
        loader.importLibrary("maps"),
        loader.importLibrary("maps3d"),
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

      const map = new Map(element, {
        mapId,
        center,
        zoom: 15,
        tilt: 67.5,
      }) as google.maps.Map;
      if (cancelled) return;
      mapRef.current = map;

      type MapWithCapabilities = google.maps.Map & {
        getMapCapabilities?: () => { isWebGLOverlayViewAvailable?: boolean };
      };
      const staticSupportCheck = (WebGLOverlayView as unknown as { isSupported?: () => boolean | Promise<boolean> }).isSupported;
      const overlaySupported = typeof staticSupportCheck === "function"
        ? !!(await staticSupportCheck.call(WebGLOverlayView))
        : !!(map as MapWithCapabilities).getMapCapabilities?.().isWebGLOverlayViewAvailable;

      if (!overlaySupported) {
        console.warn("WebGLOverlayView is not supported in this environment; falling back to standard map rendering.");
        return;
      }

      const overlay = new LineOverlay({
        map,
        anchor: { ...center, altitude: 0 },
      });
      overlay.setSeries(currentSeries);
      if (typeof map.moveCamera === "function") {
        map.moveCamera({ tilt: 67.5, heading: 0, zoom: 18 });
      }
      overlayRef.current = overlay;
    })();

    return () => {
      cancelled = true;
      overlayRef.current?.setMap(null as unknown as google.maps.Map);
      overlayRef.current = null;
      mapRef.current = null;
    };
  }, []);

  return <div ref={divRef} style={{ width:"100%", height:"80vh" }} />;
}
