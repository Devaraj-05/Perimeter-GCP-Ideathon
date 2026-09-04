import { getMapsKey } from './secrets';

/**
 * Location resolution — Amendment D.
 *
 * Turns coordinates (or a typed place name) into a human place name via the
 * Google Geocoding API.
 *
 * Why this runs on the server rather than in the browser, per INV-12: the Maps
 * key would otherwise have to ship in the bundle, where anyone can read it and
 * spend the quota. Keeping it here costs one round trip and removes a class of
 * abuse entirely. It is the same reasoning that keeps the Gemini key server-side.
 *
 * This is NOT an egress path in the §9.3 sense. The host is a constant; no user
 * input can redirect it. Nothing here takes a URL. If that ever changes, §9.3
 * applies in full and this comment is wrong.
 *
 * The response is text from outside this system, so it is DERIVED, not USER:
 * callers render it through the INV-9 renderer like any other string this
 * application did not author.
 */

const GEOCODE_ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

/** Google caps at 8s here; we cap tighter so a slow call cannot hold a request. */
const TIMEOUT_MS = 6_000;

/** A place name far past this is not a place name. */
const MAX_PLACE_NAME = 200;

export interface ResolvedLocation {
  placeName: string;
  lat: number;
  lng: number;
}

export class LocationError extends Error {
  constructor(public readonly code: string) {
    // INV-10: the code is what reaches the client. No provider text, no URL,
    // no key, no internal path.
    super(code);
    this.name = 'LocationError';
  }
}

/** Rejects anything that is not a real point on Earth. */
function assertCoords(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new LocationError('invalid_coordinates');
  if (lat < -90 || lat > 90) throw new LocationError('invalid_coordinates');
  if (lng < -180 || lng > 180) throw new LocationError('invalid_coordinates');
}

async function callGeocoder(params: Record<string, string>): Promise<any> {
  // A missing secret is a DEPLOYMENT problem, not a lookup failure. Letting
  // resolveSecret's generic Error escape produced a 500 and the message
  // "Location lookup failed. Please retry." — which sends an operator hunting
  // for a bug in the geocoder when the real answer is that MAPS_KEY_SECRET was
  // never set. Typed here so the route can say so (and match how Gmail reports
  // the same situation).
  let key: string;
  try {
    key = await getMapsKey();
  } catch {
    throw new LocationError('maps_not_configured');
  }

  // URLSearchParams, not string concatenation: a place name containing & or #
  // would otherwise smuggle parameters into the request.
  const qs = new URLSearchParams({ ...params, key });
  const url = `${GEOCODE_ENDPOINT}?${qs.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'error',
    });
  } catch {
    // Deliberately swallows the cause: the URL carries the key, so an error
    // built from it must never propagate (INV-8).
    throw new LocationError('geocoder_unreachable');
  }

  if (!res.ok) throw new LocationError('geocoder_failed');

  try {
    return await res.json();
  } catch {
    throw new LocationError('geocoder_failed');
  }
}

function firstResult(body: any): ResolvedLocation {
  const status = String(body?.status ?? '');
  if (status === 'ZERO_RESULTS') throw new LocationError('place_not_found');
  if (status !== 'OK') throw new LocationError('geocoder_failed');

  const top = Array.isArray(body?.results) ? body.results[0] : null;
  const loc = top?.geometry?.location;
  const name = typeof top?.formatted_address === 'string' ? top.formatted_address : '';

  if (!name || typeof loc?.lat !== 'number' || typeof loc?.lng !== 'number') {
    throw new LocationError('place_not_found');
  }

  return {
    placeName: name.slice(0, MAX_PLACE_NAME),
    lat: loc.lat,
    lng: loc.lng,
  };
}

/** Coordinates from the browser → a place name. */
export async function resolveCoordinates(lat: number, lng: number): Promise<ResolvedLocation> {
  assertCoords(lat, lng);
  return firstResult(await callGeocoder({ latlng: `${lat},${lng}` }));
}

/** A place name the user typed → a canonical name and coordinates. */
export async function resolveQuery(query: string): Promise<ResolvedLocation> {
  const q = String(query ?? '').trim().slice(0, MAX_PLACE_NAME);
  if (!q) throw new LocationError('invalid_query');
  return firstResult(await callGeocoder({ address: q }));
}
