export type CameraPoint = {
  lat: number;
  lon: number;
};

export type CameraState = {
  center: { lat: number; lng: number };
  zoom?: number;
  tilt?: number;
  heading?: number;
};

export type CameraScreenOffset = {
  x?: number;
  y?: number;
};

export type ExportCameraFrame = {
  fromIndex: number;
  toIndex: number;
  progress: number;
  headingOffsetDeg?: number;
  tilt?: number;
  zoom?: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 1);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number): number {
  const clamped = clamp01(t);
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
}

function clampLatitude(lat: number): number {
  return Math.min(Math.max(lat, -85.05112878), 85.05112878);
}

function pointToWorldPixels(point: CameraPoint, zoom: number): { x: number; y: number } {
  const sinLat = Math.sin((clampLatitude(point.lat) * Math.PI) / 180);
  const scale = 256 * (2 ** zoom);
  return {
    x: ((point.lon + 180) / 360) * scale,
    y: (0.5 - (Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI))) * scale,
  };
}

function worldPixelsToCenter(point: { x: number; y: number }, zoom: number): { lat: number; lng: number } {
  const scale = 256 * (2 ** zoom);
  const lng = ((point.x / scale) * 360) - 180;
  const mercatorY = 0.5 - (point.y / scale);
  const lat = 90 - ((360 * Math.atan(Math.exp(-mercatorY * 2 * Math.PI))) / Math.PI);
  return { lat: clampLatitude(lat), lng };
}

function offsetCameraCenter(point: CameraPoint, zoom: number, offset?: CameraScreenOffset): { lat: number; lng: number } {
  const offsetX = offset?.x ?? 0;
  const offsetY = offset?.y ?? 0;
  if (!offsetX && !offsetY) {
    return { lat: point.lat, lng: point.lon };
  }

  const worldPoint = pointToWorldPixels(point, zoom);
  return worldPixelsToCenter({
    x: worldPoint.x + offsetX,
    y: worldPoint.y + offsetY,
  }, zoom);
}

export function planSelectionCamera(args: {
  point: CameraPoint;
  currentZoom: number | undefined;
  currentTilt: number | undefined;
  forceFollowSelection: boolean;
  screenOffset?: CameraScreenOffset;
}): CameraState {
  const targetZoom = args.forceFollowSelection
    ? Math.max(args.currentZoom ?? 18, 18)
    : Math.max(args.currentZoom ?? 17, 16);
  const targetTilt = (args.currentTilt ?? 0) < 10 ? 67.5 : undefined;
  return {
    center: offsetCameraCenter(args.point, targetZoom, args.screenOffset),
    zoom: targetZoom,
    tilt: targetTilt,
  };
}

export function planExportCameraBase(args: {
  currentCamera: CameraState | null;
  currentZoom: number | undefined;
  currentTilt: number | undefined;
  currentHeading: number | undefined;
  forceFollowSelection: boolean;
}): Required<Pick<CameraState, "zoom" | "tilt" | "heading">> {
  return {
    zoom: Math.max(args.currentCamera?.zoom ?? args.currentZoom ?? 18, args.forceFollowSelection ? 18 : 16),
    tilt: args.currentCamera?.tilt ?? args.currentTilt ?? 67.5,
    heading: args.currentCamera?.heading ?? args.currentHeading ?? 0,
  };
}

export function planExportCameraFrame(args: {
  frame: ExportCameraFrame;
  series: CameraPoint[];
  baseCamera: Required<Pick<CameraState, "zoom" | "tilt" | "heading">>;
}): CameraState | null {
  if (!args.series.length) return null;
  const maxIndex = args.series.length - 1;
  const fromIndex = Math.min(Math.max(Math.round(args.frame.fromIndex), 0), maxIndex);
  const toIndex = Math.min(Math.max(Math.round(args.frame.toIndex), 0), maxIndex);
  const from = args.series[fromIndex];
  const to = args.series[toIndex] ?? from;
  if (!from || !to) return null;

  const easedProgress = easeInOutCubic(args.frame.progress);
  return {
    center: {
      lat: lerp(from.lat, to.lat, easedProgress),
      lng: lerp(from.lon, to.lon, easedProgress),
    },
    zoom: args.frame.zoom ?? args.baseCamera.zoom,
    tilt: args.frame.tilt ?? (args.baseCamera.tilt < 10 ? 67.5 : args.baseCamera.tilt),
    heading: args.baseCamera.heading + (args.frame.headingOffsetDeg ?? 0),
  };
}
