import { adminDb, adminAuth } from './auth';
import { disconnect as disconnectGmail } from './gmail';
import { disconnect as disconnectGithub } from './githubAuth';

/**
 * Export and deletion — Amendment N, INV-22 and INV-23.
 *
 * This application holds people's email, their web reading, their repositories
 * and their private journal. Holding that with no way out is a position, and
 * not one this project would defend if it had been written down.
 */

/**
 * Everything under a user, except the things that must not travel.
 *
 * `private` holds the sealed Gmail and GitHub tokens. It is excluded from every
 * export INCLUDING the owner's own (INV-22): an export is a file, files get
 * stored, forwarded and synced, and the token inside one is still live at
 * Google or GitHub. The user is told the connection exists; they are not handed
 * the key to it.
 */
const EXPORTED_COLLECTIONS = [
  'entries',
  'sources',
  'artifacts',
  'segments',
  'capabilities',
  'toolcalls',
  'destinations',
  'redteam_runs',
  'audit',
  'perimeter_events',
] as const;

/** Collections deleted but never exported. */
const PRIVATE_COLLECTIONS = ['private'] as const;

export interface AccountExport {
  exportedAt: string;
  uid: string;
  profile: Record<string, unknown> | null;
  collections: Record<string, unknown[]>;
  notes: string[];
}

/**
 * Reads the caller's own subtree.
 *
 * Scoped by the uid the caller's verified token produced — never one from a
 * request body (INV-3). Nothing here takes a user parameter, so there is no
 * shape of this function that reads somebody else's data.
 */
export async function exportAccount(uid: string): Promise<AccountExport> {
  const root = adminDb().collection('users').doc(uid);

  const profileSnap = await root.get();
  const collections: Record<string, unknown[]> = {};

  for (const name of EXPORTED_COLLECTIONS) {
    const snap = await root.collection(name).get();
    collections[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  return {
    exportedAt: new Date().toISOString(),
    uid,
    profile: profileSnap.exists ? (profileSnap.data() as Record<string, unknown>) : null,
    collections,
    notes: [
      'Connected-account credentials are deliberately not included. Gmail and GitHub tokens are held encrypted on the server and are never exported, even to their owner, because an export is a file and the token inside it would still be live.',
      'perimeter_events is a hash-chained log. The chain is verifiable against the live collection; this JSON copy is a record, not proof. Verify in the app, not here.',
      'Artifact bodies are the external documents this account ingested. They are external text, not statements by this application.',
    ],
  };
}

export interface DeletionReport {
  uid: string;
  deletedAt: string;
  revoked: string[];
  collectionsDeleted: string[];
  authUserDeleted: boolean;
}

/**
 * Deletes an account, in the order that survives a partial failure — INV-23.
 *
 * 1. **Revoke third-party grants first.** A token we have forgotten is still a
 *    token that works. If revocation is left until after the local record is
 *    gone, there is nothing left to revoke it with.
 * 2. **Then the Firestore subtree.**
 * 3. **The Auth user last.** If any step fails, the user can still sign in and
 *    press delete again. Deleting the Auth record first would strand data that
 *    nobody can authenticate to reach, and therefore nobody can ever remove.
 *
 * `revokeRefreshTokens` runs before the user record goes so that any session
 * still holding an ID token cannot use it during the window.
 */
export async function deleteAccount(uid: string): Promise<DeletionReport> {
  const db = adminDb();
  const root = db.collection('users').doc(uid);
  const revoked: string[] = [];

  // 1. Third-party grants, at the provider.
  for (const [label, revoke] of [
    ['gmail', disconnectGmail],
    ['github', disconnectGithub],
  ] as const) {
    try {
      await revoke(uid);
      revoked.push(label);
    } catch (err: any) {
      // A provider that refuses must not strand the deletion — the user asked
      // to be forgotten and the local copy is the part we control. Recorded so
      // the report does not claim more than happened.
      console.warn(`[account] ${label} revoke failed during deletion: ${err?.message}`);
    }
  }

  // 2. Everything under the user, including the collections never exported.
  const collectionsDeleted: string[] = [];
  for (const name of [...EXPORTED_COLLECTIONS, ...PRIVATE_COLLECTIONS]) {
    await db.recursiveDelete(root.collection(name));
    collectionsDeleted.push(name);
  }
  await db.recursiveDelete(root);

  // 3. Sessions, then the identity itself.
  let authUserDeleted = false;
  try {
    await adminAuth().revokeRefreshTokens(uid);
    await adminAuth().deleteUser(uid);
    authUserDeleted = true;
  } catch (err: any) {
    // The data is already gone, which is the part that mattered. Reported
    // rather than swallowed: an account that can still sign in to an empty
    // workspace is a confusing state and the user should be told.
    console.error(`[account] auth user deletion failed: ${err?.message}`);
  }

  return {
    uid,
    deletedAt: new Date().toISOString(),
    revoked,
    collectionsDeleted,
    authUserDeleted,
  };
}
