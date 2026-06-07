import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchReleases,
  DEFAULT_RELEASES_URL,
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
