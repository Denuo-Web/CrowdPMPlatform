import { importLibrary, setOptions, type APIOptions } from "@googlemaps/js-api-loader";

type LoaderLike = {
  importLibrary: typeof importLibrary;
};

let loader: LoaderLike | null = null;

export function getMapsLoader(): LoaderLike {
  if (!loader) {
    const { VITE_GOOGLE_MAPS_API_KEY: apiKey, VITE_GOOGLE_MAP_ID: mapId } = import.meta.env;
    const options: APIOptions = {
      key: apiKey,
      v: "weekly"
    };
    if (mapId) options.mapIds = [mapId];
    if (!options.key) {
      console.error("VITE_GOOGLE_MAPS_API_KEY is not configured; the Maps JavaScript API cannot load.");
    }
    setOptions(options);
    loader = { importLibrary };
  }

  return loader;
}
