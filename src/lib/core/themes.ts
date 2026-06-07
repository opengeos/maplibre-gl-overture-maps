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
 *
 * This is the panel display order (top to bottom). The control draws the
 * first theme on top of the map and the last theme at the bottom, so the
 * detail themes (addresses, places) sit above the background (base).
 */
export const THEME_IDS: OvertureTheme[] = [
  'addresses',
  'places',
  'transportation',
  'buildings',
  'divisions',
  'base',
];

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

/**
 * Returns the color paint property name for a layer type.
 *
 * @param layerType - The MapLibre layer type
 * @returns The matching paint property, e.g. `fill-color`
 */
export function colorPropertyForLayerType(
  layerType: 'fill' | 'line' | 'circle'
): 'fill-color' | 'line-color' | 'circle-color' {
  return `${layerType}-color` as 'fill-color' | 'line-color' | 'circle-color';
}

/**
 * Returns the size paint property name for a layer type.
 *
 * Fill layers have no size dimension and return null.
 *
 * @param layerType - The MapLibre layer type
 * @returns The matching paint property, or null for fills
 */
export function sizePropertyForLayerType(
  layerType: 'fill' | 'line' | 'circle'
): 'circle-radius' | 'line-width' | null {
  if (layerType === 'circle') return 'circle-radius';
  if (layerType === 'line') return 'line-width';
  return null;
}

/**
 * Returns the default size (circle radius or line width) for a geometry.
 *
 * @param geometry - The source-layer geometry
 * @returns The default size in pixels
 */
export function defaultSizeForGeometry(geometry: OvertureGeometry): number {
  if (geometry === 'point') return 3;
  if (geometry === 'line') return 1;
  return 0.8;
}

/**
 * Finds the source-layer definition for a theme.
 *
 * @param theme - The Overture theme identifier
 * @param sourceLayer - The source-layer name
 * @returns The layer definition, or undefined when not part of the theme
 */
export function findLayerDef(
  theme: OvertureTheme,
  sourceLayer: string
): OvertureLayerDef | undefined {
  return THEMES[theme].layers.find((layer) => layer.sourceLayer === sourceLayer);
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
  return def.layers.flatMap((layer) => specsForLayer(sourceId, layer, opacity, themeColor));
}

/**
 * Builds the MapLibre layer specifications for a single source layer of a
 * theme. Use this to render and restyle layers independently.
 *
 * @param theme - The Overture theme identifier
 * @param sourceLayer - The source-layer name (e.g. `water`)
 * @param opacity - The layer opacity (0..1)
 * @param color - Optional color override (defaults to the theme x-ray color)
 * @param size - Optional size override (circle radius / line width); defaults
 *   to the geometry's default size
 * @returns Layer specifications ready for `map.addLayer`
 */
export function buildSourceLayerSpecs(
  theme: OvertureTheme,
  sourceLayer: string,
  opacity: number,
  color?: string,
  size?: number
): LayerSpecification[] {
  const layer = findLayerDef(theme, sourceLayer);
  if (!layer) {
    return [];
  }
  return specsForLayer(
    sourceIdForTheme(theme),
    layer,
    opacity,
    color ?? THEMES[theme].color,
    size
  );
}

/**
 * Returns the MapLibre layer ids used to render a single source layer.
 *
 * @param theme - The Overture theme identifier
 * @param sourceLayer - The source-layer name
 * @returns Layer ids in the order they are added to the map
 */
export function layerIdsForSourceLayer(theme: OvertureTheme, sourceLayer: string): string[] {
  return buildSourceLayerSpecs(theme, sourceLayer, 1).map((spec) => spec.id);
}

/**
 * Builds the MapLibre layer specs for one source-layer definition.
 *
 * @param sourceId - The map source id
 * @param layer - The source-layer definition
 * @param opacity - The layer opacity (0..1)
 * @param color - The layer color
 * @returns Layer specifications for the source layer
 */
function specsForLayer(
  sourceId: string,
  layer: OvertureLayerDef,
  opacity: number,
  color: string,
  size?: number
): LayerSpecification[] {
  const idBase = `${sourceId}-${layer.sourceLayer}`;
  const px = size ?? defaultSizeForGeometry(layer.geometry);

  if (layer.geometry === 'polygon') {
    return [
      {
        id: `${idBase}-fill`,
        type: 'fill',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'fill-color': color,
          'fill-opacity': effectiveOpacity('fill', opacity),
        },
      },
      {
        id: `${idBase}-line`,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': color,
          'line-width': px,
          'line-opacity': effectiveOpacity('line', opacity),
        },
      },
    ];
  }

  if (layer.geometry === 'line') {
    return [
      {
        id: `${idBase}-line`,
        type: 'line',
        source: sourceId,
        'source-layer': layer.sourceLayer,
        paint: {
          'line-color': color,
          'line-width': px,
          'line-opacity': effectiveOpacity('line', opacity),
        },
      },
    ];
  }

  return [
    {
      id: `${idBase}-circle`,
      type: 'circle',
      source: sourceId,
      'source-layer': layer.sourceLayer,
      paint: {
        'circle-color': color,
        'circle-radius': px,
        'circle-opacity': effectiveOpacity('circle', opacity),
        'circle-stroke-width': 0.5,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': effectiveOpacity('circle', opacity),
      },
    },
  ];
}
