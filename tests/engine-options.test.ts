import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Map as MapLibreMap } from "maplibre-gl";
import type {
  OverturePopup,
  OverturePopupOptions,
} from "../src/lib/core/types";

// The control can be mounted on a map engine other than MapLibre as long as
// that engine shares the Style Spec surface (mapbox-gl does). Two things are
// MapLibre-specific and opt out through options: the `pmtiles://` protocol
// registration (`nativePmtiles`) and the inspection popup class
// (`createPopup`). These load the control fresh per test so the module-level
// "protocol already registered" latch cannot leak between them.

type Handler = (...args: unknown[]) => void;

/** A MapLibre-shaped map stub recording the sources and handlers the control adds. */
function createFakeMap() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const canvas = document.createElement("canvas");
  const handlers = new Map<string, Set<Handler>>();
  const sources = new Map<string, Record<string, unknown>>();
  const features: Array<Record<string, unknown>> = [];
  const map = {
    getContainer: () => container,
    getCanvas: () => canvas,
    getZoom: () => 15,
    on: (event: string, handler: Handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: (event: string, handler: Handler) => {
      handlers.get(event)?.delete(handler);
    },
    fire: (event: string, payload?: unknown) => {
      handlers.get(event)?.forEach((handler) => handler(payload));
    },
    getSource: (id: string) => sources.get(id),
    addSource: (id: string, spec: Record<string, unknown>) => {
      sources.set(id, spec);
    },
    getLayer: () => ({ id: "overture-buildings-building-fill" }),
    addLayer: () => undefined,
    removeLayer: () => undefined,
    removeSource: () => undefined,
    queryRenderedFeatures: () => features,
    sources,
    features,
  };
  return map;
}

/** Installs a `maplibregl` global whose `addProtocol` and `Popup` are spies. */
function installMapLibreGlobal() {
  const addProtocol = vi.fn();
  const popupCalls: OverturePopupOptions[] = [];
  class Popup {
    constructor(options: OverturePopupOptions) {
      popupCalls.push(options);
    }
    setLngLat() {
      return this;
    }
    setDOMContent() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {
      return this;
    }
  }
  (globalThis as { maplibregl?: unknown }).maplibregl = { addProtocol, Popup };
  return { addProtocol, popupCalls };
}

async function loadControl() {
  vi.resetModules();
  const { OvertureMapsControl } =
    await import("../src/lib/core/OvertureMapsControl");
  return OvertureMapsControl;
}

describe("OvertureMapsControl on a non-MapLibre engine", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ releases: [] }), { status: 500 }),
      ),
    );
  });

  afterEach(() => {
    delete (globalThis as { maplibregl?: unknown }).maplibregl;
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("registers the pmtiles:// protocol and prefixes source URLs by default", async () => {
    const { addProtocol } = installMapLibreGlobal();
    const OvertureMapsControl = await loadControl();
    const map = createFakeMap();
    const control = new OvertureMapsControl({
      release: "2026-05-20.0",
      visibleThemes: ["buildings"],
    });
    control.onAdd(map as unknown as MapLibreMap);

    expect(addProtocol).toHaveBeenCalledWith("pmtiles", expect.any(Function));
    // The sources land once the (stubbed, failing) release fetch has settled
    // and the pinned release is applied.
    await vi.waitFor(() =>
      expect(map.sources.has("overture-buildings")).toBe(true),
    );
    expect(map.sources.get("overture-buildings")).toEqual({
      type: "vector",
      url: "pmtiles://https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-05-20.0/buildings.pmtiles",
    });
    control.onRemove();
  });

  it("skips the protocol and emits plain archive URLs with nativePmtiles", async () => {
    const { addProtocol } = installMapLibreGlobal();
    const OvertureMapsControl = await loadControl();
    const map = createFakeMap();
    const control = new OvertureMapsControl({
      release: "2026-05-20.0",
      visibleThemes: ["buildings"],
      nativePmtiles: true,
    });
    control.onAdd(map as unknown as MapLibreMap);

    expect(addProtocol).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(map.sources.has("overture-buildings")).toBe(true),
    );
    expect(map.sources.get("overture-buildings")).toEqual({
      type: "vector",
      url: "https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/2026-05-20.0/buildings.pmtiles",
    });
    control.onRemove();
  });

  it("builds the inspection popup through createPopup when provided", async () => {
    const { popupCalls } = installMapLibreGlobal();
    const OvertureMapsControl = await loadControl();
    const map = createFakeMap();
    map.features.push({ sourceLayer: "building", properties: { height: 12 } });

    const created: Array<{
      options: OverturePopupOptions;
      lngLat: unknown;
      content: Node | null;
      addedTo: unknown;
      removed: boolean;
    }> = [];
    const createPopup = (options: OverturePopupOptions): OverturePopup => {
      const record = {
        options,
        lngLat: null as unknown,
        content: null as Node | null,
        addedTo: null as unknown,
        removed: false,
      };
      created.push(record);
      const popup: OverturePopup = {
        setLngLat(lngLat) {
          record.lngLat = lngLat;
          return popup;
        },
        setDOMContent(node) {
          record.content = node;
          return popup;
        },
        addTo(target) {
          record.addedTo = target;
          return popup;
        },
        remove() {
          record.removed = true;
          return popup;
        },
      };
      return popup;
    };

    const control = new OvertureMapsControl({
      release: "2026-05-20.0",
      visibleThemes: ["buildings"],
      createPopup,
    });
    control.onAdd(map as unknown as MapLibreMap);
    map.fire("click", { point: { x: 1, y: 1 }, lngLat: { lng: 10, lat: 20 } });

    expect(popupCalls).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0].options).toEqual({
      maxWidth: "320px",
      className: "overture-popup",
    });
    expect(created[0].lngLat).toEqual({ lng: 10, lat: 20 });
    expect(created[0].addedTo).toBe(map);
    expect(created[0].content?.textContent).toContain("height");

    control.onRemove();
    expect(created[0].removed).toBe(true);
  });

  it("falls back to MapLibre Popup without createPopup", async () => {
    const { popupCalls } = installMapLibreGlobal();
    const OvertureMapsControl = await loadControl();
    const map = createFakeMap();
    map.features.push({ sourceLayer: "building", properties: {} });
    const control = new OvertureMapsControl({
      release: "2026-05-20.0",
      visibleThemes: ["buildings"],
    });
    control.onAdd(map as unknown as MapLibreMap);
    map.fire("click", { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } });
    expect(popupCalls).toEqual([
      { maxWidth: "320px", className: "overture-popup" },
    ]);
    control.onRemove();
  });
});
