import { Router, Request, Response } from 'express';
import { getAuth } from 'firebase-admin/auth';
import { adminDb } from './auth';
import { runSourceIngest } from './ingest';
import { writeAudit } from './audit';

/**
 * Scheduled ingestion - Amendment A.5.
 *
 * This endpoint is never publicly invocable. Cloud Scheduler calls it with an
 * OIDC identity token; the token is verified against Google's certificates and
 * the caller's service account must match the one configured. Cloud Run's own
 * IAM check runs first, but this is a second, independent gate: a route that
 * iterates every user's sources should not depend on a single misconfiguration
 * away from being open.
 */

export const internalRouter = Router();

const GOOGLE_TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

/** Service account permitted to invoke scheduled ingest. */
function expectedInvoker(): string | null {
  return process.env.SCHEDULER_SERVICE_ACCOUNT || null;
}

/**
 * The audience the Scheduler job mints its token for
 * (`--oidc-token-audience`, set to the service URL in docs/scheduler-setup.md).
 *
 * Checking this closes token-audience confusion. Verifying only the signature
 * and the caller's email accepts ANY Google-issued token belonging to that
 * service account — including one minted for a completely different service.
 * Such a token is a valid credential presented to the wrong door, and without
 * an `aud` check this door opens.
 */
function expectedAudience(): string | null {
  return process.env.SCHEDULER_AUDIENCE || null;
}

/** Google's OIDC issuer, in both forms Google emits. */
const GOOGLE_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

interface OidcClaims {
  email?: string;
  email_verified?: string | boolean;
  aud?: string;
  iss?: string;
  exp?: string | number;
}

/**
 * Verifies a Google-issued OIDC token. Uses Google's tokeninfo endpoint rather
 * than local key handling: this runs once per scheduled invocation, so the
 * round trip is irrelevant and there is no key cache to get wrong.
 */
async function verifyOidc(token: string): Promise<OidcClaims | null> {
  try {
    const res = await fetch(`${GOOGLE_TOKENINFO}?id_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const claims = (await res.json()) as OidcClaims;

    const exp = Number(claims.exp);
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;

    return claims;
  } catch {
    return null;
  }
}

/**
 * B.6 failure posture: any ambiguity denies. An unset SCHEDULER_SERVICE_ACCOUNT
 * closes the endpoint rather than opening it, so a missing configuration value
 * cannot become an unauthenticated ingest trigger.
 */
async function requireScheduler(req: Request, res: Response, next: () => void) {
  const expected = expectedInvoker();
  if (!expected) {
    console.error('[internal] SCHEDULER_SERVICE_ACCOUNT unset - refusing.');
    return res.status(503).json({ error: 'Scheduled ingest is not configured.' });
  }

  // B.6 again: a half-configured endpoint is a closed one. If the invoker is
  // named but the audience is not, we cannot tell a token minted for THIS
  // service from one minted for another, so we refuse rather than guess.
  const audience = expectedAudience();
  if (!audience) {
    console.error('[internal] SCHEDULER_AUDIENCE unset - refusing.');
    return res.status(503).json({ error: 'Scheduled ingest is not configured.' });
  }

  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const claims = await verifyOidc(header.slice(7).trim());
  if (!claims) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  if (!claims.iss || !GOOGLE_ISSUERS.has(claims.iss)) {
    console.warn(`[internal] rejected issuer: ${claims.iss ?? 'unknown'}`);
    return res.status(403).json({ error: 'Forbidden.' });
  }

  if (claims.aud !== audience) {
    // A valid token for the wrong door.
    console.warn(`[internal] rejected audience: ${claims.aud ?? 'unknown'}`);
    return res.status(403).json({ error: 'Forbidden.' });
  }

  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!verified || claims.email !== expected) {
    console.warn(`[internal] rejected invoker: ${claims.email ?? 'unknown'}`);
    return res.status(403).json({ error: 'Forbidden.' });
  }

  next();
}

/**
 * Iterates every enabled source across all users. Per-source failures are
 * recorded on the source document and do not abort the run - one unreachable
 * repository must not stop everyone else's ingest.
 */
internalRouter.post('/ingest', requireScheduler, async (_req: Request, res: Response) => {
  const started = Date.now();
  let users = 0;
  let sources = 0;
  let failures = 0;

  try {
    // adminDb() initialises the Admin app lazily on first use.
    const userDocs = await adminDb().collection('users').listDocuments();

    for (const userRef of userDocs) {
      users++;
      const enabled = await userRef.collection('sources').where('enabled', '==', true).get();

      for (const sourceDoc of enabled.docs) {
        sources++;
        try {
          await runSourceIngest(userRef.id, sourceDoc.id);
        } catch (err: any) {
          failures++;
          // runSourceIngest already recorded lastRunError on the source; the
          // UI renders it, so this failure is visible rather than silent.
          console.warn(`[internal] ingest failed for ${userRef.id}/${sourceDoc.id}: ${err?.message}`);
        }
      }

      await writeAudit(userRef.id, {
        type: 'ingest_run',
        decision: 'ALLOW',
        reason: 'scheduled',
        detail: `${enabled.size} source(s)`,
      });
    }

    res.json({
      ok: true,
      users,
      sources,
      failures,
      durationMs: Date.now() - started,
    });
  } catch (err: any) {
    console.error('[internal] scheduled ingest failed:', err?.message);
    res.status(500).json({ ok: false, error: 'Scheduled ingest failed.', users, sources, failures });
  }
});
