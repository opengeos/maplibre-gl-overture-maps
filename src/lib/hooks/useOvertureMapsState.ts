import { useState, useCallback } from 'react';
import type { OvertureMapsState, OvertureThemeState, OvertureLayerState } from '../core/types';
import { THEMES, THEME_IDS, defaultSizeForGeometry } from '../core/themes';
import type { OvertureTheme } from '../core/themes';

/**
 * Builds the default per-theme, per-layer state.
 *
 * @returns Per-theme state with each source layer's defaults
 */
function defaultThemes(): Record<OvertureTheme, OvertureThemeState> {
  const themes = {} as Record<OvertureTheme, OvertureThemeState>;
  for (const theme of THEME_IDS) {
    const def = THEMES[theme];
    const visible = ['buildings', 'transportation', 'places'].includes(theme);
    const layers = {} as Record<string, OvertureLayerState>;
    for (const layer of def.layers) {
      layers[layer.sourceLayer] = {
        visible,
        opacity: 0.8,
        color: def.color,
        size: defaultSizeForGeometry(layer.geometry),
      };
    }
    themes[theme] = { expanded: false, layers };
  }
  return themes;
}

/**
 * Custom hook for managing Overture Maps control state in React applications.
 *
 * This hook provides a simple way to track and update the state
 * of an OvertureMapsControl from React components.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { state, setState, toggle } = useOvertureMapsState();
 *
 *   return (
 *     <div>
 *       <button onClick={toggle}>
 *         {state.collapsed ? 'Expand' : 'Collapse'}
 *       </button>
 *       <OvertureMapsControlReact
 *         map={map}
 *         collapsed={state.collapsed}
 *         onStateChange={(newState) => setState(newState)}
 *       />
 *     </div>
 *   );
 * }
 * ```
 *
 * @param initialState - Optional initial state values
 * @returns Object containing state and update functions
 */
export function useOvertureMapsState(initialState?: Partial<OvertureMapsState>) {
  const buildDefault = (): OvertureMapsState => ({
    collapsed: true,
    panelWidth: 300,
    release: '',
    releases: [],
    themes: defaultThemes(),
    inspect: true,
    error: null,
    ...initialState,
  });

  const [state, setState] = useState<OvertureMapsState>(buildDefault);

  /**
   * Sets the collapsed state
   */
  const setCollapsed = useCallback((collapsed: boolean) => {
    setState((prev) => ({ ...prev, collapsed }));
  }, []);

  /**
   * Sets the panel width
   */
  const setPanelWidth = useCallback((panelWidth: number) => {
    setState((prev) => ({ ...prev, panelWidth }));
  }, []);

  /**
   * Sets the active release
   */
  const setRelease = useCallback((release: string) => {
    setState((prev) => ({ ...prev, release }));
  }, []);

  /**
   * Maps every source layer of a theme through an updater
   */
  const updateThemeLayers = useCallback(
    (theme: OvertureTheme, update: (layer: OvertureLayerState) => OvertureLayerState) => {
      setState((prev) => {
        const themeState = prev.themes[theme];
        const layers = {} as Record<string, OvertureLayerState>;
        for (const key of Object.keys(themeState.layers)) {
          layers[key] = update(themeState.layers[key]);
        }
        return { ...prev, themes: { ...prev.themes, [theme]: { ...themeState, layers } } };
      });
    },
    []
  );

  /**
   * Sets the visibility of every layer in a theme
   */
  const setThemeVisible = useCallback(
    (theme: OvertureTheme, visible: boolean) => {
      updateThemeLayers(theme, (layer) => ({ ...layer, visible }));
    },
    [updateThemeLayers]
  );

  /**
   * Sets the opacity of every layer in a theme
   */
  const setThemeOpacity = useCallback(
    (theme: OvertureTheme, opacity: number) => {
      updateThemeLayers(theme, (layer) => ({ ...layer, opacity }));
    },
    [updateThemeLayers]
  );

  /**
   * Updates a single source layer's state
   */
  const setLayer = useCallback(
    (theme: OvertureTheme, sourceLayer: string, patch: Partial<OvertureLayerState>) => {
      setState((prev) => {
        const themeState = prev.themes[theme];
        return {
          ...prev,
          themes: {
            ...prev.themes,
            [theme]: {
              ...themeState,
              layers: {
                ...themeState.layers,
                [sourceLayer]: { ...themeState.layers[sourceLayer], ...patch },
              },
            },
          },
        };
      });
    },
    []
  );

  /**
   * Enables or disables the feature inspection picker
   */
  const setInspect = useCallback((inspect: boolean) => {
    setState((prev) => ({ ...prev, inspect }));
  }, []);

  /**
   * Resets the state to default values
   */
  const reset = useCallback(() => {
    setState(buildDefault());
  }, [initialState]);

  /**
   * Toggles the collapsed state
   */
  const toggle = useCallback(() => {
    setState((prev) => ({ ...prev, collapsed: !prev.collapsed }));
  }, []);

  return {
    state,
    setState,
    setCollapsed,
    setPanelWidth,
    setRelease,
    setThemeVisible,
    setThemeOpacity,
    setLayer,
    setInspect,
    reset,
    toggle,
  };
}
