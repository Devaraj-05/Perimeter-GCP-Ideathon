import { adminDb } from './auth';

/**
 * Capability grants — INV-4.
 *
 * Tools do not execute because the model asked. They execute because a grant
 * exists: a document scoped to (uid, tool, resource) with an expiry, minted
 * only by an explicit user action in the UI.
 *
 * This is the OAuth consent screen pattern applied to an agent's own tools.
 * The user can see exactly what the assistant is currently permitted to do,
 * and revoke any of it. Deny by default: a proposal with no matching grant is
 * refused and logged.
 *
 * Nothing here can be reached by the model. There is no mint tool, no grant
 * endpoint the Planner can propose, and firestore.rules denies client writes
 * to this collection — so the only path to a new capability is a person
 * clicking a button.
 */

export interface Capability {
  id: string;
  tool: string;
  /** What the grant is scoped to: 'entries:own', a destination id, etc. */
  resource: string;
  grantedAt: string;
  expiresAt: string;
  /** Consumed on first use. Used for "allow this one action" confirmations. */
  oneShot: boolean;
  usedAt: string | null;
  revokedAt: string | null;
}

export const DEFAULT_GRANT_HOURS = 24;
const MAX_GRANT_HOURS = 24 * 7;

function capsRef(uid: string) {
  return adminDb().collection('users').doc(uid).collection('capabilities');
}

function clean<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/**
 * A grant is live when it exists, is unrevoked, unexpired, and — if one-shot —
 * unused. Pure, so the predicate can be tested without a database.
 */
export function isLive(cap: Capability | null | undefined, now = Date.now()): boolean {
  if (!cap) return false;
  if (cap.revokedAt) return false;
  if (cap.oneShot && cap.usedAt) return false;

  const expiry = Date.parse(cap.expiresAt);
  // An unparseable expiry is treated as expired. Fail closed: a grant whose
  // lifetime cannot be read is not a grant we can reason about.
  if (!Number.isFinite(expiry)) return false;

  return expiry > now;
}

/**
 * Mints a grant. Called only from an authenticated route responding to a user
 * action — never from the agent runtime, and never in response to model output.
 */
export async function mintCapability(
  uid: string,
  input: { tool: string; resource: string; hours?: number; oneShot?: boolean },
): Promise<Capability> {
  const hours = Math.min(Math.max(1, Number(input.hours) || DEFAULT_GRANT_HOURS), MAX_GRANT_HOURS);
  const doc = capsRef(uid).doc();
  const now = new Date();

  const cap: Capability = {
    id: doc.id,
    tool: String(input.tool),
    resource: String(input.resource),
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + hours * 3600_000).toISOString(),
    oneShot: input.oneShot === true,
    usedAt: null,
    revokedAt: null,
  };

  await doc.set(clean(cap));
  return cap;
}

/**
 * Finds a live grant for (uid, tool, resource).
 *
 * Filtering happens in memory rather than in the query because liveness spans
 * three fields and a composite index for it would be one more thing to get
 * wrong at deploy time for a collection this small.
 */
export async function findLiveCapability(
  uid: string,
  tool: string,
  resource: string,
): Promise<Capability | null> {
  const snap = await capsRef(uid).where('tool', '==', tool).limit(50).get();

  const now = Date.now();
  const match = snap.docs
    .map((d) => d.data() as Capability)
    .find((c) => c.resource === resource && isLive(c, now));

  return match ?? null;
}

/** Marks a one-shot grant used. Called after a successful execution. */
export async function consumeCapability(uid: string, capId: string): Promise<void> {
  await capsRef(uid).doc(capId).update({ usedAt: new Date().toISOString() });
}

/**
 * Atomically claims a one-shot grant BEFORE the tool runs. Returns false if
 * another caller already claimed it.
 *
 * findLiveCapability -> decideProposal -> executeTool -> consumeCapability is
 * a read, a decision and a write with network I/O in between and no atomicity
 * anywhere in it. Two concurrent turns both read the same live one-shot grant,
 * both satisfy the broker, and both execute — so "one shot" meant at-LEAST-once
 * rather than at-most-once, and `explainReason('capability_already_used')`
 * promised the user a guarantee the code did not make.
 *
 * The claim moves ahead of execution deliberately. A crash or a failed run now
 * burns the grant, which is the cost of the trade: for an egress tool, sending
 * twice is a worse outcome than making the user grant permission again.
 * Constitution §8 — fail closed — settles which way this goes.
 */
export async function claimOneShot(uid: string, capId: string): Promise<boolean> {
  const ref = capsRef(uid).doc(capId);
  try {
    return await adminDb().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const cap = snap.data() as Capability;
      // Re-checked inside the transaction: liveness read outside it is stale
      // by definition, and staleness is the whole bug.
      if (!cap.oneShot) return true;
      if (cap.usedAt || cap.revokedAt) return false;
      tx.update(ref, { usedAt: new Date().toISOString() });
      return true;
    });
  } catch {
    // Fail closed: an unreadable claim is not a claim.
    return false;
  }
}

export async function revokeCapability(uid: string, capId: string): Promise<boolean> {
  const doc = capsRef(uid).doc(capId);
  if (!(await doc.get()).exists) return false;
  await doc.update({ revokedAt: new Date().toISOString() });
  return true;
}

export async function listCapabilities(uid: string): Promise<Capability[]> {
  const snap = await capsRef(uid).orderBy('grantedAt', 'desc').limit(100).get();
  return snap.docs.map((d) => d.data() as Capability);
}
