import type { Map } from 'maplibre-gl';
import type { OvertureTheme } from './themes';

/**
 * UI color scheme for the control.
 *
 * - `'light'` forces light colors
 * - `'dark'` forces dark colors
 * - `'auto'` follows the browser's `prefers-color-scheme`
 */
export type ControlColorScheme = 'light' | 'dark' | 'auto';

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
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

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
   * Pin a specific Overture release (e.g. `'2026-05-20.0'`).
   * When omitted, the latest release from {@link releasesUrl} is used.
   */
  release?: string;

  /**
   * Endpoint listing available Overture releases
   * @default 'https://labs.overturemaps.org/data/releases.json'
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
  | 'collapse'
  | 'expand'
  | 'statechange'
  | 'releasechange'
  | 'themechange'
  | 'error';

/**
 * Event handler function type
 */
export type OvertureMapsEventHandler = (event: {
  type: OvertureMapsEvent;
  state: OvertureMapsState;
}) => void;
