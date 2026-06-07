import type { LayerSpecification } from 'maplibre-gl';

/**
 * The Overture Maps data themes distributed as PMTiles archives.
 *
 * @see https://docs.overturemaps.org/examples/overture-tiles/
 */
export type OvertureTheme =
  | 'addresses'
  | 'base'
  | 'buildings'
  | 'divisions'
  | 'places'
  | 'transportation';

/**
 * Geometry rendered for a source layer within a theme tileset.
 */
export type OvertureGeometry = 'point' | 'line' | 'polygon';

/**
 * A source layer contained in an Overture theme PMTiles archive.
 */
export interface OvertureLayerDef {
  /** The MVT source-layer name (matches the Overture feature type) */
  sourceLayer: string;
  /** The geometry type used to render the layer */
  geometry: OvertureGeometry;
}

/**
 * Metadata describing an Overture theme tileset.
 */
export interface ThemeDefinition {
  /** Theme identifier (also the PMTiles file name) */
  id: OvertureTheme;
  /** Human-readable label shown in the control panel */
  label: string;
  /** Default x-ray color for the theme */
  color: string;
  /** Source layers contained in the theme tileset */
  layers: OvertureLayerDef[];
  /** Minimum zoom at which features appear (informational) */
  minzoom?: number;
}

/**
 * All Overture themes with their source layers and default x-ray colors.
 *
 * Source layers verified against the OvertureMaps/overture-tiles
 * planetiler profiles.
 */
export const THEMES: Record<OvertureTheme, ThemeDefinition> = {
  addresses: {
    id: 'addresses',
    label: 'Addresses',
    color: '#e6194b',
    layers: [{ sourceLayer: 'address', geometry: 'point' }],
    minzoom: 14,
  },
  base: {
    id: 'base',
    label: 'Base',
    color: '#3cb44b',
    layers: [
      { sourceLayer: 'land', geometry: 'polygon' },
      { sourceLayer: 'land_cover', geometry: 'polygon' },
      { sourceLayer: 'land_use', geometry: 'polygon' },
      { sourceLayer: 'water', geometry: 'polygon' },
      { sourceLayer: 'bathymetry', geometry: 'polygon' },
      { sourceLayer: 'infrastructure', geometry: 'line' },
    ],
  },
  buildings: {
    id: 'buildings',
    label: 'Buildings',
    color: '#f58231',
    layers: [
      { sourceLayer: 'building', geometry: 'polygon' },
      { sourceLayer: 'building_part', geometry: 'polygon' },
    ],
  },
  divisions: {
    id: 'divisions',
    label: 'Divisions',
    color: '#911eb4',
    layers: [
      { sourceLayer: 'division_area', geometry: 'polygon' },
      { sourceLayer: 'division_boundary', geometry: 'line' },
      { sourceLayer: 'division', geometry: 'point' },
    ],
  },
  places: {
    id: 'places',
    label: 'Places',
    color: '#4363d8',
    layers: [{ sourceLayer: 'place', geometry: 'point' }],
    minzoom: 14,
  },
  transportation: {
    id: 'transportation',
    label: 'Transportation',
    color: '#f032e6',
    layers: [
      { sourceLayer: 'segment', geometry: 'line' },
      { sourceLayer: 'connector', geometry: 'point' },
    ],
  },
};

/**
 * Ordered list of all Overture theme identifiers.
 */
export const THEME_IDS = Object.keys(THEMES) as OvertureTheme[];

/**
 * Returns the map source id used for a theme.
 *
 * @param theme - The Overture theme identifier
 * @returns The MapLibre source id, e.g. `overture-buildings`
 */
export function sourceIdForTheme(theme: OvertureTheme): string {
  return `overture-${theme}`;
}

/**
 * Returns the PMTiles URL for a theme at a given release.
 *
 * @param baseUrl - Base tiles URL (no trailing slash)
 * @param release - Overture release, e.g. `2026-05-20.0`
 * @param theme - The Overture theme identifier
 * @returns The `pmtiles://`-prefixed source URL
 */
export function tileUrlForTheme(baseUrl: string, release: string, theme: OvertureTheme): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `pmtiles://${trimmed}/${release}/${theme}.pmtiles`;
}

/**
 * Returns all MapLibre layer ids used to render a theme.
 *
 * @param theme - The Overture theme identifier
 * @returns Layer ids in the order they are added to the map
 */
export function layerIdsForTheme(theme: OvertureTheme): string[] {
  return buildLayerSpecs(theme, 1).map((spec) => spec.id);
}

/**
 * Returns the opacity paint property name for a layer type.
 *
 * @param layerType - The MapLibre layer type
 * @returns The matching paint property, e.g. `fill-opacity`
 */
export function opacityPropertyForLayerType(
  layerType: 'fill' | 'line' | 'circle'
): 'fill-opacity' | 'line-opacity' | 'circle-opacity' {
  return `${layerType}-opacity` as 'fill-opacity' | 'line-opacity' | 'circle-opacity';
}

/** Fill layers are kept translucent relative to the theme opacity for an x-ray look. */
export const FILL_OPACITY_RATIO = 0.3;

/**
 * Computes the effective opacity for a rendered layer type.
 *
 * @param layerType - The MapLibre layer type
 * @param opacity - The theme opacity (0..1)
 * @returns The opacity value to apply to the layer's paint property
 */
export function effectiveOpacity(layerType: 'fill' | 'line' | 'circle', opacity: number): number {
  return layerType === 'fill' ? opacity * FILL_OPACITY_RATIO : opacity;
}

/**
 * Builds the MapLibre layer specifications used to render a theme.
 *
 * Polygons produce a translucent fill plus an outline line layer; lines
 * produce a line layer; points produce a circle layer.
 *
 * @param theme - The Overture theme identifier
 * @param opacity - The theme opacity (0..1)
 * @param color - Optional color override (defaults to the theme x-ray color)
 * @returns Layer specifications ready for `map.addLayer`
 */
export function buildLayerSpecs(
  theme: OvertureTheme,
  opacity: number,
  color?: string
): LayerSpecification[] {
  const def = THEMES[theme];
  const themeColor = color ?? def.color;
  const sourceId = sourceIdForTheme(theme);
  const specs: LayerSpecification[] = [];

  for (const layer of def.layers) {
    const idBase = `${sourceId}-${layer.sourceLayer}`;

    if (layer.geometry === 'polygon') {
      specs.push({
        id: `${idBase}-fill`,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': themeColor,
          'fill-opacity': effectiveOpacity('fill', opacity),
        },
      });
      specs.push({
        id: `${idBase}-line`,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': themeColor,
          'line-width': 0.8,
          'line-opacity': effectiveOpacity('line', opacity),
        },
      });
    } else if (layer.geometry === 'line') {
      specs.push({
        id: `${idBase}-line`,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': themeColor,
          'line-width': 1,
          'line-opacity': effectiveOpacity('line', opacity),
        },
      });
    } else {
      specs.push({
        id: `${idBase}-circle`,
        type: 'circle',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'circle-color': themeColor,
          'circle-radius': 3,
          'circle-opacity': effectiveOpacity('circle', opacity),
          'circle-stroke-width': 0.5,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-opacity': effectiveOpacity('circle', opacity),
        },
      });
    }
  }

  return specs;
}
