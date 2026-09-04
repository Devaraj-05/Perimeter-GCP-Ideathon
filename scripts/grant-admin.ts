/**
 * Grants or revokes the admin custom claim — Amendment E, INV-13.
 *
 * This is a LOCAL SCRIPT, run by an operator holding Admin credentials, and it
 * is deliberately not an HTTP route. An endpoint that mints administrators is
 * precisely the thing INV-13 exists to prevent; putting one behind
 * `requireAdmin` would still leave the bootstrap problem, and putting one
 * behind nothing would be a self-service privilege escalation.
 *
 *   npx tsx scripts/grant-admin.ts <uid>
 *   npx tsx scripts/grant-admin.ts <uid> --revoke
 *
 * The target must sign out and back in afterwards: a custom claim only appears
 * in a token minted after it was set, so an existing session keeps the old
 * claims until it refreshes.
 */

import { initializeApp, applicationDefault, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import appletConfig from '../firebase-applet-config.json';

async function main(): Promise<void> {
  const [uid, ...flags] = process.argv.slice(2);
  const revoke = flags.includes('--revoke');

  if (!uid) {
    console.error('Usage: npx tsx scripts/grant-admin.ts <uid> [--revoke]');
    process.exit(1);
  }

  if (!getApps().length) {
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || appletConfig.projectId,
    });
  }

  const auth = getAuth();

  // Fail loudly on an unknown uid rather than silently setting a claim on
  // nothing — a typo here is otherwise invisible until someone wonders why the
  // panel never appeared.
  const user = await auth.getUser(uid).catch(() => null);
  if (!user) {
    console.error(`No such user: ${uid}`);
    process.exit(1);
  }

  // Preserve any other claims rather than clobbering the object.
  const existing = user.customClaims ?? {};
  const next = { ...existing };
  if (revoke) delete (next as any).role;
  else (next as any).role = 'admin';

  await auth.setCustomUserClaims(uid, next);

  console.log(`${revoke ? 'Revoked' : 'Granted'} admin for ${user.email ?? uid}`);
  console.log('They must sign out and back in before the claim reaches their token.');
}

main().catch((err) => {
  console.error('Failed:', err?.message ?? err);
  process.exit(1);
});
