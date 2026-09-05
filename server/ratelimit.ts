import { adminDb } from './auth';

/**
 * Per-user rate limiting on model calls.
 *
 * Directive 1 (Tool Execution: privilege escalation / resource abuse). An
 * authenticated user who can call a model endpoint in a loop can spend the
 * project's entire Gemini quota, which is a denial-of-service against every
 * other user and against the demo.
 *
 * There are two layers, and the split is deliberate:
 *
 *   - `decide` is the pure counting rule, unit-tested in isolation.
 *   - `checkRateLimit` applies it in process memory. Fast, but per-instance:
 *     Cloud Run runs several instances and this holds across none of them.
 *   - `checkRateLimitShared` applies it in a Firestore transaction, so the
 *     count is one number across every instance and survives a cold start.
 *     This is the real control (D5/H2); the in-memory one is a same-instance
 *     fast path and a test seam.
 *
 * The earlier comment argued the Firestore round trip "costs more than it
 * protects". That was the wrong trade for the one resource — the paid Gemini
 * quota — that a runaway client can actually drain, as this project found out
 * the hard way. A read and a write per model call is cheap next to a model
 * call.
 */

const WINDOW_MS = 60 * 60 * 1000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * The counting rule, pure.
 *
 * Given the stored bucket (or none) and the limit, returns the decision and
 * the bucket to store next. Both the in-memory and the Firestore paths call
 * this, so there is exactly one definition of "over the limit".
 */
export function decide(
  bucket: Bucket | null,
  limit: number,
  now: number,
): { result: RateLimitResult; next: Bucket } {
  // A non-positive or unreadable limit denies rather than letting the first
  // call through (ambiguity denies).
  if (!Number.isFinite(limit) || limit <= 0) {
    return {
      result: { allowed: false, remaining: 0, retryAfterSeconds: 60 },
      next: { count: 0, resetAt: now + WINDOW_MS },
    };
  }

  if (!bucket || bucket.resetAt <= now) {
    const next = { count: 1, resetAt: now + WINDOW_MS };
    return { result: { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 }, next };
  }

  if (bucket.count >= limit) {
    return {
      result: {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      },
      next: bucket,
    };
  }

  const next = { count: bucket.count + 1, resetAt: bucket.resetAt };
  return {
    result: { allowed: true, remaining: limit - next.count, retryAfterSeconds: 0 },
    next,
  };
}

// ---- In-memory, per-instance. Same-instance fast path and unit-test seam. ----

const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(uid: string, limit: number): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const { result, next } = decide(buckets.get(uid) ?? null, limit, now);
  if (result.allowed || next.count === 0) buckets.set(uid, next);
  return result;
}

export function __resetRateLimits(): void {
  buckets.clear();
}

// ---- Firestore-backed, shared across instances. The real control. ----

/**
 * The one number, wherever the request lands.
 *
 * A transaction on `ratelimits/{key}` so two instances incrementing the same
 * user's count cannot both read "4 of 5" and both allow — the read and the
 * write are atomic. Contention under a runaway loop serialises the attacker's
 * own requests, which is the point rather than a cost.
 *
 * `ratelimits` is a top-level collection the client never touches: the rules'
 * default-deny covers it, and only the Admin SDK writes here.
 *
 * On a Firestore error it FAILS OPEN by falling back to the in-memory limiter,
 * because a rate limiter that hard-fails a model call on an infrastructure
 * blip is itself a denial of service. The fallback is per-instance, so the
 * degraded mode is "approximate" rather than "absent".
 */
export async function checkRateLimitShared(key: string, limit: number): Promise<RateLimitResult> {
  const now = Date.now();
  const ref = adminDb().collection('ratelimits').doc(key);

  try {
    return await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const stored = snap.exists ? (snap.data() as Bucket) : null;
      const { result, next } = decide(stored, limit, now);
      // Only persist when the bucket actually advanced: a denied call must not
      // extend the window, or a client hammering a spent quota would keep the
      // reset perpetually an hour away.
      if (result.allowed || !snap.exists) {
        tx.set(ref, next);
      }
      return result;
    });
  } catch (err: any) {
    console.warn('[ratelimit] shared check failed, falling back to in-memory:', err?.message);
    return checkRateLimit(key, limit);
  }
}
