import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Retention sweep, against a real Firestore — Amendment O, INV-24.
 *
 * The claim that cannot be proven by reading source: that the sweep removes an
 * expired artifact and its segment, and leaves an entry and a not-yet-expired
 * artifact untouched. Runs under `npm run test:rules` with the Firestore
 * emulator; the admin SDK routes to it on FIRESTORE_EMULATOR_HOST.
 */

process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'perimeter-rules-test';
process.env.ARTIFACT_RETENTION_DAYS = '30';

const UID = 'retention-user-1';
let sweepExpired: typeof import('../server/retention')['sweepExpired'];
let adminDb: typeof import('../server/auth')['adminDb'];

beforeAll(async () => {
  ({ sweepExpired } = await import('../server/retention'));
  ({ adminDb } = await import('../server/auth'));

  const root = adminDb().collection('users').doc(UID);
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();

  // An expired artifact and the segment it points at.
  await root.collection('artifacts').doc('old').set({
    id: 'old',
    segmentId: 'seg-old',
    expiresAt: past,
  });
  await root.collection('segments').doc('seg-old').set({ id: 'seg-old', text: 'stale' });

  // A fresh artifact, and one with no expiresAt at all (written before any
  // policy existed) — neither should be touched.
  await root.collection('artifacts').doc('fresh').set({ id: 'fresh', expiresAt: future });
  await root.collection('artifacts').doc('forever').set({ id: 'forever' });

  // The user's own writing — must never be deleted by a timer.
  await root.collection('entries').doc('e1').set({ id: 'e1', title: 'my journal' });
});

describe('the sweep removes expired artifacts and nothing else', () => {
  it('deletes the expired artifact and its segment', async () => {
    const report = await sweepExpired();
    expect(report.artifactsDeleted).toBeGreaterThanOrEqual(1);

    const root = adminDb().collection('users').doc(UID);
    expect((await root.collection('artifacts').doc('old').get()).exists).toBe(false);
    expect((await root.collection('segments').doc('seg-old').get()).exists).toBe(false);
  });

  it('leaves a not-yet-expired artifact alone', async () => {
    const root = adminDb().collection('users').doc(UID);
    expect((await root.collection('artifacts').doc('fresh').get()).exists).toBe(true);
  });

  it('leaves an artifact with no expiry alone — keep-forever survives', async () => {
    const root = adminDb().collection('users').doc(UID);
    expect((await root.collection('artifacts').doc('forever').get()).exists).toBe(true);
  });

  it('never touches an entry — INV-24', async () => {
    // The load-bearing assertion. A user's own writing is removed only by that
    // user, never by a timer.
    const root = adminDb().collection('users').doc(UID);
    expect((await root.collection('entries').doc('e1').get()).exists).toBe(true);
  });
});
