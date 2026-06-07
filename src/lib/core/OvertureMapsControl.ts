import type { IControl, Map as MapLibreMap, MapMouseEvent, Popup } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { getMapLibre } from './maplibre';
import type {
  OvertureMapsControlOptions,
  OvertureMapsState,
  OvertureMapsEvent,
  OvertureMapsEventHandler,
  OvertureThemeState,
  OvertureLayerState,
} from './types';
import {
  THEMES,
  THEME_IDS,
  layerIdsForTheme,
  layerIdsForSourceLayer,
  buildSourceLayerSpecs,
  opacityPropertyForLayerType,
  colorPropertyForLayerType,
  sizePropertyForLayerType,
  defaultSizeForGeometry,
  findLayerDef,
  effectiveOpacity,
  sourceIdForTheme,
  tileUrlForTheme,
} from './themes';
import type { OvertureTheme } from './themes';
import {
  DEFAULT_RELEASES_URL,
  DEFAULT_TILES_BASE_URL,
  FALLBACK_RELEASE,
  fetchReleases,
} from './releases';
import { ensurePmtilesProtocol } from './pmtilesProtocol';

/**
 * Default options for the OvertureMapsControl
 */
const DEFAULT_OPTIONS: Required<
  Omit<OvertureMapsControlOptions, 'release' | 'themeColors' | 'themeOpacity'>
> &
  Pick<OvertureMapsControlOptions, 'release' | 'themeColors' | 'themeOpacity'> = {
  collapsed: true,
  position: 'top-right',
  title: 'Overture Maps',
  panelWidth: 300,
  className: '',
  theme: 'auto',
  release: undefined,
  releasesUrl: DEFAULT_RELEASES_URL,
  tilesBaseUrl: DEFAULT_TILES_BASE_URL,
  inspect: true,
  exportMinZoom: 12,
  visibleThemes: ['buildings', 'transportation', 'places'],
  themeColors: undefined,
  themeOpacity: undefined,
};

const DEFAULT_OPACITY = 0.8;

/** Minimum panel width when resizing, matches the CSS min-width */
const MIN_PANEL_WIDTH = 240;

/** Maximum panel width when resizing */
const MAX_PANEL_WIDTH = 600;

/**
 * Event handlers map type
 */
type EventHandlersMap = globalThis.Map<OvertureMapsEvent, Set<OvertureMapsEventHandler>>;

/**
 * A MapLibre GL control for visualizing Overture Maps PMTiles themes.
 *
 * Adds a collapsible panel with a release selector and per-theme visibility
 * and opacity controls. Tiles are loaded from the official Overture Maps
 * PMTiles distribution using the `pmtiles://` protocol.
 *
 * @example
 * ```typescript
 * const control = new OvertureMapsControl({
 *   collapsed: false,
 *   visibleThemes: ['buildings', 'places'],
 * });
 * map.addControl(control, 'top-right');
 * ```
 */
export class OvertureMapsControl implements IControl {
  private _map?: MapLibreMap;
  private _mapContainer?: HTMLElement;
  private _container?: HTMLElement;
  private _panel?: HTMLElement;
  private _options: typeof DEFAULT_OPTIONS;
  private _state: OvertureMapsState;
  private _eventHandlers: EventHandlersMap = new globalThis.Map();
  private _popup?: Popup;
  private _releaseSelect?: HTMLSelectElement;
  private _errorEl?: HTMLElement;
  private _noticeEl?: HTMLElement;
  private _noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private _inspectCheckbox?: HTMLInputElement;

  // System color-scheme adaptation (only used when theme: 'auto')
  private _schemeMedia: MediaQueryList | null = null;
  private _schemeListener: (() => void) | null = null;

  // Panel positioning handlers
  private _resizeHandler: (() => void) | null = null;
  private _mapResizeHandler: (() => void) | null = null;
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  // Set while expanding so the click that triggered a programmatic
  // expand (e.g. an external button) is not treated as a click-outside
  private _suppressClickOutside = false;

  // Panel width drag-resize handlers (added to the document during a drag)
  private _resizePointerMove: ((e: PointerEvent) => void) | null = null;
  private _resizePointerUp: ((e: PointerEvent) => void) | null = null;

  // Map interaction handlers
  private _clickHandler: ((e: MapMouseEvent) => void) | null = null;
  private _moveHandler: ((e: MapMouseEvent) => void) | null = null;

