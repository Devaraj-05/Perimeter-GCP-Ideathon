import { adminDb } from './auth';

/**
 * Provenance tagging — INV-1.
 *
 * Every piece of text in the system carries an origin label, and the label
 * travels with the data through Firestore and through every function call.
 *
 * The central property is checkable in a unit test rather than argued about in
 * a review: no string tagged UNTRUSTED is ever placed in a request that has
 * tools attached. TypeScript enforces most of it at compile time;
 * assertNoUntrusted() catches the rest at the boundary, at runtime, where a
 * cast or an `any` could otherwise have slipped through.
 */

export type Zone = 'SYSTEM' | 'USER' | 'UNTRUSTED' | 'DERIVED';

export type SourceType = 'typed' | 'paste' | 'url' | 'file' | 'image' | 'reader';

export interface Segment<Z extends Zone = Zone> {
  readonly id: string;
  readonly zone: Z;
  readonly text: string;
  /** True for anything derived from UNTRUSTED content. Propagates. */
  readonly taint: boolean;
  readonly sourceType: SourceType;
  /** URL or filename. Itself untrusted — never fetched without the guard. */
  readonly sourceRef: string | null;
  /** Set on DERIVED segments: the UNTRUSTED segment they came from. */
  readonly derivedFrom: string | null;
  readonly createdAt: string;
}

/**
 * Anything safe to place in a tool-enabled request.
 *
 * Note the absence of UNTRUSTED from this union. That absence is the type-level
 * half of INV-1: a function taking TrustedSegment[] cannot be handed raw
 * external content without a deliberate cast, and a deliberate cast is
 * something a reviewer can see.
 */
export type TrustedSegment = Segment<'SYSTEM' | 'USER' | 'DERIVED'>;

/**
 * Thrown when an invariant is breached at runtime.
 *
 * This is never caught and swallowed. It logs a perimeter event, returns a
 * generic 500, and in development fails the test suite. If it throws in
 * production something is architecturally wrong and we want to be told, not
 * to degrade quietly into the unsafe behaviour it was preventing.
 */
export class PerimeterViolation extends Error {
  constructor(
    readonly invariant: string,
    message: string,
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'PerimeterViolation';
  }
}

/**
 * INV-1 runtime guard. Call immediately before every tool-enabled model
 * request — not earlier, because the point is to check the array that is
 * actually about to be sent, after any filtering or mapping.
 */
export function assertNoUntrusted(
  segments: readonly Segment[],
): asserts segments is TrustedSegment[] {
  if (!Array.isArray(segments)) {
    throw new PerimeterViolation('INV-1', 'planner context was not an array of segments');
  }

  // findIndex, not find. find() returns the offending ELEMENT, and a malformed
  // segment is itself falsy - so `if (offender)` would silently pass exactly
  // the input the guard exists to reject. Caught by a test; worth the comment
  // because the bug reads as correct code.
  const badIndex = segments.findIndex((s) => !s || s.zone === 'UNTRUSTED');
  if (badIndex !== -1) {
    const offender = segments[badIndex];
    // The offending text is deliberately not included in the message: it is
    // attacker-controlled and this string reaches logs.
    throw new PerimeterViolation(
      'INV-1',
      offender
        ? `segment ${offender.id} with zone UNTRUSTED reached a tool-enabled context`
        : `malformed segment at index ${badIndex} reached a tool-enabled context`,
    );
  }
}

/** True when any segment in the set derives from untrusted content. */
export function isTainted(segments: readonly Segment[]): boolean {
  if (!Array.isArray(segments)) return false;
  return segments.some((s) => s?.taint === true || s?.zone === 'UNTRUSTED');
}

/**
 * Classifies text the user submitted through the composer.
 *
 * The distinction that carries most of the value: text the user *types* is
 * USER, text the user *pastes* is UNTRUSTED. They did not author it; they are
 * only the transport. A pasted email is exactly as attacker-controlled as one
 * fetched over the wire, and treating it as the user's own words is how an
 * injection walks straight through the front door.
 *
 * Below the threshold, a paste is treated as typing — quoting a sentence into
 * your own journal entry is normal writing, and prompting on every short paste
 * would train the user to dismiss the prompt without reading it.
 */
export const PASTE_CLASSIFY_THRESHOLD = 200;

export function needsPasteClassification(text: string, wasPasted: boolean): boolean {
  if (!wasPasted) return false;
  return typeof text === 'string' && text.length >= PASTE_CLASSIFY_THRESHOLD;
}

/** Ambiguity resolves toward UNTRUSTED. The safe default is the suspicious one. */
export function defaultZoneForPaste(): Zone {
  return 'UNTRUSTED';
}

// ---------------------------------------------------------------
// Persistence — Admin SDK only (firestore.rules denies client writes)
// ---------------------------------------------------------------

function segmentsRef(uid: string) {
  return adminDb().collection('users').doc(uid).collection('segments');
}

/** Firestore rejects undefined; Directive 6 requires stripping before writes. */
function clean<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

export interface CreateSegmentInput {
  zone: Zone;
  text: string;
  sourceType: SourceType;
  sourceRef?: string | null;
  derivedFrom?: string | null;
}

/** Caps a single segment so one document cannot exhaust a context window. */
const MAX_SEGMENT_CHARS = 200_000;

export async function createSegment(
  uid: string,
  input: CreateSegmentInput,
): Promise<Segment> {
  const doc = segmentsRef(uid).doc();

  const segment: Segment = {
    id: doc.id,
    zone: input.zone,
    text: String(input.text ?? '').slice(0, MAX_SEGMENT_CHARS),
    // Taint is derived, never supplied by a caller. UNTRUSTED content is
    // tainted by definition, and so is anything a Reader produced from it.
    taint: input.zone === 'UNTRUSTED' || input.zone === 'DERIVED',
    sourceType: input.sourceType,
    sourceRef: input.sourceRef ?? null,
    derivedFrom: input.derivedFrom ?? null,
    createdAt: new Date().toISOString(),
  };

  await doc.set(clean({ ...segment, bytes: Buffer.byteLength(segment.text, 'utf8') }));
  return segment;
}

export async function getSegments(uid: string, ids: string[]): Promise<Segment[]> {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  // Path is uid-scoped, so an id belonging to another user simply does not
  // resolve. Ownership is structural here rather than filtered.
  const docs = await Promise.all(ids.slice(0, 50).map((id) => segmentsRef(uid).doc(id).get()));

  return docs.filter((d) => d.exists).map((d) => d.data() as Segment);
}

export async function listSegments(uid: string, limit = 100): Promise<Segment[]> {
  const snap = await segmentsRef(uid).orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => d.data() as Segment);
}
