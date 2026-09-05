import { createHash } from 'crypto';
import type { ReaderOutput } from './reader';

/**
 * Caching what the Reader saw — Amendment M, INV-21.
 *
 * An artifact's text does not change after ingest, so the Reader's observation
 * of it cannot either. Re-deriving it on every turn cost one model call per
 * connected source per question.
 *
 * The whole of the security argument is in the key. This project has already
 * shipped one taint-laundering defect — `createdBy: 'agent'` written to entries
 * and never read back, so an agent-authored note returned later as untainted
 * first-party text. A stored observation has that exact shape: computed in one
 * turn, trusted in the next. So:
 *
 *   - the key is a digest of the PRECISE string the Reader was given, not the
 *     artifact id, not its title, not a timestamp. Different bytes, different
 *     key, no hit.
 *   - only `output` is cached. Zone and taint are derived every turn from the
 *     artifact's own `trust` field, exactly as before, and this module has no
 *     way to influence them — it does not import them and cannot see them.
 */

export interface CachedObservation {
  /** Digest of the exact text the Reader was given. */
  key: string;
  output: ReaderOutput;
}

/**
 * The text the Reader is given, and the only thing the key is derived from.
 *
 * Exported so the caller cannot compose it one way for the digest and another
 * way for the call — the defect that would make every key a lie.
 */
export function readerInput(title: string, body: string): string {
  return title + '\n\n' + body;
}

export function observationKey(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * A stored value is usable only if it is well formed AND its key matches the
 * text in hand. Anything else is a miss, never a partial hit: a malformed
 * cache entry that produced a half-populated observation would be worse than
 * no cache, because the Planner cannot tell the difference.
 */
export function readCached(stored: unknown, text: string): ReaderOutput | null {
  if (!stored || typeof stored !== 'object') return null;
  const c = stored as Partial<CachedObservation>;
  if (typeof c.key !== 'string' || c.key !== observationKey(text)) return null;
  if (!c.output || typeof c.output !== 'object') return null;
  // The two fields every consumer reads. A stored shape missing either is from
  // an older schema and is re-derived rather than guessed at.
  const o = c.output as Partial<ReaderOutput>;
  if (typeof o.contains_instruction_attempt !== 'boolean') return null;
  return c.output as ReaderOutput;
}

export function toCached(text: string, output: ReaderOutput): CachedObservation {
  return { key: observationKey(text), output };
}
