# MapLibre GL Overture Maps

A [MapLibre GL JS](https://maplibre.org/) plugin for visualizing [Overture Maps](https://overturemaps.org/) PMTiles themes. It adds a collapsible map control with a release selector and per-theme visibility and opacity controls, rendering an "x-ray" style overlay similar to [explore.overturemaps.org](https://explore.overturemaps.org/). A React wrapper and a GeoLibre Desktop plugin bundle are included.

[![npm version](https://img.shields.io/npm/v/maplibre-gl-overture-maps.svg)](https://www.npmjs.com/package/maplibre-gl-overture-maps)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Open in CodeSandbox](https://img.shields.io/badge/Open%20in-CodeSandbox-blue?logo=codesandbox)](https://codesandbox.io/p/github/opengeos/maplibre-gl-overture-maps)
[![Open in StackBlitz](https://img.shields.io/badge/Open%20in-StackBlitz-blue?logo=stackblitz)](https://stackblitz.com/github/opengeos/maplibre-gl-overture-maps)

## Features

- **All six Overture themes** - Addresses, base, buildings, divisions, places, and transportation, each loaded from the official Overture PMTiles distribution
- **Dynamic releases** - Fetches the latest [Overture release list](https://labs.overturemaps.org/data/releases.json) at runtime, with a dropdown to switch releases and an option to pin one
- **Per-layer styling** - Expand a theme to toggle each source layer individually; a style button opens an inline editor for the layer's color, size (point radius / line width), and opacity
- **GeoJSON export** - A download button on each layer exports the features rendered in the current map view to a GeoJSON file. Gated by a minimum zoom (`exportMinZoom`) so exports stay limited to a small area
- **Feature inspection** - Click any rendered Overture feature to see its properties in a popup; toggle the picker on or off from the panel
- **Resizable panel** - Drag the panel edge to resize its width; the handle adapts to whichever corner the control sits in
- **Dark and light mode** - The control UI follows `prefers-color-scheme` by default and can be forced light or dark
- **Small-screen friendly** - The panel stays within the viewport and scrolls vertically when space is tight
- **TypeScript Support** - Full TypeScript support with exported type definitions
- **React Integration** - React wrapper component and custom hook
- **GeoLibre Bundle Output** - Builds a zip with root `plugin.json`, bundled ESM, and CSS for GeoLibre Desktop
- **Modern Build Setup** - Vite-based library and GeoLibre bundle builds
- **Testing** - Vitest setup with React Testing Library
- **CI/CD Ready** - GitHub Actions for npm publishing, GitHub Pages, and Docker

## Installation

```bash
npm install maplibre-gl-overture-maps
```

`maplibre-gl` (>=3.0.0) is a peer dependency. The [pmtiles](https://github.com/protomaps/PMTiles) package is bundled as a regular dependency, and the control registers the `pmtiles://` protocol with MapLibre automatically when added to a map.

## Quick Start

### Vanilla JavaScript/TypeScript

```typescript
import maplibregl from "maplibre-gl";
import { OvertureMapsControl } from "maplibre-gl-overture-maps";
import "maplibre-gl-overture-maps/style.css";

const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/positron",
  center: [-74.006, 40.7128],
  zoom: 14,
});

map.on("load", () => {
  const control = new OvertureMapsControl({
    collapsed: false,
    visibleThemes: ["buildings", "transportation", "places"],
  });

  map.addControl(control, "top-right");
});
```

### React

```tsx
import { useEffect, useRef, useState } from "react";
import maplibregl, { Map } from "maplibre-gl";
import {
  OvertureMapsControlReact,
  useOvertureMapsState,
} from "maplibre-gl-overture-maps/react";
import "maplibre-gl-overture-maps/style.css";

function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, toggle } = useOvertureMapsState();

  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: "https://tiles.openfreemap.org/styles/positron",
      center: [-74.006, 40.7128],
      zoom: 14,
    });

    mapInstance.on("load", () => setMap(mapInstance));

    return () => mapInstance.remove();
  }, []);

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      <div ref={mapContainer} style={{ width: "100%", height: "100%" }} />
      {map && (
        <OvertureMapsControlReact
          map={map}
          collapsed={state.collapsed}
          onStateChange={(newState) => console.log(newState)}
        />
      )}
    </div>
  );
}
```

## Overture Themes

Each theme is a separate PMTiles archive from the official distribution at `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/<RELEASE>/<THEME>.pmtiles`.

| Theme            | Source layers                                                          | Default color | Notes                  |
| ---------------- | ---------------------------------------------------------------------- | ------------- | ---------------------- |
| `addresses`      | `address`                                                               | `#e6194b`     | Points appear at z14+  |
| `base`           | `land`, `land_cover`, `land_use`, `water`, `bathymetry`, `infrastructure` | `#3cb44b`     |                        |
| `buildings`      | `building`, `building_part`                                             | `#f58231`     |                        |
| `divisions`      | `division_area`, `division_boundary`, `division`                        | `#911eb4`     |                        |
| `places`         | `place`                                                                  | `#4363d8`     | Points appear at z14+  |
| `transportation` | `segment`, `connector`                                                   | `#f032e6`     |                        |

## API

### OvertureMapsControl

The main control class implementing MapLibre's `IControl` interface.

#### Constructor Options

| Option          | Type                          | Default                                       | Description                                                               |
| --------------- | ----------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| `collapsed`     | `boolean`                     | `true`                                        | Whether the panel starts collapsed (showing only the 29x29 toggle button) |
| `position`      | `string`                      | `'top-right'`                                 | Control position on the map                                               |
| `title`         | `string`                      | `'Overture Maps'`                             | Title displayed in the header                                             |
| `panelWidth`    | `number`                      | `300`                                         | Width of the dropdown panel in pixels                                     |
| `className`     | `string`                      | `''`                                          | Custom CSS class name                                                     |
| `theme`         | `'light' \| 'dark' \| 'auto'` | `'auto'`                                      | UI color scheme; `'auto'` follows `prefers-color-scheme`                  |
| `release`       | `string`                      | latest                                        | Pin a specific Overture release (e.g. `'2026-05-20.0'`)                   |
| `releasesUrl`   | `string`                      | Overture labs releases.json                   | Endpoint listing available releases                                       |
| `tilesBaseUrl`  | `string`                      | Official Overture S3 tiles URL                | Base URL of the PMTiles distribution                                      |
| `inspect`       | `boolean`                     | `true`                                        | Click a rendered feature to open a properties popup                       |
| `exportMinZoom` | `number`                      | `12`                                          | Minimum zoom required to export a layer to GeoJSON (keeps exports small)  |
| `visibleThemes` | `OvertureTheme[]`             | `['buildings', 'transportation', 'places']`   | Themes that start visible                                                 |
| `themeColors`   | `Partial<Record<OvertureTheme, string>>` | x-ray palette                       | Per-theme color overrides                                                 |
| `themeOpacity`  | `Partial<Record<OvertureTheme, number>>` | `0.8`                               | Per-theme initial opacity (0..1)                                          |

#### Methods

- `toggle()` / `expand()` / `collapse()` - Control the panel
- `getState()` / `setState(state)` - Read or update the state
- `setRelease(release)` - Switch the active Overture release
- `setThemeVisible(theme, visible)` - Show or hide every layer of a theme
- `setThemeOpacity(theme, opacity)` - Set the opacity of every layer of a theme (0..1)
- `setThemeExpanded(theme, expanded)` - Expand or collapse a theme's layer list
- `setLayerVisible(theme, sourceLayer, visible)` - Show or hide a single source layer
- `setLayerOpacity(theme, sourceLayer, opacity)` - Set a single layer's opacity (0..1)
- `setLayerColor(theme, sourceLayer, color)` - Set a single layer's color
- `setLayerSize(theme, sourceLayer, size)` - Set a single layer's size (point radius / line width)
- `setInspect(enabled)` - Enable or disable the feature inspection picker
- `exportLayer(theme, sourceLayer)` - Download the layer's in-view features as GeoJSON (gated by `exportMinZoom`); returns the FeatureCollection or null
- `getRenderedLayerGeoJSON(theme, sourceLayer)` - Get the layer's in-view features as a GeoJSON FeatureCollection without downloading
- `refreshReleases()` - Re-fetch the release list
- `on(event, handler)` / `off(event, handler)` - Manage event handlers
- `getMap()` / `getContainer()` - Access the map and container

#### Events

- `collapse` / `expand` - Panel visibility changes
- `statechange` - Any state change
- `releasechange` - The active release changed
- `themechange` - A theme's visibility or opacity changed
- `error` - The release list could not be loaded (a fallback release is used)

### OvertureMapsControlReact

React wrapper component for `OvertureMapsControl`.

#### Props

All `OvertureMapsControl` options plus:

| Prop            | Type       | Description                         |
| --------------- | ---------- | ----------------------------------- |
| `map`           | `Map`      | MapLibre GL map instance (required) |
| `onStateChange` | `function` | Callback fired when state changes   |

### useOvertureMapsState

Custom React hook for managing control state.

```typescript
const {
  state, // Current state
  setState, // Update entire state
  setCollapsed, // Set collapsed state
  setPanelWidth, // Set panel width
  setRelease, // Set the active release
  setThemeVisible, // Set a theme's visibility
  setThemeOpacity, // Set a theme's opacity
  reset, // Reset to initial state
  toggle, // Toggle collapsed state
} = useOvertureMapsState(initialState);
```

### Exported Types

Exported from both entry points: `OvertureMapsControlOptions`, `OvertureMapsState`, `OvertureThemeState`, `OvertureLayerState`, `OvertureMapsEvent`, `OvertureMapsEventHandler`, `OvertureTheme`, `OvertureGeometry`, `OvertureLayerDef`, `ThemeDefinition`, and `ControlColorScheme`.

Main entry only (`.`): `ReleasesResponse`. React entry only (`/react`): `OvertureMapsControlReactProps`.

Helpers are also exported: `THEMES`, `THEME_IDS`, `buildLayerSpecs`, `layerIdsForTheme`, `sourceIdForTheme`, `tileUrlForTheme`, `fetchReleases`, `ensurePmtilesProtocol`, and more.

## Dark and Light Mode

The control UI uses CSS custom properties and follows the browser's `prefers-color-scheme` by default. Set the `theme` option to `'light'` or `'dark'` to force a scheme:

```typescript
const control = new OvertureMapsControl({ theme: "dark" });
```

## Build a GeoLibre plugin zip

GeoLibre Desktop loads external plugins from an app data `plugins/` directory. The zip must contain `plugin.json` at the root, plus a bundled ESM entry and optional CSS file.

```bash
npm install
npm run package:geolibre
```

This creates:

```text
geolibre-plugin/maplibre-gl-overture-maps-0.1.0.zip
```

The generated zip contains:

```text
plugin.json
dist/index.js
dist/style.css
```

Copy the zip into GeoLibre Desktop's app data `plugins/` directory and restart GeoLibre. On Linux with the default app identifier, that directory is usually:

```text
~/.local/share/org.geolibre.desktop/plugins/
```

For the GeoLibre web app, serve the unpacked plugin with CORS enabled:

```bash
npm run package:geolibre
npm run serve:geolibre -- 8000
```

Then add this manifest URL in GeoLibre Settings > Plugins:

```text
http://localhost:8000/plugin.json
```

Using `python -m http.server` for this cross-origin web app case is not enough
because it does not send `Access-Control-Allow-Origin`.

## Development

### Setup

```bash
# Clone the repository
git clone https://github.com/opengeos/maplibre-gl-overture-maps.git
cd maplibre-gl-overture-maps

# Install dependencies
npm install

# Start development server
npm run dev
```

### Scripts

| Script                     | Description                              |
| -------------------------- | ---------------------------------------- |
| `npm run dev`              | Start development server                 |
| `npm run build`            | Build the library and GeoLibre bundle    |
| `npm run build:lib`        | Build the standalone MapLibre library    |
| `npm run build:geolibre`   | Build the GeoLibre ESM and CSS bundle    |
| `npm run package:geolibre` | Build and zip the GeoLibre plugin bundle |
| `npm run build:examples`   | Build examples for deployment            |
| `npm run test`             | Run tests                                |
| `npm run test:ui`          | Run tests with UI                        |
| `npm run test:coverage`    | Run tests with coverage                  |
| `npm run lint`             | Lint the code                            |
| `npm run format`           | Format the code                          |

### Project Structure

```text
maplibre-gl-overture-maps/
├── geolibre-plugin/
│   └── plugin.json          # GeoLibre external plugin manifest
├── scripts/
│   └── package-geolibre-plugin.mjs
├── src/
│   ├── index.ts              # Main entry point
│   ├── geolibre.ts           # GeoLibre plugin wrapper entry point
│   ├── react.ts              # React entry point
│   ├── index.css             # Root styles
│   └── lib/
│       ├── core/             # Control, themes, releases, types
│       ├── hooks/            # React hooks
│       ├── utils/            # Utility functions
│       └── styles/           # Component styles
├── tests/                    # Test files
├── examples/                 # Example applications
│   ├── basic/               # Vanilla TypeScript example
│   └── react/               # React example
└── .github/workflows/        # CI/CD workflows
```

## Docker

The examples can be run using Docker. The image is automatically built and published to GitHub Container Registry.

### Pull and Run

```bash
# Pull the latest image
docker pull ghcr.io/opengeos/maplibre-gl-overture-maps:latest

# Run the container
docker run -p 8080:80 ghcr.io/opengeos/maplibre-gl-overture-maps:latest
```

Then open http://localhost:8080/maplibre-gl-overture-maps/ in your browser to view the examples.

### Build Locally

```bash
# Build the image
docker build -t maplibre-gl-overture-maps .

# Run the container
docker run -p 8080:80 maplibre-gl-overture-maps
```

### Available Tags

| Tag      | Description                      |
| -------- | -------------------------------- |
| `latest` | Latest release                   |
| `x.y.z`  | Specific version (e.g., `1.0.0`) |
| `x.y`    | Minor version (e.g., `1.0`)      |

## Notes

- Overture tiles are designed for x-ray inspection, not as a production basemap. See the [Overture tiles docs](https://docs.overturemaps.org/examples/overture-tiles/).
- The `addresses` and `places` themes only contain features at zoom 14 and above.
- If the release list cannot be fetched (e.g. offline), the control falls back to a known release and emits an `error` event; pin a release with the `release` option to skip the fetch dependency.

## License

MIT License - see [LICENSE](LICENSE) for details.
