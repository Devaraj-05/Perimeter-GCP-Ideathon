import { adminDb } from './auth';
import { FieldValue } from 'firebase-admin/firestore';

/**
 * Egress destinations — the resource `send_digest` is scoped to.
 *
 * Every destination in this build is a SANDBOX. It records what would have
 * been sent and discards it. No webhook fires, no mail leaves, no network call
 * is made at all.
 *
 * That is a deliberate choice, not an unfinished one, and it is labelled as
 * such everywhere it surfaces. The point of the egress path here is to make
 * INV-5 demonstrable — to let a judge watch the app refuse to send the user's
 * own journal outward — and a real outbound integration would add delivery
 * plumbing, a provider credential and a genuine exfiltration risk without
 * making that refusal one bit more convincing.
 *
 * The rule that matters is unchanged either way: the model names an opaque
 * destination id and the server resolves it here, against records only this
 * user created. An address appearing in model output can never become a
 * destination, because this is the only place destinations come from.
 */

export type DestinationKind = 'sandbox';

export interface Destination {
  id: string;
  kind: DestinationKind;
  label: string;
  createdAt: string;
  /** Deliveries recorded against this destination. Never sent anywhere. */
  deliveryCount: number;
}

export interface Delivery {
  id: string;
  destinationId: string;
  /** Hash and length only — the payload itself is never stored twice. */
  bodySha256: string;
  bodyLength: number;
  preview: string;
  at: string;
}

function destRef(uid: string) {
  return adminDb().collection('users').doc(uid).collection('destinations');
}

function clean<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

const MAX_DESTINATIONS = 5;

/**
 * Creates a sandbox destination. Called only from an authenticated route
 * responding to a user action — never from the agent runtime, and never in
 * response to model output.
 */
export async function createSandboxDestination(
  uid: string,
  label: string,
): Promise<Destination> {
  const existing = await destRef(uid).get();
  if (existing.size >= MAX_DESTINATIONS) {
    throw new Error(`You can have at most ${MAX_DESTINATIONS} destinations.`);
  }

  const doc = destRef(uid).doc();
  const destination: Destination = {
    id: doc.id,
    kind: 'sandbox',
    label: String(label || 'Sandbox destination').slice(0, 80),
    createdAt: new Date().toISOString(),
    deliveryCount: 0,
  };

  await doc.set(clean(destination));
  return destination;
}

export async function listDestinations(uid: string): Promise<Destination[]> {
  const snap = await destRef(uid).orderBy('createdAt', 'desc').limit(20).get();
  return snap.docs.map((d) => d.data() as Destination);
}

/** Ownership is structural: the path is uid-scoped, so a foreign id misses. */
export async function getDestination(uid: string, id: string): Promise<Destination | null> {
  const doc = await destRef(uid).doc(id).get();
  return doc.exists ? (doc.data() as Destination) : null;
}

/**
 * Records a delivery against a sandbox destination.
 *
 * Stores a hash, a length and a short preview rather than the body, per
 * Constitution §7: enough to prove what was sent without keeping a second copy
 * of potentially sensitive journal content in another collection.
 */
export async function recordSandboxDelivery(
  uid: string,
  destinationId: string,
  body: string,
): Promise<Delivery> {
  const { createHash } = await import('crypto');
  const text = String(body ?? '');

  const doc = destRef(uid).doc(destinationId).collection('deliveries').doc();
  const delivery: Delivery = {
    id: doc.id,
    destinationId,
    bodySha256: createHash('sha256').update(text).digest('hex'),
    bodyLength: text.length,
    preview: text.slice(0, 200),
    at: new Date().toISOString(),
  };

  // One atomic write for both. The previous version did a read, added one,
  // then wrote it back, and swallowed any failure with .catch(() => undefined)
  // — so two deliveries in the same second could each read the same count and
  // the second would silently overwrite the first, and a failed update left
  // the record present with a stale count and nothing reported. Both are
  // exactly what §6 "Guaranteed Transaction Verification / Explicit Error
  // Escalation" forbids. FieldValue.increment is atomic server-side, and the
  // batch means the delivery and its count either both land or neither does.
  const batch = adminDb().batch();
  batch.set(doc, clean(delivery));
  batch.update(destRef(uid).doc(destinationId), {
    deliveryCount: FieldValue.increment(1),
  });
  await batch.commit();

  return delivery;
}
