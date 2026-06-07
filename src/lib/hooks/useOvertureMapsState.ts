import { useState, useCallback } from 'react';
import type { OvertureMapsState, OvertureThemeState } from '../core/types';
import { THEME_IDS } from '../core/themes';
import type { OvertureTheme } from '../core/themes';

/**
 * Builds the default per-theme state.
 *
 * @returns Per-theme visibility and opacity defaults
 */
function defaultThemes(): Record<OvertureTheme, OvertureThemeState> {
  const themes = {} as Record<OvertureTheme, OvertureThemeState>;
  for (const theme of THEME_IDS) {
    themes[theme] = {
      visible: ['buildings', 'transportation', 'places'].includes(theme),
      opacity: 0.8,
    };
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
   * Sets a theme's visibility
   */
  const setThemeVisible = useCallback((theme: OvertureTheme, visible: boolean) => {
    setState((prev) => ({
      ...prev,
      themes: { ...prev.themes, [theme]: { ...prev.themes[theme], visible } },
    }));
  }, []);

  /**
   * Sets a theme's opacity
   */
  const setThemeOpacity = useCallback((theme: OvertureTheme, opacity: number) => {
    setState((prev) => ({
      ...prev,
      themes: { ...prev.themes, [theme]: { ...prev.themes[theme], opacity } },
    }));
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
    reset,
    toggle,
  };
}
