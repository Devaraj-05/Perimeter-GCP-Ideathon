import { Router, Response } from 'express';
import { requireAuth, AuthedRequest } from './auth';
import { checkRateLimit } from './ratelimit';
import { resolveCoordinates, resolveQuery, LocationError } from './location';

/**
 * Location routes — Amendment D.
 *
 * One endpoint, authenticated, rate-limited on its own bucket so geocoding
 * cannot drain the budget the chat depends on (the same reasoning as the
 * `redteam-custom:` bucket). Every failure returns a typed code, never the
 * provider's message, because the request URL carries the Maps key (INV-8,
 * INV-10).
 */

export const locationRouter = Router();

/** Generous for a human tagging entries, tight enough to bound quota abuse. */
const GEOCODE_PER_HOUR = 30;

locationRouter.post('/resolve', requireAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try {
    const limit = checkRateLimit(
      `geocode:${uid}`,
      Number(process.env.GEOCODE_RATE_LIMIT_PER_HOUR) || GEOCODE_PER_HOUR,
    );
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: `Too many location lookups. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
      });
    }

    // Guard before destructuring: a missing body is empty input, not a crash.
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const hasCoords = typeof data.lat === 'number' && typeof data.lng === 'number';
    const query = typeof data.query === 'string' ? data.query.trim() : '';

    if (!hasCoords && !query) {
      return res.status(400).json({ error: 'Give coordinates or a place name.' });
    }

    const location = hasCoords
      ? await resolveCoordinates(data.lat, data.lng)
      : await resolveQuery(query);

    return res.json({ location });
  } catch (err: any) {
    if (err instanceof LocationError) {
      // Typed, safe to show. 400 for input problems, 502 for the provider.
      const userFacing: Record<string, [number, string]> = {
        maps_not_configured: [503, 'Location lookup is not configured on this deployment.'],
        invalid_coordinates: [400, 'Those coordinates are not valid.'],
        invalid_query: [400, 'Enter a place name.'],
        place_not_found: [404, 'No place matched that.'],
        geocoder_unreachable: [502, 'Location lookup is unavailable right now.'],
        geocoder_failed: [502, 'Location lookup failed. Please retry.'],
      };
      const [status, message] = userFacing[err.code] ?? [502, 'Location lookup failed.'];
      return res.status(status).json({ error: message, code: err.code });
    }

    console.error('[location] resolve failed:', err?.message);
    return res.status(500).json({ error: 'Location lookup failed. Please retry.' });
  }
});
