import { adminDb } from './auth';

/**
 * Retention — Amendment O, INV-24.
 *
 * Ingested external content ages out. The user's own journal does not: an
 * entry is something they wrote and may want in ten years, and deleting it on
 * a timer would be a betrayal. An artifact is a copy of an email, a page, a
 * scanned repository — kept only so a recent conversation could ground on it,
 * and the larger share of what this system holds about a person's untrusted
 * world.
 */

/**
 * How long an artifact lives, in days, from the deployment setting.
 *
 * Unset (or non-positive) means keep forever, and the privacy statement says
 * exactly that. This is the only place the policy is read, so the statement and
 * the behaviour cannot drift.
 */
export function retentionDays(): number | null {
  const raw = Number(process.env.ARTIFACT_RETENTION_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * The `expiresAt` to stamp on a new artifact, or null to keep it.
 *
 * Computed at ingest so the value is fixed at the document's own age, not
 * recomputed against a window that might change under it.
 */
export function artifactExpiry(now: number = Date.now()): string | null {
  const days = retentionDays();
  return days === null ? null : new Date(now + days * 86_400_000).toISOString();
}

export interface SweepReport {
  usersScanned: number;
  artifactsDeleted: number;
  segmentsDeleted: number;
}

/**
 * Deletes expired artifacts and their segments, for every user — INV-24.
 *
 * Scoped to `artifacts` and `segments`. There is deliberately no branch that
 * can reach `entries`: a user's own writing is removed only by that user. A
 * segment is deleted only when it belongs to an artifact being deleted, so an
 * entry's segments are never in scope.
 *
 * A no-op when retention is unconfigured — nothing has an `expiresAt`, so the
 * query matches nothing, and the job is safe to schedule before a policy is
 * chosen.
 */
export async function sweepExpired(now: number = Date.now()): Promise<SweepReport> {
  const db = adminDb();
  const cutoff = new Date(now).toISOString();
  const report: SweepReport = { usersScanned: 0, artifactsDeleted: 0, segmentsDeleted: 0 };

  if (retentionDays() === null) return report; // nothing expires; do not scan

  // listDocuments(), not get(): a user whose profile doc was never written
  // still has a subtree, and get() on the parent collection skips missing
  // ancestor docs — so their artifacts would never be swept. The ingest job
  // uses listDocuments() for the same reason.
  const users = await db.collection('users').listDocuments();
  for (const root of users) {
    report.usersScanned++;

    // expiresAt <= now, and only documents that HAVE an expiresAt — a null or
    // absent field never matches a range filter, so keep-forever artifacts
    // written before a policy existed are safe.
    const expired = await root
      .collection('artifacts')
      .where('expiresAt', '<=', cutoff)
      .get();

    for (const doc of expired.docs) {
      const segmentId = (doc.data() as { segmentId?: string }).segmentId;
      if (segmentId) {
        await root
          .collection('segments')
          .doc(segmentId)
          .delete()
          .then(() => {
            report.segmentsDeleted++;
          })
          .catch(() => undefined);
      }
      await doc.ref.delete();
      report.artifactsDeleted++;
    }
  }

  return report;
}
