import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * INV-14 / Amendment F — the shared ingest choke point.
 *
 * ingestUntrustedText() is now the ONLY way anything untrusted becomes an
 * artifact. Notes, links and (later) files and email all pass through it. That
 * concentration is the security benefit, and it is only a benefit while it
 * holds — the failure mode is a future input type quietly growing its own copy
 * that forgets `zone: 'UNTRUSTED'` or skips classifyL2, which no runtime test
 * would catch because the copy would work perfectly.
 *
 * So these assert the shape of the source. Comments are stripped first: the
 * file documents the properties it upholds, and prose must not satisfy or
 * violate a check about code.
 */
const RAW = readFileSync(join(process.cwd(), 'server', 'ingest.ts'), 'utf8');
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('ingestUntrustedText is the only door', () => {
  it('exists and is exported', () => {
    expect(SRC).toContain('export async function ingestUntrustedText');
  });

  it('hardcodes the UNTRUSTED zone rather than taking it as a parameter', () => {
    // A zone parameter is how "just this once, trust it" gets added later.
    expect(SRC).toContain("zone: 'UNTRUSTED'");
    expect(SRC).not.toMatch(/zone:\s*input\./);
    expect(SRC).not.toMatch(/zone\??:\s*(Zone|string)/);
  });

  it('is the only place createSegment is called in this file', () => {
    // If a route calls createSegment directly it has bypassed screening.
    expect(SRC.match(/createSegment\(/g) ?? []).toHaveLength(1);
  });

  it('is the only place an artifact document is written in this file', () => {
    // artifactsRef(...).doc(...).set(...) outside the helper means a second,
    // unscreened artifact shape.
    expect(SRC.match(/artifactsRef\([^)]*\)\.doc\([^)]*\)\.set\(/g) ?? []).toHaveLength(1);
  });

  it('always screens with both layers before storing', () => {
    expect(SRC).toContain('detectL1(');
    expect(SRC).toContain('classifyL2(');
    expect(SRC).toContain('fuseVerdict(');
  });

  it('marks every artifact untrusted', () => {
    expect(SRC).toContain("trust: 'untrusted'");
    expect(SRC).not.toMatch(/trust:\s*input\./);
  });
});

describe('the note route does not privilege pasted text', () => {
  it('routes through the shared helper like every other input', () => {
    const noteRoute = SRC.slice(SRC.indexOf("ingestRouter.post('/note'"));
    expect(noteRoute).toContain('ingestUntrustedText(');
    expect(noteRoute).toContain("sourceType: 'paste'");
  });

  it('caps the note at the artifact body cap so nothing truncates silently', () => {
    expect(SRC).toContain('MAX_NOTE_CHARS');
    expect(SRC).toMatch(/MAX_NOTE_CHARS\s*=\s*20_000/);
  });

  it('rate-limits on its own bucket', () => {
    expect(SRC).toMatch(/checkRateLimit\(`note:\$\{uid\}`/);
  });
});
