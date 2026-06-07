import maplibregl from 'maplibre-gl';
import { OvertureMapsControl } from '../../src/index';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

// Create map centered on Lower Manhattan at zoom 14 so all Overture
// themes (including addresses and places, which appear at z14+) render.
const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [-74.006, 40.7128],
  zoom: 14,
});

// Add navigation controls to top-right
map.addControl(new maplibregl.NavigationControl(), 'top-right');

// Add fullscreen control to top-right (after navigation)
map.addControl(new maplibregl.FullscreenControl(), 'top-right');

// Add the Overture Maps control when the map loads
map.on('load', () => {
  const overtureControl = new OvertureMapsControl({
    collapsed: false,
    visibleThemes: ['buildings', 'transportation', 'places'],
  });

  // Add control to the map
  map.addControl(overtureControl, 'top-right');

  // Add Globe control to the map
  map.addControl(new maplibregl.GlobeControl(), 'top-right');

  // Listen for state changes
  overtureControl.on('statechange', (event) => {
    console.log('Overture control state changed:', event.state);
  });

  overtureControl.on('releasechange', (event) => {
    console.log('Overture release changed:', event.state.release);
  });

  overtureControl.on('themechange', (event) => {
    console.log('Overture themes changed:', event.state.themes);
  });

  overtureControl.on('error', (event) => {
    console.warn('Overture control error:', event.state.error);
  });

  console.log('Overture Maps control added to map');
});
