import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Export and deletion, against a real Firestore — K6, Amendment N.
 *
 * account.test.ts asserts the SHAPE of this code by reading its source. This
 * asserts the BEHAVIOUR by running it: seed a user's whole subtree in the
 * emulator, export it, delete it, and check what came back and what is gone.
 *
 * The two source-grep claims a live run can actually falsify:
 *   - the export omits the private (credential) collection — INV-22;
 *   - deletion removes the WHOLE subtree, private included, recursively —
 *     recursiveDelete's job, but our call site is what this proves.
 *
 * Runs under `npm run test:rules`, which starts the Firestore emulator; the
 * admin SDK routes to it on FIRESTORE_EMULATOR_HOST. The Auth emulator is not
 * started, so deleteAccount's Auth step fails and is reported as
 * authUserDeleted:false — which is itself the INV-23 "recoverable, not
 * orphaned" behaviour, asserted below rather than mocked away.
 */

const UID = 'emulator-user-1';

// Set before the modules under test resolve their project id.
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'perimeter-rules-test';

let exportAccount: typeof import('../server/account')['exportAccount'];
let deleteAccount: typeof import('../server/account')['deleteAccount'];
let adminDb: typeof import('../server/auth')['adminDb'];

beforeAll(async () => {
  ({ exportAccount, deleteAccount } = await import('../server/account'));
  ({ adminDb } = await import('../server/auth'));
});

async function seed() {
  const root = adminDb().collection('users').doc(UID);
  await root.set({ uid: UID, email: 'e@example.com' });
  await root.collection('entries').doc('e1').set({ id: 'e1', title: 'A reflection' });
  await root.collection('artifacts').doc('a1').set({ id: 'a1', body: 'an ingested page' });
  await root.collection('perimeter_events').doc('p1').set({ seq: 1, reason: 'ingest' });
  // The credential collection. Present so we can prove both that it is NOT
  // exported and that it IS deleted.
  await root.collection('private').doc('gmail').set({ sealedToken: 'do-not-export-me' });
}

async function countSubtree(): Promise<number> {
  const root = adminDb().collection('users').doc(UID);
  let n = (await root.get()).exists ? 1 : 0;
  for (const c of ['entries', 'artifacts', 'perimeter_events', 'private']) {
    n += (await root.collection(c).get()).size;
  }
  return n;
}

describe('exportAccount returns the data and withholds the credential', () => {
  beforeAll(seed);

  it('includes the user’s own content', async () => {
    const out = await exportAccount(UID);
    expect(out.collections.entries).toHaveLength(1);
    expect(out.collections.artifacts).toHaveLength(1);
    expect(out.collections.perimeter_events).toHaveLength(1);
  });

  it('does NOT include the private credential collection — INV-22', () => {
    return exportAccount(UID).then((out) => {
      expect(out.collections).not.toHaveProperty('private');
      // And the token string appears nowhere in the whole export.
      expect(JSON.stringify(out)).not.toContain('do-not-export-me');
    });
  });

  it('carries the notes that say what the export is not', async () => {
    const out = await exportAccount(UID);
    expect(out.notes.join(' ')).toMatch(/credentials are deliberately not included/i);
  });
});

describe('deleteAccount removes the whole subtree — INV-23', () => {
  it('leaves nothing behind, private included', async () => {
    await seed();
    expect(await countSubtree()).toBeGreaterThan(0);

    const report = await deleteAccount(UID);

    // The Firestore side is the part that runs without the Auth emulator.
    expect(report.collectionsDeleted).toContain('private');
    expect(await countSubtree()).toBe(0);
  });

  it('reports the Auth record as not deleted rather than claiming success', async () => {
    // No Auth emulator here, so deleteUser fails. INV-23's promise is that
    // this leaves the account recoverable, not orphaned — and that the report
    // says so instead of pretending the account is gone.
    await seed();
    const report = await deleteAccount(UID);
    expect(report.authUserDeleted).toBe(false);
    // The data still went — the part we control.
    expect(await countSubtree()).toBe(0);
  });
});
