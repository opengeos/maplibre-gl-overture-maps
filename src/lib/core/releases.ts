/**
 * Legacy endpoint listing available Overture Maps releases.
 *
 * @deprecated Overture froze this file at `2026-07-22.0` and no longer updates
 * it, and the tiles for the release it names have since been removed from the
 * distribution bucket — so following it leaves every theme URL a 404 (issue
 * #12). It is still honoured when passed explicitly as `releasesUrl`, for a
 * self-hosted mirror that keeps the same shape, but it is no longer consulted
 * by default. See {@link resolveReleases}.
 */
export const DEFAULT_RELEASES_URL = 'https://labs.overturemaps.org/data/releases.json';

/**
 * Overture's STAC catalog, the documented replacement for the frozen
 * releases.json. Its root names the latest release but not the older ones.
 */
export const DEFAULT_STAC_CATALOG_URL = 'https://stac.overturemaps.org/catalog.json';

/**
 * Default base URL for the Overture Maps PMTiles distribution.
 */
export const DEFAULT_TILES_BASE_URL =
  'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles';

/**
 * Release used when no release source can be reached.
 */
export const FALLBACK_RELEASE = '2026-08-19.0';

/** An Overture release id: a date plus a revision, e.g. `2026-08-19.0`. */
const RELEASE_ID = /^\d{4}-\d{2}-\d{2}\.\d+$/;

/**
 * Shape of the releases.json document.
 */
export interface ReleasesResponse {
  /** The latest available release, e.g. `2026-08-19.0` */
  latest: string;
  /** All available releases, newest first */
  releases: string[];
}

/**
 * Sources {@link resolveReleases} may consult.
 */
export interface ResolveReleasesOptions {
  /**
   * A releases.json endpoint. When set, it is the only source consulted — this
   * is the escape hatch for a self-hosted mirror.
   */
  releasesUrl?: string;
  /** Base URL of the PMTiles distribution to list (defaults to Overture's) */
  tilesBaseUrl?: string;
  /** STAC catalog consulted when the distribution cannot be listed */
  stacCatalogUrl?: string;
}

/**
 * Resolves the releases the plugin can actually render.
 *
 * The distribution bucket is the authority: a release is usable only if its
 * PMTiles are still there, and Overture prunes older ones. So the default path
 * lists the bucket, falls back to the STAC catalog's `latest` when the listing
 * is unavailable, and only reads a releases.json when the caller names one.
 *
 * @param options - Sources to consult; see {@link ResolveReleasesOptions}
 * @returns The usable releases, newest first
 * @throws Error if every source consulted fails
 */
export async function resolveReleases(
  options: ResolveReleasesOptions = {}
): Promise<ReleasesResponse> {
  if (options.releasesUrl) {
    return fetchReleases(options.releasesUrl);
  }

  try {
    return await listTileReleases(options.tilesBaseUrl);
  } catch (listError) {
    try {
      return await fetchStacLatest(options.stacCatalogUrl);
    } catch (stacError) {
      // `cause` would need the ES2022 lib and this package compiles against
      // ES2020, so both underlying failures are named in the message instead.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        `Could not list the Overture tile distribution (${messageOf(listError)}) ` +
          `and the STAC catalog was unreachable (${messageOf(stacError)})`
      );
    }
  }
}

/**
 * Lists the releases present in the PMTiles distribution bucket.
 *
 * The bucket is a public S3 bucket, so its ListObjectsV2 endpoint answers
 * unauthenticated cross-origin GETs. Asking for the release prefixes with a
 * delimiter returns one `CommonPrefixes` entry per release directory.
 *
 * @param tilesBaseUrl - Base URL of the distribution (defaults to Overture's)
 * @returns The releases found, newest first
 * @throws Error if the request fails or the bucket holds no release
 */
export async function listTileReleases(
  tilesBaseUrl: string = DEFAULT_TILES_BASE_URL
): Promise<ReleasesResponse> {
  const base = new URL(tilesBaseUrl);
  // `tiles/`: the key prefix every release directory sits under, as S3 wants
  // it — no leading slash, one trailing slash.
  const prefix = `${base.pathname.replace(/^\/+/, '').replace(/\/+$/, '')}/`;
  const listUrl = `${base.origin}/?list-type=2&delimiter=%2F&prefix=${encodeURIComponent(prefix)}`;

  const response = await fetch(listUrl);
  if (!response.ok) {
    throw new Error(`Failed to list Overture releases: HTTP ${response.status}`);
  }

  // The response echoes the request prefix in its own `<Prefix>` element
  // alongside the `<CommonPrefixes>` ones, so keep only what parses as a
  // release id rather than trusting the element's position.
  const releases = [...(await response.text()).matchAll(/<Prefix>([^<]*)<\/Prefix>/g)]
    .map(([, value]) => value.slice(prefix.length).replace(/\/+$/, ''))
    .filter((release) => RELEASE_ID.test(release))
    .sort(byReleaseDescending);

  if (releases.length === 0) {
    throw new Error(`No Overture releases found under ${tilesBaseUrl}`);
  }

  return { latest: releases[0], releases };
}

/**
 * Reads the latest release from Overture's STAC catalog.
 *
 * The catalog root carries only the current release, so this returns a
 * single-entry list — enough to render, not enough to populate a history.
 *
 * @param catalogUrl - The STAC catalog root (defaults to Overture's)
 * @returns The latest release as a one-entry {@link ReleasesResponse}
 * @throws Error if the request fails or the catalog names no release
 */
export async function fetchStacLatest(
  catalogUrl: string = DEFAULT_STAC_CATALOG_URL
): Promise<ReleasesResponse> {
  const response = await fetch(catalogUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch the Overture STAC catalog: HTTP ${response.status}`);
  }

  const data: unknown = await response.json();
  const latest = (data as { latest?: unknown } | null)?.latest;
  if (typeof latest !== 'string' || !RELEASE_ID.test(latest)) {
    throw new Error('Invalid STAC catalog payload: expected a `latest` release id');
  }

  return { latest, releases: [latest] };
}

/**
 * Fetches and validates a releases.json document.
 *
 * @param url - The releases endpoint (defaults to the frozen Overture labs URL)
 * @returns The parsed releases document
 * @throws Error if the request fails or the payload is malformed
 * @see resolveReleases for the release source the control uses by default
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
 * Orders release ids newest first.
 *
 * Plain string comparison would put `2026-08-19.10` before `2026-08-19.2`, so
 * the revision after the dot is compared as a number.
 *
 * @param a - A release id
 * @param b - Another release id
 * @returns A comparator result placing the newer release first
 */
function byReleaseDescending(a: string, b: string): number {
  const [dateA, revisionA] = a.split('.');
  const [dateB, revisionB] = b.split('.');
  if (dateA !== dateB) {
    return dateA < dateB ? 1 : -1;
  }
  return Number(revisionB) - Number(revisionA);
}

/**
 * Extracts a message from a thrown value.
 *
 * @param error - The caught value
 * @returns Its message, or a placeholder for a non-Error throw
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
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
