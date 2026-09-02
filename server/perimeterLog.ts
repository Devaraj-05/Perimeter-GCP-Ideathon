import { createHash } from 'crypto';
import { adminDb } from './auth';

/**
 * The Perimeter Log — INV-6 and INV-7.
 *
 * An append-only, hash-chained, per-user record of every decision the system
 * made. The client can read its own; the client cannot write to it at all.
 * An audit log the user's own browser can forge is not an audit log.
 *
 * The chain is what turns "we have a log" into "verify it yourself". Each
 * event stores the SHA-256 of the previous event's canonical form plus a
 * monotonic sequence number, so removing or editing an entry breaks every
 * link after it. That is tamper *evidence*, not tamper prevention — the rules
 * already prevent client writes; this catches anything that got past them,
 * including a bug on our own side.
 */

export type EventKind =
  | 'ingest'
  | 'reader'
  | 'plan'
  | 'decision'
  | 'execute'
  | 'redteam'
  | 'error';

export interface PerimeterEvent {
  id: string;
  seq: number;
  prevHash: string;
  ts: string;
  kind: EventKind;
  zone: string | null;
  tool: string | null;
  decision: 'allow' | 'deny' | 'confirm' | null;
  /** Machine-readable reason code; the UI attaches the human sentence. */
  reason: string;
  /** e.g. "INV-4". Lets a row in the UI point at the rule that produced it. */
  invariant: string | null;
  detail: Record<string, unknown>;
  sessionId: string | null;
}

export interface LogInput {
  kind: EventKind;
  reason: string;
  zone?: string | null;
  tool?: string | null;
  decision?: 'allow' | 'deny' | 'confirm' | null;
  invariant?: string | null;
  detail?: Record<string, unknown>;
  sessionId?: string | null;
}

const MAX_UNTRUSTED_CHARS = 200;

/**
 * Redacts anything that should not persist in an audit record.
 *
 * Constitution §7: no secrets, no more than 200 characters of untrusted text,
 * no full egress payloads. Long strings become a hash plus a length, which
 * preserves the ability to prove two payloads were identical without storing
 * a second copy of an attacker's text in the user's own database.
 */
function redactDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!detail || typeof detail !== 'object') return {};

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (value === undefined) continue;

    if (typeof value === 'string' && value.length > MAX_UNTRUSTED_CHARS) {
      out[key] = {
        truncated: value.slice(0, MAX_UNTRUSTED_CHARS),
        sha256: createHash('sha256').update(value).digest('hex'),
        length: value.length,
      };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Canonical JSON — keys sorted, so the same logical event always hashes to the
 * same value. Without this the chain would break on nothing more than a
 * different key insertion order.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);

  return `{${entries.join(',')}}`;
}

/** Hashes the fields that constitute the event, excluding its own hash. */
export function hashEvent(event: Omit<PerimeterEvent, 'id'> & { id?: string }): string {
  const { seq, prevHash, ts, kind, zone, tool, decision, reason, invariant, detail } = event;
  return createHash('sha256')
    .update(canonicalJson({ seq, prevHash, ts, kind, zone, tool, decision, reason, invariant, detail }))
    .digest('hex');
}

function eventsRef(uid: string) {
  return adminDb().collection('users').doc(uid).collection('perimeter_events');
}

/**
 * Appends one event, inside a transaction so concurrent writes cannot both
 * claim the same sequence number.
 *
 * Never throws. An audit failure must not become a route to skipping the
 * decision it was recording — callers treat a false return as grounds to deny
 * (INV-6 read together with the fail-closed rule in §8).
 */
export async function logEvent(uid: string, input: LogInput): Promise<boolean> {
  try {
    const db = adminDb();
    const col = eventsRef(uid);

    await db.runTransaction(async (tx) => {
      const lastSnap = await tx.get(col.orderBy('seq', 'desc').limit(1));
      const last = lastSnap.docs[0]?.data() as PerimeterEvent | undefined;

      const doc = col.doc();
      const event: PerimeterEvent = {
        id: doc.id,
        seq: (last?.seq ?? 0) + 1,
        prevHash: last ? hashEvent(last) : 'genesis',
        ts: new Date().toISOString(),
        kind: input.kind,
        zone: input.zone ?? null,
        tool: input.tool ?? null,
        decision: input.decision ?? null,
        reason: input.reason,
        invariant: input.invariant ?? null,
        detail: redactDetail(input.detail),
        sessionId: input.sessionId ?? null,
      };

      tx.set(doc, event);
    });

    return true;
  } catch (err: any) {
    console.error('[perimeter] log write failed:', err?.message);
    return false;
  }
}

export interface ChainVerification {
  intact: boolean;
  count: number;
  /** Sequence number of the first event that failed verification. */
  brokenAt: number | null;
  reason: string;
}

/**
 * Walks the chain and reports whether it is intact.
 *
 * Three ways it can break, each reported distinctly: a missing sequence number
 * (an event was deleted), a prevHash that does not match the recomputed hash
 * of its predecessor (an event was edited), or a bad genesis.
 */
export async function verifyChain(uid: string): Promise<ChainVerification> {
  try {
    const snap = await eventsRef(uid).orderBy('seq', 'asc').limit(1000).get();
    const events = snap.docs.map((d) => d.data() as PerimeterEvent);

    if (events.length === 0) {
      return { intact: true, count: 0, brokenAt: null, reason: 'empty_log' };
    }

    let previous: PerimeterEvent | null = null;

    for (const event of events) {
      const expectedSeq = (previous?.seq ?? 0) + 1;
      if (event.seq !== expectedSeq) {
        return {
          intact: false,
          count: events.length,
          brokenAt: event.seq,
          reason: `sequence_gap:expected_${expectedSeq}_got_${event.seq}`,
        };
      }

      const expectedPrev = previous ? hashEvent(previous) : 'genesis';
      if (event.prevHash !== expectedPrev) {
        return {
          intact: false,
          count: events.length,
          brokenAt: event.seq,
          reason: 'hash_mismatch',
        };
      }

      previous = event;
    }

    return { intact: true, count: events.length, brokenAt: null, reason: 'chain_intact' };
  } catch (err: any) {
    console.error('[perimeter] chain verification failed:', err?.message);
    return { intact: false, count: 0, brokenAt: null, reason: 'verification_error' };
  }
}

export async function listEvents(uid: string, limit = 200): Promise<PerimeterEvent[]> {
  const snap = await eventsRef(uid).orderBy('seq', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as PerimeterEvent);
}
