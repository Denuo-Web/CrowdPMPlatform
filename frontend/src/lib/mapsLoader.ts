import { importLibrary, setOptions, type APIOptions } from "@googlemaps/js-api-loader";
import { logError } from "./logger";

type LoaderLike = {
  importLibrary: typeof importLibrary;
};

let loader: LoaderLike | null = null;

export function normalizeGoogleMapId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (["null", "undefined", "false"].includes(trimmed.toLowerCase())) return null;
  if (trimmed === "replace-with-google-vector-map-id") return null;
  return trimmed;
}

export function getMapsLoader(): LoaderLike {
  if (!loader) {
    const { VITE_GOOGLE_MAPS_API_KEY: apiKey, VITE_GOOGLE_MAP_ID: rawMapId } = import.meta.env;
    const mapId = normalizeGoogleMapId(rawMapId);
    const options: APIOptions = {
      key: apiKey,
      v: "weekly"
    };
    if (mapId) options.mapIds = [mapId];
    if (!options.key) {
      logError("VITE_GOOGLE_MAPS_API_KEY is not configured; the Maps JavaScript API cannot load.");
    }
    setOptions(options);
    loader = { importLibrary };
  }

  return loader;
}
