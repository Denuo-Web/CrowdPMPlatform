import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import type { ServiceConfig } from "./config.js";
import type { BatchDescriptor, Pm25Point } from "./types.js";

type VariableAttribute = { name: string; value: number | number[] | string | string[] };

type NetcdfVariable = {
  name: string;
  attributes: VariableAttribute[];
  dimensions: Array<{ name: string; size: number }>;
};

type NetcdfReader = {
  variables: NetcdfVariable[];
  getDataVariable(name: string): Float32Array | Float64Array | number[];
};

const LAT_NAMES = ["latitude", "lat"];
const LON_NAMES = ["longitude", "lon"];
const require = createRequire(import.meta.url);

function asReader(buffer: ArrayBuffer): NetcdfReader {
  // netcdfjs uses default export `NetCDFReader`
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NetCDFReader } = require("netcdfjs") as { NetCDFReader: new (buf: Buffer) => NetcdfReader };
  return new NetCDFReader(Buffer.from(buffer));
}

function findVariable(reader: NetcdfReader, target: string): NetcdfVariable | null {
  const lowered = target.toLowerCase();
  return reader.variables.find((variable) => variable.name.toLowerCase() === lowered) ?? null;
}

function findByPrefixes(reader: NetcdfReader, candidates: string[]): NetcdfVariable | null {
  for (const candidate of candidates) {
    const match = reader.variables.find((variable) => variable.name.toLowerCase().startsWith(candidate));
    if (match) return match;
  }
  return null;
}

function resolveFillValues(variable: NetcdfVariable): number[] {
  const match = variable.attributes.find((attribute) => attribute.name === "_FillValue" || attribute.name === "missing_value");
  if (!match) return [];
  const value = match.value;
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  if (typeof value === "number") return [value];
  const numeric = Number(value);
  return Number.isFinite(numeric) ? [numeric] : [];
}

function computeStrides(shape: number[]): number[] {
  const strides = Array(shape.length).fill(1);
  for (let idx = shape.length - 2; idx >= 0; idx--) {
    strides[idx] = strides[idx + 1] * shape[idx + 1];
  }
  return strides;
}

function normaliseLongitude(lon: number): number {
  if (!Number.isFinite(lon)) return lon;
  if (lon > 180) return lon - 360;
  if (lon < -180) return lon + 360;
  return lon;
}

function withinBounds(value: number, min: number, max: number): boolean {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return true;
  if (min <= max) return value >= min && value <= max;
  return value >= min || value <= max;
}

export function extractPoints(config: ServiceConfig, descriptor: BatchDescriptor, buffer: ArrayBuffer): Pm25Point[] {
  const reader = asReader(buffer);
  const pmVariable = findVariable(reader, config.CAMS_PM_VARIABLE);
  if (!pmVariable) {
    throw new Error(`NetCDF: variable ${config.CAMS_PM_VARIABLE} not found`);
  }

  const latVariable = findVariable(reader, "latitude") ?? findByPrefixes(reader, LAT_NAMES);
  const lonVariable = findVariable(reader, "longitude") ?? findByPrefixes(reader, LON_NAMES);
  if (!latVariable || !lonVariable) {
    throw new Error("NetCDF: latitude/longitude variables missing");
  }

  const latDataRaw = reader.getDataVariable(latVariable.name);
  const lonDataRaw = reader.getDataVariable(lonVariable.name);
  const pmDataRaw = reader.getDataVariable(pmVariable.name);

  const latData = Array.from(latDataRaw as Float64Array);
  const lonData = Array.from(lonDataRaw as Float64Array);

  const shape = pmVariable.dimensions.map((dimension) => dimension.size);
  const latDimIdx = pmVariable.dimensions.findIndex((dimension) => dimension.name.toLowerCase().includes("lat"));
  const lonDimIdx = pmVariable.dimensions.findIndex((dimension) => dimension.name.toLowerCase().includes("lon"));

  if (latDimIdx === -1 || lonDimIdx === -1) {
    throw new Error("NetCDF: PM2.5 variable missing lat/lon dimensions");
  }

  const latCount = shape[latDimIdx];
  const lonCount = shape[lonDimIdx];

  const fillValues = resolveFillValues(pmVariable);
  const tolerances = fillValues.map((value) => Math.abs(value) * 1e-6 + 1e-6);

  const strides = computeStrides(shape);
  const indices = shape.map(() => 0);

  const south = descriptor.bbox.south;
  const north = descriptor.bbox.north;
  const west = descriptor.bbox.west;
  const east = descriptor.bbox.east;

  const points: Pm25Point[] = [];

  const latIndices = Array.from({ length: latCount }, (_, idx) => idx);
  const lonIndices = Array.from({ length: lonCount }, (_, idx) => idx);

  for (const latIdx of latIndices) {
    const lat = latData[latIdx];
    if (!withinBounds(lat, south, north)) continue;
    indices[latDimIdx] = latIdx;

    for (const lonIdx of lonIndices) {
      let lon = lonData[lonIdx];
      lon = normaliseLongitude(lon);
      if (!withinBounds(lon, west, east)) continue;

      indices[lonDimIdx] = lonIdx;

      let offset = 0;
      for (let dim = 0; dim < indices.length; dim++) {
        offset += indices[dim] * strides[dim];
      }

      const rawValue = (pmDataRaw as Float32Array | Float64Array | number[])[offset] as number;
      if (!Number.isFinite(rawValue)) continue;
      let skip = false;
      for (let idx = 0; idx < fillValues.length; idx++) {
        const fill = fillValues[idx];
        const tolerance = tolerances[idx];
        if (Math.abs(rawValue - fill) <= tolerance) {
          skip = true;
          break;
        }
      }
      if (skip) continue;
      if (!withinBounds(rawValue, -1e9, 1e9)) continue;

      points.push({
        lat,
        lon,
        value: rawValue
      });
    }
  }

  return points;
}
