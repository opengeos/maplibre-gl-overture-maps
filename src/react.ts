// React entry point
export { OvertureMapsControlReact } from './lib/core/OvertureMapsControlReact';

// React hooks
export { useOvertureMapsState } from './lib/hooks';

// Re-export types for React consumers
export type {
  OvertureMapsControlOptions,
  OvertureMapsState,
  OvertureThemeState,
  OvertureLayerState,
  OvertureMapsControlReactProps,
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
