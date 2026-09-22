// Namespace import, not a default one: MapLibre v6 is ESM-only and dropped
// its default export. This module deliberately wants the whole namespace so
// it can fall back to a host-provided global; callers only read from it
// (Popup, addProtocol), never mutate it, which v6's namespace would forbid.
import * as maplibregl from 'maplibre-gl';

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
  // Two-step cast: the ambient `maplibregl` global and this module's namespace
  // type do not overlap enough for a direct assertion (the namespace carries
  // internals the global's declaration omits).
  const globalNs = (globalThis as unknown as { maplibregl?: typeof maplibregl })
    .maplibregl;
  return globalNs ?? maplibregl;
}
