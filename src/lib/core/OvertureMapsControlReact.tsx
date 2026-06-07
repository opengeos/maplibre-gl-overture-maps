import { useEffect, useRef } from "react";
import { OvertureMapsControl } from "./OvertureMapsControl";
import type { OvertureMapsControlReactProps } from "./types";

/**
 * React wrapper component for OvertureMapsControl.
 *
 * This component manages the lifecycle of an OvertureMapsControl instance,
 * adding it to the map on mount and removing it on unmount.
 *
 * @example
 * ```tsx
 * import { OvertureMapsControlReact } from 'maplibre-gl-overture-maps/react';
 *
 * function MyMap() {
 *   const [map, setMap] = useState<Map | null>(null);
 *
 *   return (
 *     <>
 *       <div ref={mapContainer} />
 *       {map && (
 *         <OvertureMapsControlReact
 *           map={map}
 *           collapsed={false}
 *           visibleThemes={['buildings', 'places']}
 *         />
 *       )}
 *     </>
 *   );
 * }
 * ```
 *
 * @param props - Component props including map instance and control options
 * @returns null - This component renders nothing directly
 */
export function OvertureMapsControlReact({
  map,
  onStateChange,
  ...options
}: OvertureMapsControlReactProps): null {
  const controlRef = useRef<OvertureMapsControl | null>(null);

  useEffect(() => {
    if (!map) return;

    // Create the control instance
    const control = new OvertureMapsControl(options);
    controlRef.current = control;

    // Register state change handler if provided
    if (onStateChange) {
      control.on("statechange", (event) => {
        onStateChange(event.state);
      });
    }

    // Add control to map
    map.addControl(control, options.position || "top-right");

    // Cleanup on unmount
    return () => {
      if (map.hasControl(control)) {
        map.removeControl(control);
      }
      controlRef.current = null;
    };
  }, [map]);

  // Update options when they change
  useEffect(() => {
    if (controlRef.current) {
      // Handle collapsed state changes
      const currentState = controlRef.current.getState();
      if (
        options.collapsed !== undefined &&
        options.collapsed !== currentState.collapsed
      ) {
        if (options.collapsed) {
          controlRef.current.collapse();
        } else {
          controlRef.current.expand();
        }
      }
    }
  }, [options.collapsed]);

  // Sync pinned release changes
  useEffect(() => {
    if (controlRef.current && options.release) {
      controlRef.current.setRelease(options.release);
    }
  }, [options.release]);

  return null;
}
