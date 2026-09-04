import { adminDb } from './auth';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Aggregate security telemetry — Amendment E.
 *
 * A single document of counters. What it deliberately does NOT contain is the
 * point: no uid, no journal text, no payload body, no place name, nothing that
 * could identify a person or reveal what they wrote. An admin reading every
 * field learns how the perimeter is performing and nothing about anyone.
 *
 * That constraint is what lets this exist without weakening INV-3. A security
 * dashboard that reads private journals would contradict the product it is
 * reporting on.
 *
 * Writes are server-only (rules deny the client entirely) and use
 * FieldValue.increment, so concurrent runs cannot lose a count the way a
 * read-modify-write would.
 */

export interface GlobalMetrics {
  totalRuns: number;
  blocked: number;
  leaked: number;
  /** Attempts per attack class, e.g. { direct_override: 4 }. */
  byClass: Record<string, number>;
  updatedAt: string;
}

function metricsRef() {
  return adminDb().collection('metrics').doc('global');
}

/**
 * Records one red-team attempt.
 *
 * Never throws into the caller: telemetry failing must not fail an attack run,
 * which is the thing the user actually asked for. It logs and moves on.
 */
export async function recordRedteamRun(
  outcome: 'blocked' | 'leaked' | 'error',
  attackClass: string,
): Promise<void> {
  try {
    const safeClass = String(attackClass).replace(/[^a-z_]/gi, '').slice(0, 40) || 'unknown';

    await metricsRef().set(
      {
        totalRuns: FieldValue.increment(1),
        blocked: FieldValue.increment(outcome === 'blocked' ? 1 : 0),
        leaked: FieldValue.increment(outcome === 'leaked' ? 1 : 0),
        byClass: { [safeClass]: FieldValue.increment(1) },
        updatedAt: new Date().toISOString(),
      },
      { merge: true },
    );
  } catch (err: any) {
    console.warn('[metrics] increment failed:', err?.message);
  }
}

/** Reads the counters. Callers must be behind requireAdmin. */
export async function readMetrics(): Promise<GlobalMetrics> {
  const snap = await metricsRef().get();
  const d = (snap.data() ?? {}) as Partial<GlobalMetrics>;
  return {
    totalRuns: d.totalRuns ?? 0,
    blocked: d.blocked ?? 0,
    leaked: d.leaked ?? 0,
    byClass: d.byClass ?? {},
    updatedAt: d.updatedAt ?? '',
  };
}
