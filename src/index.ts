// Import styles
import './lib/styles/overture-control.css';

// Main entry point - Core exports
export { OvertureMapsControl } from './lib/core/OvertureMapsControl';

// Overture theme metadata and helpers
export {
  THEMES,
  THEME_IDS,
  buildLayerSpecs,
  buildSourceLayerSpecs,
  layerIdsForTheme,
  layerIdsForSourceLayer,
  sourceIdForTheme,
  tileUrlForTheme,
  opacityPropertyForLayerType,
  colorPropertyForLayerType,
  sizePropertyForLayerType,
  defaultSizeForGeometry,
} from './lib/core/themes';

// Releases helpers
export {
  fetchReleases,
  DEFAULT_RELEASES_URL,
  DEFAULT_TILES_BASE_URL,
  FALLBACK_RELEASE,
} from './lib/core/releases';

// PMTiles protocol registration
export { ensurePmtilesProtocol } from './lib/core/pmtilesProtocol';

// Type exports
export type {
  OvertureMapsControlOptions,
  OvertureMapsState,
  OvertureThemeState,
  OvertureLayerState,
  OvertureMapsEvent,
  OvertureMapsEventHandler,
  ControlColorScheme,
} from './lib/core/types';
export type {
  OvertureTheme,
  OvertureGeometry,
  OvertureLayerDef,
  ThemeDefinition,
} from './lib/core/themes';
export type { ReleasesResponse } from './lib/core/releases';

// Utility exports
export {
  clamp,
  formatNumericValue,
  generateId,
  debounce,
  throttle,
  classNames,
} from './lib/utils';
