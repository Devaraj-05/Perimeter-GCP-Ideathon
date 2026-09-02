/**
 * Per-user rate limiting on model calls.
 *
 * Directive 1 (Tool Execution: privilege escalation / resource abuse). An
 * authenticated user who can call a model endpoint in a loop can spend the
 * project's entire Gemini quota, which is a denial-of-service against every
 * other user and against the demo.
 *
 * Deliberately in-memory. Cloud Run may run several instances, so this is a
 * per-instance limit and therefore approximate. That is stated rather than
 * hidden: with min-instances low it is close enough to stop a runaway client,
 * and the alternative - a Firestore read and write on every model call - costs
 * more than it protects.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60 * 60 * 1000;
const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound on a long-lived instance. */
function sweep(now: number): void {
  if (buckets.size < 5_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function checkRateLimit(uid: string, limit: number): RateLimitResult {
  // A non-positive or unreadable limit denies rather than creating a bucket
  // and letting the first call through (B.6: ambiguity denies).
  if (!Number.isFinite(limit) || limit <= 0) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 60 };
  }

  const now = Date.now();
  sweep(now);

  const key = uid;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count++;
  return { allowed: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/** Test seam - not used in production paths. */
export function __resetRateLimits(): void {
  buckets.clear();
}
