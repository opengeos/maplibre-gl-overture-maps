import maplibregl from 'maplibre-gl';

/**
 * Returns the MapLibre GL namespace to use at runtime.
 *
 * Prefers a host-provided global `maplibregl` (e.g. when the plugin is
 * bundled separately from the application, as in GeoLibre) so protocol
 * registration and popups operate on the same MapLibre instance as the
 * host map. Falls back to the imported module.
 *
 * @returns The MapLibre GL namespace
 */
export function getMapLibre(): typeof maplibregl {
  const globalNs = (globalThis as { maplibregl?: typeof maplibregl }).maplibregl;
  return globalNs ?? maplibregl;
}