  /**
   * Creates a new OvertureMapsControl instance.
   *
   * @param options - Configuration options for the control
   */
  constructor(options?: Partial<OvertureMapsControlOptions>) {
    this._options = { ...DEFAULT_OPTIONS, ...options };

    const themes = {} as Record<OvertureTheme, OvertureThemeState>;
    for (const theme of THEME_IDS) {
      const def = THEMES[theme];
      const visible = this._options.visibleThemes.includes(theme);
      const opacity = this._options.themeOpacity?.[theme] ?? DEFAULT_OPACITY;
      const color = this._options.themeColors?.[theme] ?? def.color;
      const layers = {} as Record<string, OvertureLayerState>;
      for (const layer of def.layers) {
        layers[layer.sourceLayer] = {
          visible,
          opacity,
          color,
          size: defaultSizeForGeometry(layer.geometry),
        };
      }
      themes[theme] = { expanded: false, layers };
    }

    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      release: this._options.release ?? '',
      releases: this._options.release ? [this._options.release] : [],
      themes,
      inspect: this._options.inspect,
      error: null,
    };
  }

  /**
   * Called when the control is added to the map.
   * Implements the IControl interface.
   *
   * @param map - The MapLibre GL map instance
   * @returns The control's container element
   */
  onAdd(map: MapLibreMap): HTMLElement {
    this._map = map;
    this._mapContainer = map.getContainer();
    ensurePmtilesProtocol();

    this._container = this._createContainer();
    this._panel = this._createPanel();

    // Append panel to map container for independent positioning (avoids overlap with other controls)
    this._mapContainer.appendChild(this._panel);

    // Setup event listeners for panel positioning and click-outside
    this._setupEventListeners();

    // Follow the system color scheme live when theme is 'auto'
    this._setupSchemeListener();

    // Setup feature inspection
    if (this._state.inspect) {
      this._setupInspect();
    }

    // Set initial panel state
    if (!this._state.collapsed) {
      this._panel.classList.add('expanded');
      // Update position after control is added to DOM
      requestAnimationFrame(() => {
        this._updatePanelPosition();
      });
    }

    // Resolve the release list, then render the Overture sources/layers
    void this._initializeReleases();

    return this._container;
  }

  /**
   * Called when the control is removed from the map.
   * Implements the IControl interface.
   */
  onRemove(): void {
    // Remove map interaction handlers
    this._teardownInspect();

    // Clear any pending notice timer
    if (this._noticeTimer != null) {
      clearTimeout(this._noticeTimer);
      this._noticeTimer = null;
    }

    // Remove the system color-scheme listener
    if (this._schemeMedia && this._schemeListener) {
      this._schemeMedia.removeEventListener('change', this._schemeListener);
    }
    this._schemeMedia = null;
    this._schemeListener = null;

    // Remove Overture layers and sources
    this._removeAllThemes();

    // Remove any in-progress panel resize listeners
    if (this._resizePointerMove) {
      document.removeEventListener('pointermove', this._resizePointerMove);
      this._resizePointerMove = null;
    }
    if (this._resizePointerUp) {
      document.removeEventListener('pointerup', this._resizePointerUp);
      this._resizePointerUp = null;
    }

    // Remove event listeners
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }
    if (this._mapResizeHandler && this._map) {
      this._map.off('resize', this._mapResizeHandler);
      this._mapResizeHandler = null;
    }
    if (this._clickOutsideHandler) {
      document.removeEventListener('click', this._clickOutsideHandler);
      this._clickOutsideHandler = null;
    }

    // Remove panel from map container
    this._panel?.parentNode?.removeChild(this._panel);

    // Remove button container from control stack
    this._container?.parentNode?.removeChild(this._container);

    this._map = undefined;
    this._mapContainer = undefined;
    this._container = undefined;
    this._panel = undefined;
    this._releaseSelect = undefined;
    this._errorEl = undefined;
    this._noticeEl = undefined;
    this._inspectCheckbox = undefined;
    this._eventHandlers.clear();
  }

  /**
   * Gets the current state of the control.
   *
   * @returns The current control state
   */
  getState(): OvertureMapsState {
    return {
      ...this._state,
      releases: [...this._state.releases],
      themes: this._cloneThemes(),
    };
  }

  /**
   * Updates the control state.
   *
   * @param newState - Partial state to merge with current state
   */
  setState(newState: Partial<OvertureMapsState>): void {
    this._state = { ...this._state, ...newState };
    this._emit('statechange');
  }

  /**
   * Toggles the collapsed state of the control panel.
   */
  toggle(): void {
    this._state.collapsed = !this._state.collapsed;

    if (this._panel) {
      if (this._state.collapsed) {
        this._panel.classList.remove('expanded');
        this._emit('collapse');
      } else {
        this._panel.classList.add('expanded');
        this._updatePanelPosition();
        // Ignore the click event currently being dispatched (if any) so
        // a programmatic expand isn't undone by the click-outside handler
        this._suppressClickOutside = true;
        setTimeout(() => {
          this._suppressClickOutside = false;
        }, 0);
        this._emit('expand');
      }
    }

    this._emit('statechange');
  }

  /**
   * Expands the control panel.
   */
  expand(): void {
    if (this._state.collapsed) {
      this.toggle();
    }
  }

  /**
   * Collapses the control panel.
   */
  collapse(): void {
    if (!this._state.collapsed) {
      this.toggle();
    }
  }

  /**
   * Registers an event handler.
   *
   * @param event - The event type to listen for
   * @param handler - The callback function
   */
  on(event: OvertureMapsEvent, handler: OvertureMapsEventHandler): void {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set());
    }
    this._eventHandlers.get(event)!.add(handler);
  }

  /**
   * Removes an event handler.
   *
   * @param event - The event type
   * @param handler - The callback function to remove
   */
  off(event: OvertureMapsEvent, handler: OvertureMapsEventHandler): void {
    this._eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Gets the map instance.
   *
   * @returns The MapLibre GL map instance or undefined if not added to a map
   */
  getMap(): MapLibreMap | undefined {
    return this._map;
  }

  /**
   * Gets the control container element.
   *
   * @returns The container element or undefined if not added to a map
   */
  getContainer(): HTMLElement | undefined {
    return this._container;
  }

  /**
   * Switches the active Overture release and reloads visible themes.
   *
   * @param release - The release to activate, e.g. `'2026-05-20.0'`
   */
  setRelease(release: string): void {
    if (!release || release === this._state.release) {
      return;
    }
    this._state.release = release;
    if (!this._state.releases.includes(release)) {
      this._state.releases = [release, ...this._state.releases];
      this._renderReleaseOptions();
    }
    if (this._releaseSelect) {
      this._releaseSelect.value = release;
    }
    this._applyRelease();
    this._emit('releasechange');
    this._emit('statechange');
  }

  /**
   * Shows or hides every source layer of an Overture theme.
   *
   * @param theme - The theme to update
   * @param visible - Whether the theme's layers should be rendered
   */
  setThemeVisible(theme: OvertureTheme, visible: boolean): void {
    const themeState = this._state.themes[theme];
    if (!themeState) {
      return;
    }
    let changed = false;
    for (const sourceLayer of Object.keys(themeState.layers)) {
      const layerState = themeState.layers[sourceLayer];
      if (layerState.visible === visible) {
        continue;
      }
      layerState.visible = visible;
      if (visible) {
        this._addLayer(theme, sourceLayer);
      } else {
        this._removeLayer(theme, sourceLayer);
      }
      changed = true;
    }
    if (!changed) {
      return;
    }
    this._syncThemeGroup(theme);
    this._emit('themechange');
    this._emit('statechange');
  }

  /**
   * Sets the opacity of every source layer of an Overture theme.
   *
   * @param theme - The theme to update
   * @param opacity - Opacity value between 0 and 1
   */
  setThemeOpacity(theme: OvertureTheme, opacity: number): void {
    const themeState = this._state.themes[theme];
    if (!themeState) {
      return;
    }
    for (const sourceLayer of Object.keys(themeState.layers)) {
      this.setLayerOpacity(theme, sourceLayer, opacity);
    }
  }

  /**
   * Shows or hides a single source layer of a theme.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   * @param visible - Whether the layer should be rendered
   */
  setLayerVisible(theme: OvertureTheme, sourceLayer: string, visible: boolean): void {
    const layerState = this._state.themes[theme]?.layers[sourceLayer];
    if (!layerState || layerState.visible === visible) {
      return;
    }
    layerState.visible = visible;
    if (visible) {
      this._addLayer(theme, sourceLayer);
    } else {
      this._removeLayer(theme, sourceLayer);
    }
    this._syncThemeGroup(theme);
    this._emit('themechange');
    this._emit('statechange');
  }

  /**
   * Sets the opacity of a single source layer.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   * @param opacity - Opacity value between 0 and 1
   */
  setLayerOpacity(theme: OvertureTheme, sourceLayer: string, opacity: number): void {
    const layerState = this._state.themes[theme]?.layers[sourceLayer];
    if (!layerState) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, opacity));
    layerState.opacity = clamped;

    if (this._map && layerState.visible) {
      for (const spec of buildSourceLayerSpecs(theme, sourceLayer, clamped, layerState.color)) {
        if (this._map.getLayer(spec.id)) {
          const layerType = spec.type as 'fill' | 'line' | 'circle';
          this._map.setPaintProperty(
            spec.id,
            opacityPropertyForLayerType(layerType),
            effectiveOpacity(layerType, clamped)
          );
        }
      }
    }

    this._syncLayerRow(theme, sourceLayer);
    this._emit('themechange');
    this._emit('statechange');
  }

  /**
   * Sets the color of a single source layer.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   * @param color - A CSS color string (hex)
   */
  setLayerColor(theme: OvertureTheme, sourceLayer: string, color: string): void {
    const layerState = this._state.themes[theme]?.layers[sourceLayer];
    if (!layerState) {
      return;
    }
    layerState.color = color;

    if (this._map && layerState.visible) {
      for (const spec of buildSourceLayerSpecs(theme, sourceLayer, layerState.opacity, color)) {
        if (this._map.getLayer(spec.id)) {
          const layerType = spec.type as 'fill' | 'line' | 'circle';
          this._map.setPaintProperty(spec.id, colorPropertyForLayerType(layerType), color);
        }
      }
    }

    this._syncLayerRow(theme, sourceLayer);
    this._emit('themechange');
    this._emit('statechange');
  }

  /**
   * Sets the size of a single source layer (circle radius for points, line
   * width for lines and polygon outlines).
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   * @param size - The size in pixels
   */
  setLayerSize(theme: OvertureTheme, sourceLayer: string, size: number): void {
    const layerState = this._state.themes[theme]?.layers[sourceLayer];
    if (!layerState) {
      return;
    }
    const clamped = Math.max(0, size);
    layerState.size = clamped;

    if (this._map && layerState.visible) {
      for (const spec of buildSourceLayerSpecs(
        theme,
        sourceLayer,
        layerState.opacity,
        layerState.color,
        clamped
      )) {
        if (this._map.getLayer(spec.id)) {
          const layerType = spec.type as 'fill' | 'line' | 'circle';
          const property = sizePropertyForLayerType(layerType);
          if (property) {
            this._map.setPaintProperty(spec.id, property, clamped);
          }
        }
      }
    }

    this._syncLayerRow(theme, sourceLayer);
    this._emit('themechange');
    this._emit('statechange');
  }

  /**
   * Expands or collapses a theme's layer list in the panel.
   *
   * @param theme - The theme to update
   * @param expanded - Whether the layer list should be shown
   */
  setThemeExpanded(theme: OvertureTheme, expanded: boolean): void {
    const themeState = this._state.themes[theme];
    if (!themeState || themeState.expanded === expanded) {
      return;
    }
    themeState.expanded = expanded;
    this._syncThemeGroup(theme);
    this._emit('statechange');
  }

  /**
   * Enables or disables the feature inspection picker.
   *
   * @param enabled - Whether clicking a feature opens a properties popup
   */
  setInspect(enabled: boolean): void {
    if (this._state.inspect === enabled) {
      return;
    }
    this._state.inspect = enabled;
    if (enabled) {
      this._setupInspect();
    } else {
      this._teardownInspect();
    }
    if (this._inspectCheckbox) {
      this._inspectCheckbox.checked = enabled;
    }
    this._emit('statechange');
  }

  /**
   * Collects the features of a layer rendered in the current map view as a
   * GeoJSON FeatureCollection.
   *
   * Only features painted in the current viewport are returned, deduplicated
   * across tile boundaries. Combine with a high zoom level to keep the
   * result limited to a small area.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   * @returns A GeoJSON FeatureCollection (possibly empty)
   */
  getRenderedLayerGeoJSON(
    theme: OvertureTheme,
    sourceLayer: string
  ): FeatureCollection {
    const collection: FeatureCollection = { type: 'FeatureCollection', features: [] };
    if (!this._map) {
      return collection;
    }
    const layerIds = layerIdsForSourceLayer(theme, sourceLayer).filter((id) =>
      this._map!.getLayer(id)
    );
    if (!layerIds.length) {
      return collection;
    }

    const seen = new Set<string>();
    for (const feature of this._map.queryRenderedFeatures({ layers: layerIds })) {
      const key =
        feature.id != null
          ? `${feature.sourceLayer ?? ''}:${feature.id}`
          : JSON.stringify([feature.geometry, feature.properties]);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      collection.features.push({
        type: 'Feature',
        geometry: feature.geometry,
        properties: feature.properties ?? {},
      });
    }
    return collection;
  }

  /**
   * Exports a layer's features in the current view to a downloaded GeoJSON
   * file. The export is gated by `exportMinZoom` so it only ever covers a
   * small area.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   * @returns The exported FeatureCollection, or null when nothing was exported
   */
  exportLayer(theme: OvertureTheme, sourceLayer: string): FeatureCollection | null {
    if (!this._map) {
      return null;
    }
    const label = this._humanizeLayer(sourceLayer);
    const layerState = this._state.themes[theme]?.layers[sourceLayer];
    if (!layerState?.visible) {
      this._notify(`Enable ${label} before exporting.`);
      return null;
    }
    if (this._map.getZoom() < this._options.exportMinZoom) {
      this._notify(`Zoom in (level ${this._options.exportMinZoom}+) to export ${label}.`);
      return null;
    }

    const collection = this.getRenderedLayerGeoJSON(theme, sourceLayer);
    if (!collection.features.length) {
      this._notify(`No ${label} features in the current view.`);
      return null;
    }

    this._downloadGeoJSON(`overture-${theme}-${sourceLayer}.geojson`, collection);
    const count = collection.features.length;
    this._notify(`Exported ${count} ${label} feature${count === 1 ? '' : 's'}.`);
    return collection;
  }

  /**
   * Triggers a browser download of a GeoJSON object.
   *
   * @param filename - The download file name
   * @param data - The GeoJSON object to serialize
   */
  private _downloadGeoJSON(filename: string, data: FeatureCollection): void {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  /**
   * Shows a transient notice message in the panel.
   *
   * @param message - The message to display
   */
  private _notify(message: string): void {
    if (!this._noticeEl) {
      return;
    }
    this._noticeEl.textContent = message;
    this._noticeEl.style.display = message ? 'block' : 'none';
    if (this._noticeTimer != null) {
      clearTimeout(this._noticeTimer);
      this._noticeTimer = null;
    }
    if (message) {
      this._noticeTimer = setTimeout(() => {
        if (this._noticeEl) {
          this._noticeEl.style.display = 'none';
        }
        this._noticeTimer = null;
      }, 5000);
    }
  }

  /**
   * Re-fetches the list of available Overture releases.
   *
   * @returns The available releases, newest first
   */
  async refreshReleases(): Promise<string[]> {
    const { latest, releases } = await fetchReleases(this._options.releasesUrl);
    this._state.releases = releases;
    if (!this._state.release) {
      this._state.release = latest;
    }
    this._renderReleaseOptions();
    this._emit('statechange');
    return releases;
  }

  /**
   * Emits an event to all registered handlers.
   *
   * @param event - The event type to emit
   */
  private _emit(event: OvertureMapsEvent): void {
    const handlers = this._eventHandlers.get(event);
    if (handlers) {
      const eventData = { type: event, state: this.getState() };
      handlers.forEach((handler) => handler(eventData));
    }
  }

  /**
   * Returns a deep copy of the per-theme state.
   */
  private _cloneThemes(): Record<OvertureTheme, OvertureThemeState> {
    const themes = {} as Record<OvertureTheme, OvertureThemeState>;
    for (const theme of THEME_IDS) {
      const source = this._state.themes[theme];
      const layers = {} as Record<string, OvertureLayerState>;
      for (const sourceLayer of Object.keys(source.layers)) {
        layers[sourceLayer] = { ...source.layers[sourceLayer] };
      }
      themes[theme] = { expanded: source.expanded, layers };
    }
    return themes;
  }

  /**
   * Fetches the release list, falling back gracefully when unavailable,
   * then renders the visible themes.
   */
  private async _initializeReleases(): Promise<void> {
    try {
      await this.refreshReleases();
      this._setError(null);
    } catch (error) {
      if (!this._state.release) {
        this._state.release = FALLBACK_RELEASE;
        this._state.releases = [FALLBACK_RELEASE];
        this._renderReleaseOptions();
      }
      this._setError(
        `Could not load the Overture release list (${
          error instanceof Error ? error.message : 'unknown error'
        }). Using ${this._state.release}.`
      );
    }
    this._applyRelease();
  }

  /**
   * Records an error message and emits an `error` event when set.
   *
   * @param message - The error message, or null to clear
   */
  private _setError(message: string | null): void {
    this._state.error = message;
    if (this._errorEl) {
      this._errorEl.textContent = message ?? '';
      this._errorEl.style.display = message ? 'block' : 'none';
    }
    if (message) {
      this._emit('error');
    }
  }

  /**
   * Rebuilds the sources and layers for all visible layers using the
   * active release.
   */
  private _applyRelease(): void {
    if (!this._map || !this._state.release) {
      return;
    }
    this._removeAllThemes();
    for (const theme of THEME_IDS) {
      const themeState = this._state.themes[theme];
      for (const sourceLayer of Object.keys(themeState.layers)) {
        if (themeState.layers[sourceLayer].visible) {
          this._addLayer(theme, sourceLayer);
        }
      }
    }
  }

  /**
   * Ensures a theme's vector source exists on the map.
   *
   * @param theme - The theme whose source to add
   */
  private _ensureSource(theme: OvertureTheme): void {
    if (!this._map || !this._state.release) {
      return;
    }
    const sourceId = sourceIdForTheme(theme);
    if (!this._map.getSource(sourceId)) {
      this._map.addSource(sourceId, {
        type: 'vector',
        url: tileUrlForTheme(this._options.tilesBaseUrl, this._state.release, theme),
      });
    }
  }

  /**
   * Adds the layers for a single source layer to the map.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   */
  private _addLayer(theme: OvertureTheme, sourceLayer: string): void {
    if (!this._map || !this._state.release) {
      return;
    }
    this._ensureSource(theme);
    const layerState = this._state.themes[theme].layers[sourceLayer];
    for (const spec of buildSourceLayerSpecs(
      theme,
      sourceLayer,
      layerState.opacity,
      layerState.color,
      layerState.size
    )) {
      if (!this._map.getLayer(spec.id)) {
        // Insert at the position that keeps the THEME_IDS draw order
        // (first theme on top), regardless of the order layers are toggled.
        this._map.addLayer(spec, this._beforeIdFor(spec.id));
      }
    }
  }

  /**
   * The canonical back-to-front order of every Overture layer id.
   *
   * Themes are drawn back to front in reverse of {@link THEME_IDS}, so the
   * first panel theme (e.g. addresses) ends up on top of the map.
   *
   * @returns Layer ids from bottom-most to top-most
   */
  private _orderedLayerIds(): string[] {
    const ids: string[] = [];
    for (let i = THEME_IDS.length - 1; i >= 0; i--) {
      ids.push(...layerIdsForTheme(THEME_IDS[i]));
    }
    return ids;
  }

  /**
   * Finds the layer a new layer should be inserted before to preserve the
   * canonical draw order.
   *
   * @param layerId - The id of the layer being added
   * @returns The id of the next existing layer above it, or undefined to
   *   append on top
   */
  private _beforeIdFor(layerId: string): string | undefined {
    const order = this._orderedLayerIds();
    const index = order.indexOf(layerId);
    if (index < 0) {
      return undefined;
    }
    for (let i = index + 1; i < order.length; i++) {
      if (this._map?.getLayer(order[i])) {
        return order[i];
      }
    }
    return undefined;
  }

  /**
   * Removes the layers for a single source layer, dropping the theme source
   * once none of its layers remain on the map.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   */
  private _removeLayer(theme: OvertureTheme, sourceLayer: string): void {
    if (!this._map) {
      return;
    }
    for (const layerId of layerIdsForSourceLayer(theme, sourceLayer)) {
      if (this._map.getLayer(layerId)) {
        this._map.removeLayer(layerId);
      }
    }
    const sourceId = sourceIdForTheme(theme);
    const stillUsed = layerIdsForTheme(theme).some((id) => this._map?.getLayer(id));
    if (!stillUsed && this._map.getSource(sourceId)) {
      this._map.removeSource(sourceId);
    }
  }

  /**
   * Removes the layers and source for a theme from the map.
   *
   * @param theme - The theme to remove
   */
  private _removeTheme(theme: OvertureTheme): void {
    if (!this._map) {
      return;
    }
    for (const layerId of layerIdsForTheme(theme)) {
      if (this._map.getLayer(layerId)) {
        this._map.removeLayer(layerId);
      }
    }
    const sourceId = sourceIdForTheme(theme);
    if (this._map.getSource(sourceId)) {
      this._map.removeSource(sourceId);
    }
  }

  /**
   * Removes all Overture layers and sources from the map.
   */
  private _removeAllThemes(): void {
    for (const theme of THEME_IDS) {
      this._removeTheme(theme);
    }
  }

  /**
   * Returns the ids of all Overture layers currently on the map.
   */
  private _renderedLayerIds(): string[] {
    if (!this._map) {
      return [];
    }
    const ids: string[] = [];
    for (const theme of THEME_IDS) {
      for (const layerId of layerIdsForTheme(theme)) {
        if (this._map.getLayer(layerId)) {
          ids.push(layerId);
        }
      }
    }
    return ids;
  }

  /**
   * Wires click and hover handlers for feature inspection.
   */
  private _setupInspect(): void {
    if (!this._map || this._clickHandler) {
      return;
    }

    this._clickHandler = (e: MapMouseEvent) => {
      if (!this._map) return;
      const layers = this._renderedLayerIds();
      if (!layers.length) return;
      const features = this._map.queryRenderedFeatures(e.point, { layers });
      if (!features.length) return;

      const feature = features[0];
      this._popup?.remove();
      this._popup = new (getMapLibre().Popup)({
        maxWidth: '320px',
        className: 'overture-popup',
      })
        .setLngLat(e.lngLat)
        .setDOMContent(this._buildPopupContent(feature.sourceLayer ?? '', feature.properties ?? {}))
        .addTo(this._map);
    };
    this._map.on('click', this._clickHandler);

    this._moveHandler = (e: MapMouseEvent) => {
      if (!this._map) return;
      const layers = this._renderedLayerIds();
      if (!layers.length) return;
      const features = this._map.queryRenderedFeatures(e.point, { layers });
      this._map.getCanvas().style.cursor = features.length ? 'pointer' : '';
    };
    this._map.on('mousemove', this._moveHandler);
  }

  /**
   * Removes the feature inspection handlers and any open popup.
   */
  private _teardownInspect(): void {
    if (this._clickHandler && this._map) {
      this._map.off('click', this._clickHandler);
    }
    this._clickHandler = null;
    if (this._moveHandler && this._map) {
      this._map.off('mousemove', this._moveHandler);
    }
    this._moveHandler = null;
    this._popup?.remove();
    this._popup = undefined;
    if (this._map) {
      this._map.getCanvas().style.cursor = '';
    }
  }

  /**
   * Sanitizes a feature-sourced value for display in the popup.
   *
   * Strips control characters and truncates long values so malformed
   * tile properties cannot break the UI.
   *
   * @param value - The raw property key or value
   * @param maxLength - Maximum displayed length
   * @returns A safe display string
   */
  private _sanitizeDisplayString(value: unknown, maxLength = 200): string {
    const text =
      typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
    // eslint-disable-next-line no-control-regex
    const cleaned = text.replace(/[\u0000-\u001f\u007f]/g, '');
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}…` : cleaned;
  }

  /**
   * Builds the popup DOM showing a feature's properties.
   *
   * @param sourceLayer - The feature's source layer name
   * @param properties - The feature properties
   * @returns The popup content element
   */
  private _buildPopupContent(
    sourceLayer: string,
    properties: Record<string, unknown>
  ): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = `overture-popup-content${this._schemeClass()}`;

    const heading = document.createElement('div');
    heading.className = 'overture-popup-heading';
    heading.textContent = this._sanitizeDisplayString(sourceLayer || 'feature', 80);
    wrapper.appendChild(heading);

    const table = document.createElement('table');
    table.className = 'overture-popup-table';
    const entries = Object.entries(properties);
    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'overture-popup-empty';
      empty.textContent = 'No properties';
      wrapper.appendChild(empty);
      return wrapper;
    }
    for (const [key, value] of entries) {
      const row = document.createElement('tr');
      const keyCell = document.createElement('td');
      keyCell.className = 'overture-popup-key';
      keyCell.textContent = this._sanitizeDisplayString(key, 80);
      const valueCell = document.createElement('td');
      valueCell.className = 'overture-popup-value';
      valueCell.textContent = this._sanitizeDisplayString(value);
      row.appendChild(keyCell);
      row.appendChild(valueCell);
      table.appendChild(row);
    }
    wrapper.appendChild(table);
    return wrapper;
  }

  /**
   * Returns whether the system currently prefers a dark color scheme.
   */
  private _prefersDark(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    );
  }

  /**
   * Resolves the active color scheme. In `auto` mode this follows the
   * system `prefers-color-scheme`.
   *
   * @returns The resolved scheme
   */
  private _resolvedScheme(): 'light' | 'dark' {
    if (this._options.theme === 'light') return 'light';
    if (this._options.theme === 'dark') return 'dark';
    return this._prefersDark() ? 'dark' : 'light';
  }

  /**
   * Returns the color-scheme class suffix for the resolved scheme.
   */
  private _schemeClass(): string {
    return ` ovt-theme-${this._resolvedScheme()}`;
  }

  /**
   * Applies the resolved color-scheme class to the container and panel.
   * Called on creation and whenever the system theme changes in `auto` mode.
   */
  private _applyScheme(): void {
    const cls = `ovt-theme-${this._resolvedScheme()}`;
    for (const el of [this._container, this._panel]) {
      el?.classList.remove('ovt-theme-light', 'ovt-theme-dark');
      el?.classList.add(cls);
    }
  }

  /**
   * Subscribes to system color-scheme changes so the control adapts live
   * when `theme` is `auto`.
   */
  private _setupSchemeListener(): void {
    if (
      this._options.theme !== 'auto' ||
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    this._schemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
    this._schemeListener = () => this._applyScheme();
    this._schemeMedia.addEventListener('change', this._schemeListener);
  }

  /**
   * Creates the main container element for the control.
   * Contains a toggle button (29x29) matching navigation control size.
   *
   * @returns The container element
   */
  private _createContainer(): HTMLElement {
    const container = document.createElement('div');
    container.className = `maplibregl-ctrl maplibregl-ctrl-group overture-control${this._schemeClass()}${
      this._options.className ? ` ${this._options.className}` : ''
    }`;

    // Create toggle button (29x29 to match navigation control)
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'overture-control-toggle';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-label', this._options.title);
    toggleBtn.innerHTML = `
      <span class="overture-control-icon">
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="9" cy="9" r="6"/>
          <circle cx="15" cy="9" r="6"/>
          <circle cx="12" cy="15" r="6"/>
        </svg>
      </span>
    `;
    toggleBtn.addEventListener('click', () => this.toggle());

    container.appendChild(toggleBtn);

    return container;
  }

  /**
   * Creates the panel element with header and content areas.
   * Panel is positioned as a dropdown below the toggle button.
   *
   * @returns The panel element
   */
  private _createPanel(): HTMLElement {
    const panel = document.createElement('div');
    panel.className = `overture-control-panel${this._schemeClass()}`;
    panel.style.width = `${this._options.panelWidth}px`;

    // Create header with title and close button
    const header = document.createElement('div');
    header.className = 'overture-control-header';

    const title = document.createElement('span');
    title.className = 'overture-control-title';
    title.textContent = this._options.title;

    const closeBtn = document.createElement('button');
    closeBtn.className = 'overture-control-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close panel');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => this.collapse());

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Create content area
    const content = document.createElement('div');
    content.className = 'overture-control-content';

    content.appendChild(this._createReleaseRow());
    content.appendChild(this._createInspectRow());

    this._errorEl = document.createElement('div');
    this._errorEl.className = 'overture-control-error';
    this._errorEl.style.display = 'none';
    content.appendChild(this._errorEl);

    this._noticeEl = document.createElement('div');
    this._noticeEl.className = 'overture-control-notice';
    this._noticeEl.style.display = 'none';
    content.appendChild(this._noticeEl);

    const themeList = document.createElement('div');
    themeList.className = 'overture-control-themes';
    for (const theme of THEME_IDS) {
      themeList.appendChild(this._createThemeGroup(theme));
    }
    content.appendChild(themeList);

    const hint = document.createElement('p');
    hint.className = 'overture-control-hint';
    hint.textContent = 'Addresses and places appear at zoom 14+.';
    content.appendChild(hint);

    panel.appendChild(header);
    panel.appendChild(content);

    // Drag handle for resizing the panel width (positioned per corner)
    panel.appendChild(this._createResizeHandle());

    return panel;
  }

  /**
   * Creates the feature inspection toggle row.
   *
   * @returns The inspect row element
   */
  private _createInspectRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'overture-inspect-row';

    const label = document.createElement('label');
    label.className = 'overture-inspect-toggle';

    this._inspectCheckbox = document.createElement('input');
    this._inspectCheckbox.type = 'checkbox';
    this._inspectCheckbox.className = 'overture-inspect-checkbox';
    this._inspectCheckbox.checked = this._state.inspect;
    this._inspectCheckbox.addEventListener('change', () => {
      this.setInspect(this._inspectCheckbox!.checked);
    });

    const text = document.createElement('span');
    text.textContent = 'Inspect features on click';

    label.appendChild(this._inspectCheckbox);
    label.appendChild(text);
    row.appendChild(label);
    return row;
  }

  /**
   * Creates the panel drag handle used to resize the panel width.
   *
   * @returns The resize handle element
   */
  private _createResizeHandle(): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'overture-resize-handle';
    handle.setAttribute('aria-hidden', 'true');
    handle.addEventListener('pointerdown', (e) => this._startResize(e));
    return handle;
  }

  /**
   * Creates the release selector row.
   *
   * @returns The release row element
   */
  private _createReleaseRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'overture-release-row';

    const label = document.createElement('label');
    label.className = 'overture-control-label';
    label.textContent = 'Release';

    this._releaseSelect = document.createElement('select');
    this._releaseSelect.className = 'overture-release-select';
    this._releaseSelect.setAttribute('aria-label', 'Overture release');
    this._releaseSelect.addEventListener('change', () => {
      if (this._releaseSelect) {
        this.setRelease(this._releaseSelect.value);
      }
    });
    label.appendChild(this._releaseSelect);
    row.appendChild(label);

    this._renderReleaseOptions();
    return row;
  }

  /**
   * Re-populates the release selector options from state.
   */
  private _renderReleaseOptions(): void {
    if (!this._releaseSelect) {
      return;
    }
    this._releaseSelect.innerHTML = '';
    for (const release of this._state.releases) {
      const option = document.createElement('option');
      option.value = release;
      option.textContent = release;
      this._releaseSelect.appendChild(option);
    }
    if (this._state.release) {
      this._releaseSelect.value = this._state.release;
    }
    this._releaseSelect.disabled = this._state.releases.length === 0;
  }

  /**
   * Creates a collapsible panel group for one theme: a header with a master
   * checkbox and an expand toggle, plus a row per source layer.
   *
   * @param theme - The theme to render
   * @returns The theme group element
   */
  private _createThemeGroup(theme: OvertureTheme): HTMLElement {
    const def = THEMES[theme];
    const themeState = this._state.themes[theme];

    const group = document.createElement('div');
    group.className = 'overture-theme-group';
    group.dataset.theme = theme;

    const header = document.createElement('div');
    header.className = 'overture-theme-header';

    const caret = document.createElement('button');
    caret.type = 'button';
    caret.className = 'overture-theme-caret';
    caret.setAttribute('aria-label', `Toggle ${def.label} layers`);
    caret.setAttribute('aria-expanded', String(themeState.expanded));
    caret.innerHTML = '&rsaquo;';
    caret.addEventListener('click', () => {
      this.setThemeExpanded(theme, !this._state.themes[theme].expanded);
    });

    const label = document.createElement('label');
    label.className = 'overture-theme-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'overture-theme-checkbox';
    checkbox.addEventListener('change', () => {
      this.setThemeVisible(theme, checkbox.checked);
    });

    const name = document.createElement('span');
    name.className = 'overture-theme-name';
    name.textContent = def.label;

    label.appendChild(checkbox);
    label.appendChild(name);

    header.appendChild(caret);
    header.appendChild(label);

    const layers = document.createElement('div');
    layers.className = 'overture-theme-layers';
    for (const layer of def.layers) {
      layers.appendChild(this._createLayerRow(theme, layer.sourceLayer));
    }

    group.appendChild(header);
    group.appendChild(layers);

    this._applyThemeGroupState(group, theme);
    return group;
  }

  /**
   * Creates a panel row for one source layer: a checkbox, color swatch,
   * label, and a style button that reveals an inline editor for color,
   * size, and opacity.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   * @returns The layer row element
   */
  private _createLayerRow(theme: OvertureTheme, sourceLayer: string): HTMLElement {
    const layerState = this._state.themes[theme].layers[sourceLayer];
    const label = this._humanizeLayer(sourceLayer);

    const row = document.createElement('div');
    row.className = 'overture-layer-row';
    row.dataset.layer = sourceLayer;

    const head = document.createElement('div');
    head.className = 'overture-layer-head';

    const toggle = document.createElement('label');
    toggle.className = 'overture-layer-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'overture-layer-checkbox';
    checkbox.checked = layerState.visible;
    checkbox.addEventListener('change', () => {
      this.setLayerVisible(theme, sourceLayer, checkbox.checked);
    });

    const swatch = document.createElement('span');
    swatch.className = 'overture-layer-swatch';
    swatch.style.backgroundColor = layerState.color;

    const name = document.createElement('span');
    name.className = 'overture-layer-name';
    name.textContent = label;

    toggle.appendChild(checkbox);
    toggle.appendChild(swatch);
    toggle.appendChild(name);

    const styleBtn = document.createElement('button');
    styleBtn.type = 'button';
    styleBtn.className = 'overture-layer-style-btn';
    styleBtn.setAttribute('aria-label', `Edit ${label} style`);
    styleBtn.setAttribute('aria-expanded', 'false');
    styleBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="4" y1="8" x2="20" y2="8"/>
        <circle cx="9" cy="8" r="2"/>
        <line x1="4" y1="16" x2="20" y2="16"/>
        <circle cx="15" cy="16" r="2"/>
      </svg>
    `;
    styleBtn.addEventListener('click', () => {
      const open = row.classList.toggle('editing');
      styleBtn.setAttribute('aria-expanded', String(open));
    });

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'overture-layer-export-btn';
    exportBtn.setAttribute('aria-label', `Export ${label} in view to GeoJSON`);
    exportBtn.title = 'Export features in view to GeoJSON';
    exportBtn.disabled = !layerState.visible;
    exportBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    `;
    exportBtn.addEventListener('click', () => {
      this.exportLayer(theme, sourceLayer);
    });

    head.appendChild(toggle);
    head.appendChild(styleBtn);
    head.appendChild(exportBtn);

    row.appendChild(head);
    row.appendChild(this._createLayerEditor(theme, sourceLayer));
    return row;
  }

  /**
   * Creates the inline style editor for a layer (color, size, opacity).
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   * @returns The editor element
   */
  private _createLayerEditor(theme: OvertureTheme, sourceLayer: string): HTMLElement {
    const layerState = this._state.themes[theme].layers[sourceLayer];
    const label = this._humanizeLayer(sourceLayer);
    const geometry = findLayerDef(theme, sourceLayer)?.geometry ?? 'point';
    const isPoint = geometry === 'point';

    const editor = document.createElement('div');
    editor.className = 'overture-layer-editor';

    // Color
    const colorRow = document.createElement('label');
    colorRow.className = 'overture-style-field';
    const colorName = document.createElement('span');
    colorName.textContent = 'Color';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'overture-layer-color';
    colorInput.value = layerState.color;
    colorInput.setAttribute('aria-label', `${label} color`);
    colorInput.addEventListener('input', () => {
      this.setLayerColor(theme, sourceLayer, colorInput.value);
    });
    colorRow.appendChild(colorName);
    colorRow.appendChild(colorInput);

    // Size (circle radius for points, line width otherwise)
    const sizeRow = document.createElement('label');
    sizeRow.className = 'overture-style-field';
    const sizeName = document.createElement('span');
    sizeName.textContent = isPoint ? 'Radius' : 'Width';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'range';
    sizeInput.className = 'overture-layer-size';
    sizeInput.min = isPoint ? '1' : '0.5';
    sizeInput.max = isPoint ? '12' : '6';
    sizeInput.step = '0.5';
    sizeInput.value = String(layerState.size);
    sizeInput.disabled = !layerState.visible;
    sizeInput.setAttribute('aria-label', `${label} ${isPoint ? 'radius' : 'width'}`);
    sizeInput.addEventListener('input', () => {
      this.setLayerSize(theme, sourceLayer, Number(sizeInput.value));
    });
    sizeRow.appendChild(sizeName);
    sizeRow.appendChild(sizeInput);

    // Opacity
    const opacityRow = document.createElement('label');
    opacityRow.className = 'overture-style-field';
    const opacityName = document.createElement('span');
    opacityName.textContent = 'Opacity';
    const opacityInput = document.createElement('input');
    opacityInput.type = 'range';
    opacityInput.className = 'overture-layer-opacity';
    opacityInput.min = '0';
    opacityInput.max = '1';
    opacityInput.step = '0.05';
    opacityInput.value = String(layerState.opacity);
    opacityInput.disabled = !layerState.visible;
    opacityInput.setAttribute('aria-label', `${label} opacity`);
    opacityInput.addEventListener('input', () => {
      this.setLayerOpacity(theme, sourceLayer, Number(opacityInput.value));
    });
    opacityRow.appendChild(opacityName);
    opacityRow.appendChild(opacityInput);

    editor.appendChild(colorRow);
    editor.appendChild(sizeRow);
    editor.appendChild(opacityRow);
    return editor;
  }

  /**
   * Turns a source-layer name into a human-readable label.
   *
   * @param sourceLayer - The source-layer name (e.g. `land_cover`)
   * @returns A display label (e.g. `Land cover`)
   */
  private _humanizeLayer(sourceLayer: string): string {
    const spaced = sourceLayer.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  /**
   * Applies expanded state and master-checkbox state to a theme group.
   *
   * @param group - The theme group element
   * @param theme - The theme the group represents
   */
  private _applyThemeGroupState(group: HTMLElement, theme: OvertureTheme): void {
    const themeState = this._state.themes[theme];
    group.classList.toggle('expanded', themeState.expanded);

    const caret = group.querySelector<HTMLElement>('.overture-theme-caret');
    caret?.setAttribute('aria-expanded', String(themeState.expanded));

    const layerStates = Object.values(themeState.layers);
    const visibleCount = layerStates.filter((l) => l.visible).length;
    const checkbox = group.querySelector<HTMLInputElement>('.overture-theme-checkbox');
    if (checkbox) {
      checkbox.checked = visibleCount === layerStates.length;
      checkbox.indeterminate = visibleCount > 0 && visibleCount < layerStates.length;
    }
  }

  /**
   * Syncs a theme group's header and every layer row with the current state.
   *
   * @param theme - The theme to update
   */
  private _syncThemeGroup(theme: OvertureTheme): void {
    const group = this._panel?.querySelector<HTMLElement>(
      `.overture-theme-group[data-theme="${theme}"]`
    );
    if (!group) {
      return;
    }
    this._applyThemeGroupState(group, theme);
    for (const sourceLayer of Object.keys(this._state.themes[theme].layers)) {
      this._syncLayerRow(theme, sourceLayer);
    }
  }

  /**
   * Syncs a single layer row's inputs with the current state.
   *
   * @param theme - The theme the layer belongs to
   * @param sourceLayer - The source-layer name
   */
  private _syncLayerRow(theme: OvertureTheme, sourceLayer: string): void {
    const row = this._panel?.querySelector<HTMLElement>(
      `.overture-theme-group[data-theme="${theme}"] .overture-layer-row[data-layer="${sourceLayer}"]`
    );
    if (!row) {
      return;
    }
    const layerState = this._state.themes[theme].layers[sourceLayer];
    const checkbox = row.querySelector<HTMLInputElement>('.overture-layer-checkbox');
    const swatch = row.querySelector<HTMLElement>('.overture-layer-swatch');
    const colorInput = row.querySelector<HTMLInputElement>('.overture-layer-color');
    const sizeInput = row.querySelector<HTMLInputElement>('.overture-layer-size');
    const opacityInput = row.querySelector<HTMLInputElement>('.overture-layer-opacity');
    const exportBtn = row.querySelector<HTMLButtonElement>('.overture-layer-export-btn');
    if (checkbox) {
      checkbox.checked = layerState.visible;
    }
    if (exportBtn) {
      exportBtn.disabled = !layerState.visible;
    }
    if (swatch) {
      swatch.style.backgroundColor = layerState.color;
    }
    if (colorInput) {
      colorInput.value = layerState.color;
    }
    if (sizeInput) {
      sizeInput.value = String(layerState.size);
      sizeInput.disabled = !layerState.visible;
    }
    if (opacityInput) {
      opacityInput.value = String(layerState.opacity);
      opacityInput.disabled = !layerState.visible;
    }
  }

  /**
   * Starts a panel-width drag-resize from the handle.
   *
   * @param event - The initiating pointer event
   */
  private _startResize(event: PointerEvent): void {
    if (!this._panel) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = this._panel.getBoundingClientRect().width;
    const position = this._getControlPosition();
    const anchorLeft = position === 'top-left' || position === 'bottom-left';
    this._panel.classList.add('resizing');

    const maxWidth = Math.min(
      MAX_PANEL_WIDTH,
      (this._mapContainer?.clientWidth ?? window.innerWidth) - 20
    );

    this._resizePointerMove = (e: PointerEvent) => {
      if (!this._panel) {
        return;
      }
      const delta = e.clientX - startX;
      // Left-anchored panels grow rightward; right-anchored grow leftward
      const raw = anchorLeft ? startWidth + delta : startWidth - delta;
      const width = Math.min(maxWidth, Math.max(MIN_PANEL_WIDTH, raw));
      this._panel.style.width = `${width}px`;
      this._state.panelWidth = Math.round(width);
      this._updatePanelPosition();
    };

    this._resizePointerUp = () => {
      if (this._resizePointerMove) {
        document.removeEventListener('pointermove', this._resizePointerMove);
        this._resizePointerMove = null;
      }
      if (this._resizePointerUp) {
        document.removeEventListener('pointerup', this._resizePointerUp);
        this._resizePointerUp = null;
      }
      this._panel?.classList.remove('resizing');
      this._emit('statechange');
    };

    document.addEventListener('pointermove', this._resizePointerMove);
    document.addEventListener('pointerup', this._resizePointerUp);
  }

  /**
   * Setup event listeners for panel positioning and click-outside behavior.
   */
  private _setupEventListeners(): void {
    // Click outside to close (check both container and panel since they're now separate)
    this._clickOutsideHandler = (e: MouseEvent) => {
      if (this._suppressClickOutside) {
        return;
      }
      const target = e.target as Node;
      if (
        this._container &&
        this._panel &&
        !this._container.contains(target) &&
        !this._panel.contains(target)
      ) {
        this.collapse();
      }
    };
    document.addEventListener('click', this._clickOutsideHandler);

    // Update panel position on window resize
    this._resizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    window.addEventListener('resize', this._resizeHandler);

    // Update panel position on map resize (e.g., sidebar toggle)
    this._mapResizeHandler = () => {
      if (!this._state.collapsed) {
        this._updatePanelPosition();
      }
    };
    this._map?.on('resize', this._mapResizeHandler);
  }

  /**
   * Detect which corner the control is positioned in.
   *
   * @returns The position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
   */
  private _getControlPosition(): 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' {
    const parent = this._container?.parentElement;
    if (!parent) return 'top-right'; // Default

    if (parent.classList.contains('maplibregl-ctrl-top-left')) return 'top-left';
    if (parent.classList.contains('maplibregl-ctrl-top-right')) return 'top-right';
    if (parent.classList.contains('maplibregl-ctrl-bottom-left')) return 'bottom-left';
    if (parent.classList.contains('maplibregl-ctrl-bottom-right')) return 'bottom-right';

    return 'top-right'; // Default
  }

  /**
   * Update the panel position based on button location and control corner.
   * Positions the panel next to the button, expanding in the appropriate direction.
   */
  private _updatePanelPosition(): void {
    if (!this._container || !this._panel || !this._mapContainer) return;

    // Get the toggle button (first child of container)
    const button = this._container.querySelector('.overture-control-toggle');
    if (!button) return;

    const buttonRect = button.getBoundingClientRect();
    const mapRect = this._mapContainer.getBoundingClientRect();
    const position = this._getControlPosition();

    // Mark the anchored edge so the resize handle sits on the free side
    const anchorLeft = position === 'top-left' || position === 'bottom-left';
    this._panel.classList.toggle('ovt-anchor-left', anchorLeft);
    this._panel.classList.toggle('ovt-anchor-right', !anchorLeft);

    // Calculate button position relative to map container
    const buttonTop = buttonRect.top - mapRect.top;
    const buttonBottom = mapRect.bottom - buttonRect.bottom;
    const buttonLeft = buttonRect.left - mapRect.left;
    const buttonRight = mapRect.right - buttonRect.right;

    const panelGap = 5; // Gap between button and panel
    const edgeMargin = 10; // Keep the panel off the opposite map edge

    // Reset all positioning
    this._panel.style.top = '';
    this._panel.style.bottom = '';
    this._panel.style.left = '';
    this._panel.style.right = '';

    // Cap the panel height to the space between the button and the
    // opposite map edge so the content area scrolls instead of the
    // panel overflowing the viewport (important on small screens).
    const offset =
      position === 'top-left' || position === 'top-right'
        ? buttonTop + buttonRect.height + panelGap
        : buttonBottom + buttonRect.height + panelGap;
    const available = Math.max(120, mapRect.height - offset - edgeMargin);
    this._panel.style.maxHeight = `${Math.min(500, available)}px`;

    // Let the panel max-height drive content scrolling
    const content = this._panel.querySelector<HTMLElement>('.overture-control-content');
    if (content) {
      content.style.maxHeight = 'none';
    }

    switch (position) {
      case 'top-left':
        // Panel expands down and to the right
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;

      case 'top-right':
        // Panel expands down and to the left
        this._panel.style.top = `${buttonTop + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;

      case 'bottom-left':
        // Panel expands up and to the right
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.left = `${buttonLeft}px`;
        break;

      case 'bottom-right':
        // Panel expands up and to the left
        this._panel.style.bottom = `${buttonBottom + buttonRect.height + panelGap}px`;
        this._panel.style.right = `${buttonRight}px`;
        break;
    }
  }
}
