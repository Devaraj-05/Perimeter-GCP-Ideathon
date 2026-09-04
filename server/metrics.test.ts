import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Amendment E — administrative scope is counters, never content.
 *
 * The rules tests prove an admin cannot READ another user's documents. This
 * proves the other half: that the document an admin *can* read was never built
 * to hold anything personal in the first place. Defence in depth — if the rule
 * were ever loosened, the payload still would not carry a journal.
 *
 * A source-level check because the property is about what the code is capable
 * of writing, not about one execution of it.
 */
const RAW = readFileSync(join(process.cwd(), 'server', 'metrics.ts'), 'utf8');

/**
 * Comments are stripped before checking.
 *
 * The first version of this file failed against metrics.ts's own docblock,
 * which says "no uid, no journal text, no payload body" — the file was flagged
 * for *describing* the property it upholds. The claim being tested is about
 * what the code can write, so prose must not participate.
 */
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the metrics document cannot carry personal data', () => {
  it('never writes a uid', () => {
    // recordRedteamRun does not take a uid, so it cannot write one.
    expect(SRC).not.toMatch(/\buid\b/);
  });

  it('never writes payload bodies, previews or place names', () => {
    for (const forbidden of ['body', 'preview', 'placeName', 'content', 'entries', 'email']) {
      expect(SRC, `metrics.ts references ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('increments atomically rather than read-modify-write', () => {
    // Concurrent runs must not lose a count.
    expect(SRC).toContain('FieldValue.increment');
    expect(SRC).not.toMatch(/const\s+current\s*=\s*await/);
  });

  it('sanitises the class key before using it as a field name', () => {
    // The class reaches a Firestore field path. Unbounded input there is how a
    // document grows fields it was never meant to have.
    expect(SRC).toMatch(/replace\(/);
    expect(SRC).toMatch(/slice\(0,\s*40\)/);
  });

  it('telemetry failure never propagates to the caller', () => {
    // A failed counter must not fail the attack run the user asked for.
    expect(SRC).toMatch(/catch\s*\(/);
    expect(SRC).toContain('[metrics] increment failed');
  });
});
