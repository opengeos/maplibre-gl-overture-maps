import type { IControl, Map as MapLibreMap, MapMouseEvent, Popup } from 'maplibre-gl';
import { getMapLibre } from './maplibre';
import type {
  OvertureMapsControlOptions,
  OvertureMapsState,
  OvertureMapsEvent,
  OvertureMapsEventHandler,
  OvertureThemeState,
} from './types';
import {
  THEMES,
  THEME_IDS,
  buildLayerSpecs,
  layerIdsForTheme,
  opacityPropertyForLayerType,
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
  visibleThemes: ['buildings', 'transportation', 'places'],
  themeColors: undefined,
  themeOpacity: undefined,
};

const DEFAULT_OPACITY = 0.8;

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

  // Panel positioning handlers
  private _resizeHandler: (() => void) | null = null;
  private _mapResizeHandler: (() => void) | null = null;
  private _clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  // Set while expanding so the click that triggered a programmatic
  // expand (e.g. an external button) is not treated as a click-outside
  private _suppressClickOutside = false;

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
      themes[theme] = {
        visible: this._options.visibleThemes.includes(theme),
        opacity: this._options.themeOpacity?.[theme] ?? DEFAULT_OPACITY,
      };
    }

    this._state = {
      collapsed: this._options.collapsed,
      panelWidth: this._options.panelWidth,
      release: this._options.release ?? '',
      releases: this._options.release ? [this._options.release] : [],
      themes,
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

    // Setup feature inspection
    if (this._options.inspect) {
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
    if (this._clickHandler && this._map) {
      this._map.off('click', this._clickHandler);
      this._clickHandler = null;
    }
    if (this._moveHandler && this._map) {
      this._map.off('mousemove', this._moveHandler);
      this._moveHandler = null;
    }
    this._popup?.remove();
    this._popup = undefined;

    // Remove Overture layers and sources
    this._removeAllThemes();

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
   * Shows or hides an Overture theme.
   *
   * @param theme - The theme to update
   * @param visible - Whether the theme should be rendered
   */
  setThemeVisible(theme: OvertureTheme, visible: boolean): void {
    const themeState = this._state.themes[theme];
    if (!themeState || themeState.visible === visible) {
      return;
    }
    themeState.visible = visible;
    if (visible) {
      this._addTheme(theme);
    } else {
      this._removeTheme(theme);
    }
    this._syncThemeRow(theme);
    this._emit('themechange');
    this._emit('statechange');
  }

  /**
   * Sets the opacity of an Overture theme.
   *
   * @param theme - The theme to update
   * @param opacity - Opacity value between 0 and 1
   */
  setThemeOpacity(theme: OvertureTheme, opacity: number): void {
    const themeState = this._state.themes[theme];
    if (!themeState) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, opacity));
    themeState.opacity = clamped;

    if (this._map && themeState.visible) {
      for (const spec of buildLayerSpecs(theme, clamped, this._options.themeColors?.[theme])) {
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

    this._syncThemeRow(theme);
    this._emit('themechange');
    this._emit('statechange');
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
      themes[theme] = { ...this._state.themes[theme] };
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
   * Rebuilds the sources and layers for all visible themes using the
   * active release.
   */
  private _applyRelease(): void {
    if (!this._map || !this._state.release) {
      return;
    }
    this._removeAllThemes();
    for (const theme of THEME_IDS) {
      if (this._state.themes[theme].visible) {
        this._addTheme(theme);
      }
    }
  }

  /**
   * Adds the source and layers for a theme to the map.
   *
   * @param theme - The theme to add
   */
  private _addTheme(theme: OvertureTheme): void {
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
    const opacity = this._state.themes[theme].opacity;
    for (const spec of buildLayerSpecs(theme, opacity, this._options.themeColors?.[theme])) {
      if (!this._map.getLayer(spec.id)) {
        this._map.addLayer(spec);
      }
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
    if (!this._map) {
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
   * Returns the forced color-scheme class suffix for the configured theme.
   */
  private _schemeClass(): string {
    if (this._options.theme === 'light') return ' ovt-theme-light';
    if (this._options.theme === 'dark') return ' ovt-theme-dark';
    return '';
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
        <svg viewBox="0 0 24 24" width="22" height="22" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 3 21 8 12 13 3 8 12 3"/>
          <polyline points="3 12.5 12 17.5 21 12.5"/>
          <polyline points="3 17 12 22 21 17"/>
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

    this._errorEl = document.createElement('div');
    this._errorEl.className = 'overture-control-error';
    this._errorEl.style.display = 'none';
    content.appendChild(this._errorEl);

    const themeList = document.createElement('div');
    themeList.className = 'overture-control-themes';
    for (const theme of THEME_IDS) {
      themeList.appendChild(this._createThemeRow(theme));
    }
    content.appendChild(themeList);

    const hint = document.createElement('p');
    hint.className = 'overture-control-hint';
    hint.textContent = 'Addresses and places appear at zoom 14+.';
    content.appendChild(hint);

    panel.appendChild(header);
    panel.appendChild(content);

    return panel;
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
   * Creates a panel row for one theme: checkbox, color swatch, label, and
   * opacity slider.
   *
   * @param theme - The theme to render
   * @returns The theme row element
   */
  private _createThemeRow(theme: OvertureTheme): HTMLElement {
    const def = THEMES[theme];
    const themeState = this._state.themes[theme];

    const row = document.createElement('div');
    row.className = 'overture-theme-row';
    row.dataset.theme = theme;

    const top = document.createElement('label');
    top.className = 'overture-theme-toggle';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'overture-theme-checkbox';
    checkbox.checked = themeState.visible;
    checkbox.addEventListener('change', () => {
      this.setThemeVisible(theme, checkbox.checked);
    });

    const swatch = document.createElement('span');
    swatch.className = 'overture-theme-swatch';
    swatch.style.backgroundColor = this._options.themeColors?.[theme] ?? def.color;

    const name = document.createElement('span');
    name.className = 'overture-theme-name';
    name.textContent = def.label;

    top.appendChild(checkbox);
    top.appendChild(swatch);
    top.appendChild(name);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'overture-theme-opacity';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = String(themeState.opacity);
    slider.disabled = !themeState.visible;
    slider.setAttribute('aria-label', `${def.label} opacity`);
    slider.addEventListener('input', () => {
      this.setThemeOpacity(theme, Number(slider.value));
    });

    row.appendChild(top);
    row.appendChild(slider);
    return row;
  }

  /**
   * Syncs a theme row's inputs with the current state.
   *
   * @param theme - The theme row to update
   */
  private _syncThemeRow(theme: OvertureTheme): void {
    const row = this._panel?.querySelector<HTMLElement>(`[data-theme="${theme}"]`);
    if (!row) {
      return;
    }
    const themeState = this._state.themes[theme];
    const checkbox = row.querySelector<HTMLInputElement>('.overture-theme-checkbox');
    const slider = row.querySelector<HTMLInputElement>('.overture-theme-opacity');
    if (checkbox) {
      checkbox.checked = themeState.visible;
    }
    if (slider) {
      slider.value = String(themeState.opacity);
      slider.disabled = !themeState.visible;
    }
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
