import { OvertureMapsControl } from "./lib/core/OvertureMapsControl";
import type { OvertureMapsState } from "./lib/core/types";
import "./lib/styles/overture-control.css";

type GeoLibreMapControlPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

interface GeoLibreAppAPI {
  addMapControl: (
    control: OvertureMapsControl,
    position?: GeoLibreMapControlPosition,
  ) => boolean;
  removeMapControl: (control: OvertureMapsControl) => void;
}

interface GeoLibrePlugin {
  id: string;
  name: string;
  version: string;
  activate: (app: GeoLibreAppAPI) => boolean | void;
  deactivate: (app: GeoLibreAppAPI) => void;
  getMapControlPosition?: () => GeoLibreMapControlPosition;
  setMapControlPosition?: (
    app: GeoLibreAppAPI,
    position: GeoLibreMapControlPosition,
  ) => boolean | void;
  getProjectState?: () => unknown;
  applyProjectState?: (app: GeoLibreAppAPI, state: unknown) => boolean | void;
}

let control: OvertureMapsControl | null = null;
let position: GeoLibreMapControlPosition = "top-right";
let pendingState: Partial<OvertureMapsState> | null = null;

function createControl(): OvertureMapsControl {
  const nextControl = new OvertureMapsControl({
    collapsed: pendingState?.collapsed ?? true,
    panelWidth: pendingState?.panelWidth ?? 300,
    release: pendingState?.release || undefined,
    title: "Overture Maps",
  });

  if (pendingState) {
    nextControl.setState(pendingState);
  }

  return nextControl;
}

function isOvertureMapsState(
  value: unknown,
): value is Partial<OvertureMapsState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if ("collapsed" in candidate && typeof candidate.collapsed !== "boolean") {
    return false;
  }
  if ("panelWidth" in candidate && typeof candidate.panelWidth !== "number") {
    return false;
  }
  if ("release" in candidate && typeof candidate.release !== "string") {
    return false;
  }
  if (
    "themes" in candidate &&
    (typeof candidate.themes !== "object" ||
      candidate.themes === null ||
      Array.isArray(candidate.themes))
  ) {
    return false;
  }

  return true;
}

export const plugin: GeoLibrePlugin = {
  id: "maplibre-gl-overture-maps",
  name: "MapLibre GL Overture Maps",
  version: "0.2.0",
  activate(app) {
    control = control ?? createControl();
    const added = app.addMapControl(control, position);
    if (!added) {
      control = null;
      return false;
    }
  },
  deactivate(app) {
    if (!control) return;
    pendingState = control.getState();
    app.removeMapControl(control);
    control = null;
  },
  getMapControlPosition() {
    return position;
  },
  setMapControlPosition(app, nextPosition) {
    position = nextPosition;
    if (!control) return;

    app.removeMapControl(control);
    const added = app.addMapControl(control, position);
    if (!added) {
      pendingState = control.getState();
      control = null;
      return false;
    }
  },
  getProjectState() {
    return control?.getState() ?? pendingState ?? undefined;
  },
  applyProjectState(_app, state) {
    if (!isOvertureMapsState(state)) return false;
    pendingState = state;
    control?.setState(state);
  },
};

export default plugin;
