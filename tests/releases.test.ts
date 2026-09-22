import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchReleases,
  fetchStacLatest,
  listTileReleases,
  resolveReleases,
  DEFAULT_RELEASES_URL,
  DEFAULT_STAC_CATALOG_URL,
  DEFAULT_TILES_BASE_URL,
  FALLBACK_RELEASE,
} from '../src/lib/core/releases';

const VALID_PAYLOAD = {
  latest: '2026-05-20.0',
  releases: ['2026-05-20.0', '2026-04-15.0'],
};

function mockFetch(response: Partial<Response> | Error) {
  const fetchMock =
    response instanceof Error
      ? vi.fn().mockRejectedValue(response)
      : vi.fn().mockResolvedValue(response as Response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(data: unknown, ok = true, status = 200): Partial<Response> {
  return {
    ok,
    status,
    json: () => Promise.resolve(data),
  };
}

function xmlResponse(body: string, ok = true, status = 200): Partial<Response> {
  return {
    ok,
    status,
    text: () => Promise.resolve(body),
  };
}

/** An S3 ListObjectsV2 body, which echoes the request prefix alongside the
 * release directories it found. */
function listing(...releases: string[]): string {
  const common = releases
    .map((release) => `<CommonPrefixes><Prefix>tiles/${release}/</Prefix></CommonPrefixes>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>overturemaps-extras-us-west-2</Name><Prefix>tiles/</Prefix><Delimiter>/</Delimiter>${common}</ListBucketResult>`;
}

/** Answers each request from a URL -> response map, so a fallback chain can be
 * driven one leg at a time. */
function mockFetchByUrl(routes: Record<string, Partial<Response> | Error>) {
  const fetchMock = vi.fn((url: string) => {
    const match = Object.keys(routes).find((key) => url.includes(key));
    const response = match ? routes[match] : new Error(`unrouted request: ${url}`);
    return response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response as Response);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchReleases', () => {
  it('parses a valid releases payload', async () => {
    mockFetch(jsonResponse(VALID_PAYLOAD));

    const result = await fetchReleases();

    expect(result.latest).toBe('2026-05-20.0');
    expect(result.releases).toEqual(['2026-05-20.0', '2026-04-15.0']);
  });

  it('fetches from the default releases URL', async () => {
    const fetchMock = mockFetch(jsonResponse(VALID_PAYLOAD));

    await fetchReleases();

    expect(fetchMock).toHaveBeenCalledWith(DEFAULT_RELEASES_URL);
  });

  it('fetches from a custom URL when provided', async () => {
    const fetchMock = mockFetch(jsonResponse(VALID_PAYLOAD));

    await fetchReleases('https://example.com/releases.json');

    expect(fetchMock).toHaveBeenCalledWith('https://example.com/releases.json');
  });

  it('returns a copy of the releases array', async () => {
    mockFetch(jsonResponse(VALID_PAYLOAD));

    const result = await fetchReleases();
    result.releases.push('mutated');

    expect(VALID_PAYLOAD.releases).toHaveLength(2);
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetch(jsonResponse({}, false, 503));

    await expect(fetchReleases()).rejects.toThrow('HTTP 503');
  });

  it('throws on a malformed payload (missing latest)', async () => {
    mockFetch(jsonResponse({ releases: ['2026-05-20.0'] }));

    await expect(fetchReleases()).rejects.toThrow('Invalid releases.json payload');
  });

  it('throws on a malformed payload (releases not strings)', async () => {
    mockFetch(jsonResponse({ latest: '2026-05-20.0', releases: [1, 2] }));

    await expect(fetchReleases()).rejects.toThrow('Invalid releases.json payload');
  });

  it('throws on an empty releases list', async () => {
    mockFetch(jsonResponse({ latest: '2026-05-20.0', releases: [] }));

    await expect(fetchReleases()).rejects.toThrow('Invalid releases.json payload');
  });

  it('throws on a non-object payload', async () => {
    mockFetch(jsonResponse(['2026-05-20.0']));

    await expect(fetchReleases()).rejects.toThrow('Invalid releases.json payload');
  });

  it('propagates network failures', async () => {
    mockFetch(new Error('network down'));

    await expect(fetchReleases()).rejects.toThrow('network down');
  });
});

describe('constants', () => {
  it('exposes a fallback release', () => {
    expect(FALLBACK_RELEASE).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it('exposes the official tiles base URL', () => {
    expect(DEFAULT_TILES_BASE_URL).toContain('overturemaps');
  });
});

describe('listTileReleases', () => {
  it('reads the release directories out of the bucket listing', async () => {
    mockFetch(xmlResponse(listing('2026-06-17.0', '2026-08-19.0')));

    const result = await listTileReleases();

    expect(result.releases).toEqual(['2026-08-19.0', '2026-06-17.0']);
    expect(result.latest).toBe('2026-08-19.0');
  });

  it('orders same-day revisions by number, not by string', async () => {
    mockFetch(xmlResponse(listing('2026-08-19.2', '2026-08-19.10')));

    const result = await listTileReleases();

    expect(result.releases).toEqual(['2026-08-19.10', '2026-08-19.2']);
  });

  it('ignores the echoed request prefix and any non-release key', async () => {
    mockFetch(
      xmlResponse(
        listing('2026-08-19.0').replace(
          '</ListBucketResult>',
          '<CommonPrefixes><Prefix>tiles/scratch/</Prefix></CommonPrefixes></ListBucketResult>'
        )
      )
    );

    const result = await listTileReleases();

    expect(result.releases).toEqual(['2026-08-19.0']);
  });

  it('asks S3 for the release prefixes under the default distribution', async () => {
    const fetchMock = mockFetch(xmlResponse(listing('2026-08-19.0')));

    await listTileReleases();

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      'https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/?list-type=2&delimiter=%2F&prefix=tiles%2F'
    );
  });

  it('lists a custom distribution at its own origin and prefix', async () => {
    const fetchMock = mockFetch(xmlResponse(listing('2026-08-19.0').replace(/tiles\//g, 'mirror/')));

    await listTileReleases('https://example.com/mirror/');

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://example.com/?list-type=2&delimiter=%2F&prefix=mirror%2F');
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetch(xmlResponse('', false, 403));

    await expect(listTileReleases()).rejects.toThrow('HTTP 403');
  });

  it('throws when the distribution holds no release', async () => {
    mockFetch(xmlResponse(listing()));

    await expect(listTileReleases()).rejects.toThrow('No Overture releases found');
  });
});

describe('fetchStacLatest', () => {
  it('returns the catalog latest as a one-entry list', async () => {
    mockFetch(jsonResponse({ latest: '2026-08-19.0', links: [] }));

    const result = await fetchStacLatest();

    expect(result).toEqual({ latest: '2026-08-19.0', releases: ['2026-08-19.0'] });
  });

  it('fetches from the default catalog URL', async () => {
    const fetchMock = mockFetch(jsonResponse({ latest: '2026-08-19.0' }));

    await fetchStacLatest();

    expect(fetchMock).toHaveBeenCalledWith(DEFAULT_STAC_CATALOG_URL);
  });

  it('throws on a non-OK HTTP response', async () => {
    mockFetch(jsonResponse({}, false, 500));

    await expect(fetchStacLatest()).rejects.toThrow('HTTP 500');
  });

  it('throws when the catalog names no release', async () => {
    mockFetch(jsonResponse({ latest: 'not-a-release' }));

    await expect(fetchStacLatest()).rejects.toThrow('Invalid STAC catalog payload');
  });
});

describe('resolveReleases', () => {
  it('discovers releases from the distribution, not from releases.json', async () => {
    const fetchMock = mockFetchByUrl({
      'amazonaws.com/?list-type=2': xmlResponse(listing('2026-08-19.0')),
    });

    const result = await resolveReleases();

    expect(result.latest).toBe('2026-08-19.0');
    expect(fetchMock.mock.calls.every(([url]) => !url.includes('releases.json'))).toBe(true);
  });

  it('falls back to the STAC catalog when the listing is unavailable', async () => {
    mockFetchByUrl({
      'amazonaws.com/?list-type=2': new Error('listing blocked'),
      'stac.overturemaps.org': jsonResponse({ latest: '2026-08-19.0' }),
    });

    const result = await resolveReleases();

    expect(result).toEqual({ latest: '2026-08-19.0', releases: ['2026-08-19.0'] });
  });

  it('reports both sources when neither can be reached', async () => {
    mockFetchByUrl({
      'amazonaws.com/?list-type=2': new Error('listing blocked'),
      'stac.overturemaps.org': new Error('catalog blocked'),
    });

    await expect(resolveReleases()).rejects.toThrow(/listing blocked.*catalog blocked/s);
  });

  it('reads a releases.json only when one is named', async () => {
    const fetchMock = mockFetchByUrl({
      'example.com/releases.json': jsonResponse(VALID_PAYLOAD),
    });

    const result = await resolveReleases({ releasesUrl: 'https://example.com/releases.json' });

    expect(result.latest).toBe('2026-05-20.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
