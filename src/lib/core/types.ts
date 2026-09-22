import type { FeatureCollection } from "geojson";
import type { Map } from "maplibre-gl";
import type { OvertureTheme } from "./themes";

/**
 * UI color scheme for the control.
 *
 * - `'light'` forces light colors
 * - `'dark'` forces dark colors
 * - `'auto'` follows the browser's `prefers-color-scheme`
 */
export type ControlColorScheme = "light" | "dark" | "auto";

/**
 * Options for configuring the OvertureMapsControl
 */
export interface OvertureMapsControlOptions {
  /**
   * Whether the control panel should start collapsed (showing only the toggle button)
   * @default true
   */
  collapsed?: boolean;

  /**
   * Position of the control on the map
   * @default 'top-right'
   */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";

  /**
   * Title displayed in the control header
   * @default 'Overture Maps'
   */
  title?: string;

  /**
   * Width of the control panel in pixels
   * @default 300
   */
  panelWidth?: number;

  /**
   * Custom CSS class name for the control container
   */
  className?: string;

  /**
   * UI color scheme for the control
   * @default 'auto'
   */
  theme?: ControlColorScheme;

  /**
   * Pin a specific Overture release (e.g. `'2026-08-19.0'`).
   * When omitted, the newest release carried by {@link tilesBaseUrl} is used.
   */
  release?: string;

  /**
   * Endpoint listing available Overture releases, in releases.json shape.
   *
   * Unset by default: Overture froze the releases.json it published at a
   * release whose tiles have since been removed, so releases are discovered
   * from {@link tilesBaseUrl} instead. Set this to point at a mirror that
   * still publishes that document.
   */
  releasesUrl?: string;

  /**
   * Base URL of the Overture PMTiles distribution (no trailing slash)
   * @default 'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles'
   */
  tilesBaseUrl?: string;

  /**
   * Whether clicking a rendered Overture feature opens a properties popup
   * @default true
   */
  inspect?: boolean;

  /**
   * Minimum map zoom required to export a layer to GeoJSON. This keeps
   * exports limited to a small area.
   * @default 12
   */
  exportMinZoom?: number;

  /**
   * Themes that start visible
   * @default ['buildings', 'transportation', 'places']
   */
  visibleThemes?: OvertureTheme[];

  /**
   * Per-theme color overrides (hex colors)
   */
  themeColors?: Partial<Record<OvertureTheme, string>>;

  /**
   * Per-theme initial opacity overrides (0..1)
   * @default 0.8 for every theme
   */
  themeOpacity?: Partial<Record<OvertureTheme, number>>;

  /**
   * Custom handler for exporting a layer to GeoJSON. When provided, it is
   * called instead of the built-in browser download, letting a host
   * application save the file its own way (e.g. a native save dialog in a
   * desktop webview where anchor downloads do not work).
   *
   * @param filename - The suggested file name (e.g. `overture-buildings-building.geojson`)
   * @param data - The exported FeatureCollection
   */
  onExport?: (filename: string, data: FeatureCollection) => void;

  /**
   * Whether the host map reads `.pmtiles` archives natively from a plain
   * `https://` URL, so the control emits the archive URL as-is and skips
   * registering MapLibre's `pmtiles://` protocol. Set it when the control is
   * mounted on an engine with a built-in PMTiles tile provider, such as
   * Mapbox GL JS 3.30+, where `maplibregl.addProtocol` has no effect.
   * @default false
   */
  nativePmtiles?: boolean;

  /**
   * Factory for the feature-inspection popup. When provided, it is called
   * instead of constructing MapLibre's `Popup`, letting a host mount the
   * control on a map engine that ships its own popup class (for example
   * mapbox-gl's `Popup`, which shares the same fluent surface).
   *
   * @param options - The popup options the control would pass to MapLibre
   * @returns A popup exposing `setLngLat`, `setDOMContent`, `addTo` and `remove`
   */
  createPopup?: (options: OverturePopupOptions) => OverturePopup;
}

/**
 * Options the control hands to {@link OvertureMapsControlOptions.createPopup}.
 * A subset of MapLibre's `PopupOptions` that mapbox-gl's `Popup` accepts too.
 */
export interface OverturePopupOptions {
  /** CSS max-width of the popup, e.g. `'320px'` */
  maxWidth?: string;
  /** Extra class name(s) added to the popup container */
  className?: string;
}

/**
 * The popup surface the control drives: the fluent members shared by
 * MapLibre's and mapbox-gl's `Popup` classes.
 */
export interface OverturePopup {
  /** Positions the popup at a geographic location */
  setLngLat(lngLat: { lng: number; lat: number } | [number, number]): this;
  /** Replaces the popup body with a DOM node */
  setDOMContent(node: Node): this;
  /** Attaches the popup to the map the control is mounted on */
  addTo(map: unknown): this;
  /** Detaches the popup from the map */
  remove(): this;
}

/**
 * Styling and visibility of a single source layer within a theme.
 */
export interface OvertureLayerState {
  /** Whether the layer is on the map */
  visible: boolean;
  /** Layer opacity (0..1) */
  opacity: number;
  /** Layer color (hex) */
  color: string;
  /** Layer size: circle radius for points, line width for lines and outlines */
  size: number;
}

/**
 * State of a single Overture theme and its source layers.
 */
export interface OvertureThemeState {
  /** Whether the theme's layer list is expanded in the panel */
  expanded: boolean;
  /** Per-source-layer styling and visibility, keyed by source-layer name */
  layers: Record<string, OvertureLayerState>;
}

/**
 * Internal state of the Overture Maps control
 */
export interface OvertureMapsState {
  /**
   * Whether the control panel is currently collapsed
   */
  collapsed: boolean;

  /**
   * Current panel width in pixels
   */
  panelWidth: number;

  /**
   * The active Overture release
   */
  release: string;

  /**
   * Available Overture releases (newest first)
   */
  releases: string[];

  /**
   * Per-theme visibility and opacity
   */
  themes: Record<OvertureTheme, OvertureThemeState>;

  /**
   * Whether the feature inspection picker is enabled
   */
  inspect: boolean;

  /**
   * Last error message, or null when healthy
   */
  error?: string | null;
}

/**
 * Props for the React wrapper component
 */
export interface OvertureMapsControlReactProps extends OvertureMapsControlOptions {
  /**
   * MapLibre GL map instance
   */
  map: Map;

  /**
   * Callback fired when the control state changes
   */
  onStateChange?: (state: OvertureMapsState) => void;
}

/**
 * Event types emitted by the Overture Maps control
 */
export type OvertureMapsEvent =
  | "collapse"
  | "expand"
  | "statechange"
  | "releasechange"
  | "themechange"
  | "error";

/**
 * Event handler function type
 */
export type OvertureMapsEventHandler = (event: {
  type: OvertureMapsEvent;
  state: OvertureMapsState;
}) => void;
