import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { OvertureMapsControl } from '../src/lib/core/OvertureMapsControl';
import { THEMES } from '../src/lib/core/themes';

// Derive the expected threshold the same way the control does, so the tests
// track the theme definitions rather than a separately maintained literal.
const DETAIL_MIN_ZOOM = Math.max(
  THEMES.addresses.minzoom ?? 14,
  THEMES.places.minzoom ?? 14
);
const INACTIVE_HINT = `Addresses and places appear at zoom ${DETAIL_MIN_ZOOM}+.`;
const ACTIVE_HINT = 'Addresses and places active.';

/**
 * Builds a minimal MapLibre map stub that the control can be added to in a
 * jsdom environment. Only the methods the control touches during `onAdd`,
 * release application, and zoom-hint updates are implemented; the zoom is
 * mutable so tests can simulate the user zooming in and out, and registered
 * event handlers are captured so a `zoom` event can be fired manually.
 */
function createFakeMap(initialZoom: number) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const canvas = document.createElement('canvas');
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  let zoom = initialZoom;

  const map = {
    getContainer: () => container,
    getCanvas: () => canvas,
    getZoom: () => zoom,
    setZoom: (value: number) => {
      zoom = value;
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) {
        handlers.set(event, new Set());
      }
      handlers.get(event)!.add(handler);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    },
    fire: (event: string) => {
      handlers.get(event)?.forEach((handler) => handler());
    },
    hasHandler: (event: string) => (handlers.get(event)?.size ?? 0) > 0,
    getSource: () => undefined,
    addSource: () => undefined,
    getLayer: () => undefined,
    addLayer: () => undefined,
    removeLayer: () => undefined,
    removeSource: () => undefined,
  };

  return map;
}

function hintElement(map: ReturnType<typeof createFakeMap>): HTMLElement {
  const hint = map
    .getContainer()
    .querySelector<HTMLElement>('.overture-control-hint');
  if (!hint) {
    throw new Error('hint element not found');
  }
  return hint;
}

describe('OvertureMapsControl zoom hint', () => {
  beforeEach(() => {
    // The release list fetch is network-bound; reject it so the control falls
    // back to a static release without touching the network during the test.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline')))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('shows the heads-up below the detail-theme threshold', () => {
    const control = new OvertureMapsControl({ release: '2026-05-20.0' });
    const map = createFakeMap(10);
    control.onAdd(map as unknown as MapLibreMap);

    const hint = hintElement(map);
    expect(hint.textContent).toBe(INACTIVE_HINT);
    expect(hint.classList.contains('overture-control-hint--active')).toBe(false);
  });

  it('shows the positive confirmation at or above the threshold', () => {
    const control = new OvertureMapsControl({ release: '2026-05-20.0' });
    const map = createFakeMap(16);
    control.onAdd(map as unknown as MapLibreMap);

    const hint = hintElement(map);
    expect(hint.textContent).toBe(ACTIVE_HINT);
    expect(hint.classList.contains('overture-control-hint--active')).toBe(true);
  });

  it('updates the hint live as the map zoom crosses the threshold', () => {
    const control = new OvertureMapsControl({ release: '2026-05-20.0' });
    const map = createFakeMap(10);
    control.onAdd(map as unknown as MapLibreMap);
    const hint = hintElement(map);

    expect(hint.textContent).toBe(INACTIVE_HINT);

    map.setZoom(16);
    map.fire('zoom');
    expect(hint.textContent).toBe(ACTIVE_HINT);
    expect(hint.classList.contains('overture-control-hint--active')).toBe(true);

    map.setZoom(11);
    map.fire('zoom');
    expect(hint.textContent).toBe(INACTIVE_HINT);
    expect(hint.classList.contains('overture-control-hint--active')).toBe(false);
  });

  it('removes the zoom listener on teardown', () => {
    const control = new OvertureMapsControl({ release: '2026-05-20.0' });
    const map = createFakeMap(10);
    control.onAdd(map as unknown as MapLibreMap);
    expect(map.hasHandler('zoom')).toBe(true);

    control.onRemove();
    expect(map.hasHandler('zoom')).toBe(false);
  });
});
