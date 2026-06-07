import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import maplibregl, { Map } from 'maplibre-gl';
import { OvertureMapsControlReact, useOvertureMapsState } from '../../src/react';
import '../../src/index.css';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Main App component demonstrating the React integration
 */
function App() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<Map | null>(null);
  const { state, setState, toggle } = useOvertureMapsState({ collapsed: false });

  // Initialize the map
  useEffect(() => {
    if (!mapContainer.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center: [-74.006, 40.7128],
      zoom: 14,
    });

    // Add navigation controls to top-right
    mapInstance.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Add fullscreen control to top-right (after navigation)
    mapInstance.addControl(new maplibregl.FullscreenControl(), 'top-right');

    mapInstance.on('load', () => {
      setMap(mapInstance);
    });

    return () => {
      mapInstance.remove();
    };
  }, []);

  const handleStateChange = (newState: typeof state) => {
    console.log('Overture control state changed:', newState);
    // Keep the hook state in sync so the external button label matches
    // the actual panel state (e.g. after click-outside collapses it).
    setState(newState);
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />

      {/* External toggle button */}
      <button
        onClick={toggle}
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1,
          padding: '8px 16px',
          background: '#4a90d9',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        {state.collapsed ? 'Expand' : 'Collapse'} Panel
      </button>

      {/* Overture Maps control */}
      {map && (
        <OvertureMapsControlReact
          map={map}
          collapsed={state.collapsed}
          panelWidth={320}
          visibleThemes={['buildings', 'transportation', 'places']}
          onStateChange={handleStateChange}
        />
      )}
    </div>
  );
}

// Mount the app
const root = createRoot(document.getElementById('root')!);
root.render(<App />);
