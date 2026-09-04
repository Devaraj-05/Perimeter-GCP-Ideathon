import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveCoordinates, resolveQuery, LocationError } from './location';
import { __resetSecretCache } from './secrets';

/**
 * Amendment D / INV-12.
 *
 * Two properties matter here and neither is about geocoding working:
 *
 *  1. The Maps key never escapes the server. It is in the request URL, so any
 *     error built from that URL is a key disclosure. Every failure path must
 *     produce a typed code and nothing else.
 *  2. A place name is external text. It is capped and never trusted for
 *     length, type or shape — the provider is not the threat, but "we trusted
 *     the response" is how the interesting bugs start.
 */

const KEY = 'AIza-TEST-MAPS-KEY-do-not-log';

beforeEach(() => {
  __resetSecretCache();
  process.env.MAPS_API_KEY = KEY;
  delete process.env.MAPS_KEY_SECRET;
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetSecretCache();
  delete process.env.MAPS_API_KEY;
});

function stubFetch(impl: (url: string) => any) {
  vi.stubGlobal('fetch', vi.fn(async (url: any) => impl(String(url))));
}

const ok = (body: any) => ({ ok: true, json: async () => body });

const GOOD = {
  status: 'OK',
  results: [
    { formatted_address: 'Hyderabad, Telangana, India', geometry: { location: { lat: 17.4, lng: 78.4 } } },
  ],
};

describe('coordinate validation happens before any network call', () => {
  it.each([
    [91, 0],
    [-91, 0],
    [0, 181],
    [0, -181],
    [NaN, 0],
    [0, Infinity],
  ])('rejects (%s, %s) without calling out', async (lat, lng) => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(resolveCoordinates(lat as number, lng as number)).rejects.toThrow(LocationError);
    expect(spy, 'made a network call for invalid input').not.toHaveBeenCalled();
  });

  it('accepts the extremes', async () => {
    stubFetch(() => ok(GOOD));
    await expect(resolveCoordinates(90, 180)).resolves.toBeTruthy();
  });
});

describe('a missing secret reports a configuration problem, not a lookup failure', () => {
  it('throws maps_not_configured when neither env var is set', async () => {
    // Previously resolveSecret's generic Error escaped and the route answered
    // 500 "Location lookup failed", sending an operator hunting for a bug in
    // the geocoder when MAPS_KEY_SECRET had simply never been set.
    __resetSecretCache();
    delete process.env.MAPS_API_KEY;
    delete process.env.MAPS_KEY_SECRET;

    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);

    const err = await resolveCoordinates(17.4, 78.4).catch((e) => e);
    expect(err).toBeInstanceOf(LocationError);
    expect(err.code).toBe('maps_not_configured');
    // And it never attempted the call.
    expect(spy).not.toHaveBeenCalled();
  });

  it('the config error carries no secret name a client could use', () => {
    const err = new LocationError('maps_not_configured');
    expect(err.message).not.toMatch(/SECRET|projects\//);
  });
});

describe('INV-12 / INV-8 — the key never reaches an error', () => {
  it('a network failure does not carry the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      // A real fetch failure often embeds the request URL in its message.
      throw new Error(`connect ECONNREFUSED for https://maps.googleapis.com/...?key=${KEY}`);
    }));

    const err = await resolveCoordinates(17.4, 78.4).catch((e) => e);
    expect(err).toBeInstanceOf(LocationError);
    expect(JSON.stringify({ m: err.message, s: err.stack ?? '' })).not.toContain(KEY);
  });

  it('a non-OK response does not carry the key', async () => {
    stubFetch(() => ({ ok: false, status: 403, json: async () => ({}) }));
    const err = await resolveCoordinates(17.4, 78.4).catch((e) => e);
    expect(err.message).not.toContain(KEY);
    expect(err.code).toBe('geocoder_failed');
  });

  it('the key is sent as a query parameter, not a path', async () => {
    let seen = '';
    stubFetch((url) => {
      seen = url;
      return ok(GOOD);
    });
    await resolveCoordinates(17.4, 78.4);
    expect(seen).toContain(`key=${encodeURIComponent(KEY)}`);
  });
});

describe('the query is encoded, not concatenated', () => {
  it('a place name with & and # cannot smuggle parameters', async () => {
    let seen = '';
    stubFetch((url) => {
      seen = url;
      return ok(GOOD);
    });
    await resolveQuery('Cafe & Bar #2');
    // If this were string-built, `key` could be overridden by the input.
    expect(seen).not.toContain('Cafe & Bar');
    expect(seen).toContain('Cafe+%26+Bar+%232');
    expect(seen.match(/[?&]key=/g)).toHaveLength(1);
  });

  it('rejects an empty query without calling out', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(resolveQuery('   ')).rejects.toThrow(LocationError);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the response is treated as untrusted data', () => {
  it('caps an absurd place name', async () => {
    stubFetch(() =>
      ok({
        status: 'OK',
        results: [
          {
            formatted_address: 'A'.repeat(10_000),
            geometry: { location: { lat: 1, lng: 2 } },
          },
        ],
      }),
    );
    const r = await resolveCoordinates(1, 2);
    expect(r.placeName.length).toBeLessThanOrEqual(200);
  });

  it.each([
    ['ZERO_RESULTS', { status: 'ZERO_RESULTS', results: [] }, 'place_not_found'],
    ['OVER_QUERY_LIMIT', { status: 'OVER_QUERY_LIMIT' }, 'geocoder_failed'],
    ['missing results', { status: 'OK' }, 'place_not_found'],
    ['non-numeric coords', { status: 'OK', results: [{ formatted_address: 'x', geometry: { location: { lat: 'a', lng: 'b' } } }] }, 'place_not_found'],
    ['empty name', { status: 'OK', results: [{ formatted_address: '', geometry: { location: { lat: 1, lng: 2 } } }] }, 'place_not_found'],
  ])('fails closed on %s', async (_label, body, code) => {
    stubFetch(() => ok(body));
    const err = await resolveCoordinates(1, 2).catch((e) => e);
    expect(err).toBeInstanceOf(LocationError);
    expect(err.code).toBe(code);
  });

  it('returns only the three fields it promises', async () => {
    stubFetch(() =>
      ok({
        status: 'OK',
        results: [
          {
            formatted_address: 'Hyderabad',
            geometry: { location: { lat: 17.4, lng: 78.4 } },
            place_id: 'SHOULD_NOT_LEAK',
            address_components: [{ secret: 'nope' }],
          },
        ],
      }),
    );
    const r = await resolveCoordinates(17.4, 78.4);
    expect(Object.keys(r).sort()).toEqual(['lat', 'lng', 'placeName']);
    expect(JSON.stringify(r)).not.toContain('SHOULD_NOT_LEAK');
  });
});
