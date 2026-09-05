import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Every ingest route returns its evidence.
 *
 * A PDF came back with verdict 'hostile' and no matches, because the file
 * route alone dropped the field that ingestUntrustedText had already computed.
 * On screen that read as a HOSTILE chip beside the sentence "No injection
 * attempts found in document.pdf" — the product's central claim contradicting
 * itself, on the one document a user uploaded specifically to test it.
 *
 * The failure mode is a route forgetting a field its siblings return, so the
 * assertion is over ALL of them rather than the one that was wrong.
 */
const SOURCE = readFileSync(join(process.cwd(), 'server', 'ingest.ts'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Each `res.status(201).json({...})` body in the file. */
function createdResponses(): string[] {
  const out: string[] = [];
  const marker = 'res.status(201).json({';
  let i = SOURCE.indexOf(marker);
  while (i !== -1) {
    let depth = 0;
    let j = i + marker.length - 1;
    for (; j < SOURCE.length; j++) {
      if (SOURCE[j] === '{') depth++;
      else if (SOURCE[j] === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push(SOURCE.slice(i, j + 1));
    i = SOURCE.indexOf(marker, j);
  }
  return out;
}

describe('ingest responses carry their evidence', () => {
  // Only responses that CREATE AN ARTIFACT. /repo returns { source } and has
  // no verdict to evidence, so asserting over every 201 in the file would be
  // asserting something untrue — and a guard that has to be loosened to pass
  // is worth less than one scoped correctly in the first place.
  const responses = createdResponses().filter((r) => r.includes('artifactId'));

  it('finds the artifact-creating routes', () => {
    // link, note and file. A fourth is covered automatically.
    expect(responses.length).toBeGreaterThanOrEqual(3);
  });

  it('every one returns a verdict', () => {
    for (const r of responses) expect(r, r.slice(0, 60)).toContain('verdict');
  });

  it('every one returns matches alongside that verdict', () => {
    // A verdict without evidence is an assertion the user cannot check, which
    // is the opposite of what this product claims to do.
    for (const r of responses) expect(r, r.slice(0, 60)).toContain('matches');
  });

  it('every one returns the signals that produced the verdict', () => {
    for (const r of responses) expect(r, r.slice(0, 60)).toContain('signals');
  });
});
