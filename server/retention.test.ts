import { describe, it, expect, afterEach } from 'vitest';
import { retentionDays, artifactExpiry } from './retention';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Retention policy — Amendment O, INV-24.
 *
 * The pure helpers here; the live sweep is exercised in the emulator suite.
 * The invariant that matters — entries are never deleted by a timer — is
 * asserted against the sweep's SOURCE, because a unit test cannot prove the
 * absence of a branch by running it.
 */

const original = process.env.ARTIFACT_RETENTION_DAYS;
afterEach(() => {
  if (original === undefined) delete process.env.ARTIFACT_RETENTION_DAYS;
  else process.env.ARTIFACT_RETENTION_DAYS = original;
});

describe('retentionDays reads the deployment setting', () => {
  it('is null when unset — keep forever', () => {
    delete process.env.ARTIFACT_RETENTION_DAYS;
    expect(retentionDays()).toBeNull();
  });

  it('is null for a non-positive or unreadable value rather than deleting immediately', () => {
    for (const bad of ['0', '-5', 'soon', '']) {
      process.env.ARTIFACT_RETENTION_DAYS = bad;
      expect(retentionDays(), bad).toBeNull();
    }
  });

  it('reads a positive number of days', () => {
    process.env.ARTIFACT_RETENTION_DAYS = '90';
    expect(retentionDays()).toBe(90);
  });
});

describe('artifactExpiry stamps a fixed point at ingest', () => {
  it('is null when nothing expires', () => {
    delete process.env.ARTIFACT_RETENTION_DAYS;
    expect(artifactExpiry()).toBeNull();
  });

  it('is the ingest time plus the window', () => {
    process.env.ARTIFACT_RETENTION_DAYS = '30';
    const now = Date.parse('2026-09-06T00:00:00.000Z');
    expect(artifactExpiry(now)).toBe('2026-10-06T00:00:00.000Z');
  });
});

describe('INV-24 — the sweep cannot touch entries', () => {
  const SRC = readFileSync(join(process.cwd(), 'server', 'retention.ts'), 'utf8');

  it('only ever names artifacts and segments', () => {
    // A user's own writing is removed by that user alone. The sweep must have
    // no branch that reaches the entries collection.
    expect(SRC).toContain("collection('artifacts')");
    expect(SRC).toContain("collection('segments')");
    expect(SRC).not.toContain("collection('entries')");
  });

  it('deletes only documents with an expiresAt in the past', () => {
    expect(SRC).toMatch(/where\('expiresAt', '<=', /);
  });

  it('does not scan at all when retention is unconfigured', () => {
    // A null policy means the query would match nothing anyway, but skipping
    // the scan makes the no-op explicit and free.
    expect(SRC).toMatch(/retentionDays\(\) === null\) return/);
  });
});
