import { Protocol } from 'pmtiles';
import { getMapLibre } from './maplibre';

let registered = false;

/**
 * Registers the `pmtiles://` protocol with MapLibre GL once.
 *
 * Safe to call multiple times; subsequent calls are no-ops. Note that this
 * cannot detect a `pmtiles` protocol registered by the host application
 * before the plugin loads, in which case the existing handler is replaced.
 */
export function ensurePmtilesProtocol(): void {
  if (registered) {
    return;
  }
  const protocol = new Protocol();
  getMapLibre().addProtocol('pmtiles', protocol.tile);
  registered = true;
}
