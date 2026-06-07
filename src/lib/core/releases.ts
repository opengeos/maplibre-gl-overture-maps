/**
 * Default endpoint listing available Overture Maps releases.
 */
export const DEFAULT_RELEASES_URL = 'https://labs.overturemaps.org/data/releases.json';

/**
 * Default base URL for the Overture Maps PMTiles distribution.
 */
export const DEFAULT_TILES_BASE_URL =
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles';

/**
 * Release used when the releases endpoint cannot be reached.
 */
export const FALLBACK_RELEASE = '2026-05-20.0';

/**
 * Shape of the releases.json document.
 */
export interface ReleasesResponse {
  /** The latest available release, e.g. `2026-05-20.0` */
  latest: string;
  /** All available releases, newest first */
  releases: string[];
}

/**
 * Fetches and validates the list of Overture Maps releases.
 *
 * @param url - The releases endpoint (defaults to the Overture labs URL)
 * @returns The parsed releases document
 * @throws Error if the request fails or the payload is malformed
 */
export async function fetchReleases(url: string = DEFAULT_RELEASES_URL): Promise<ReleasesResponse> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch Overture releases: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  if (!isReleasesResponse(data)) {
    throw new Error('Invalid releases.json payload: expected { latest: string, releases: string[] }');
  }

  return { latest: data.latest, releases: [...data.releases] };
}

/**
 * Type guard validating the releases.json payload shape.
 *
 * @param value - The parsed JSON value
 * @returns True when the value matches {@link ReleasesResponse}
 */
function isReleasesResponse(value: unknown): value is ReleasesResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.latest === 'string' &&
    candidate.latest.length > 0 &&
    Array.isArray(candidate.releases) &&
    candidate.releases.length > 0 &&
    candidate.releases.every((release) => typeof release === 'string')
  );
}
