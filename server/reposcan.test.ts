import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  isScannable,
  prioritise,
  summariseCoverage,
  MAX_BLOB_BYTES,
  PRIORITY_FILES,
  type TreeEntry,
} from './reposcan';

/**
 * INV-18 — the repository scanner.
 *
 * Everything tested here is pure. The scan's decisions about WHAT to read are
 * where it succeeds or fails: read too much and the report is noise, read the
 * wrong things and a poisoned AGENTS.md is buried under test fixtures, report
 * partial coverage as complete and the whole thing is a lie.
 *
 * The network parts are thin by design so that this file can cover the parts
 * that matter without an HTTP fixture.
 */

const entry = (path: string, size = 1000): TreeEntry => ({
  path,
  sha: 'abc123',
  size,
  type: 'blob',
});

describe('isScannable — what the scan refuses to fetch', () => {
  it('accepts ordinary text and source files', () => {
    for (const p of ['README.md', 'src/app.ts', 'docs/notes.txt', 'a/b/c.py']) {
      expect(isScannable(entry(p))).toBe(true);
    }
  });

  it('refuses anything that is not a blob', () => {
    expect(isScannable({ path: 'src', sha: 'x', size: 0, type: 'tree' })).toBe(false);
  });

  it('refuses binaries by extension', () => {
    for (const p of ['logo.png', 'a.jpg', 'font.woff2', 'app.zip', 'lib.so', 'x.pdf']) {
      expect(isScannable(entry(p))).toBe(false);
    }
  });

  it('refuses lockfiles — enormous, generated, and never where an injection lives', () => {
    for (const p of ['package-lock.json', 'yarn.lock', 'go.sum', 'pnpm-lock.yaml']) {
      expect(isScannable(entry(p))).toBe(false);
    }
  });

  it('refuses vendored and build directories', () => {
    for (const p of ['node_modules/x/index.js', 'vendor/a.go', 'dist/bundle.js', 'build/out.js']) {
      expect(isScannable(entry(p))).toBe(false);
    }
  });

  it('refuses a blob over the per-file cap', () => {
    expect(isScannable(entry('big.txt', MAX_BLOB_BYTES + 1))).toBe(false);
    expect(isScannable(entry('ok.txt', MAX_BLOB_BYTES))).toBe(true);
  });

  it('refuses a blob with no readable size rather than fetching it blind', () => {
    expect(isScannable({ path: 'x.txt', sha: 'a', type: 'blob' })).toBe(false);
  });
});

describe('prioritise — a poisoned AGENTS.md must not be buried', () => {
  it('puts agent-instruction files first, in the declared order', () => {
    const ordered = prioritise([
      entry('src/deep/module.ts'),
      entry('AGENTS.md'),
      entry('src/other.ts'),
      entry('README.md'),
    ]);
    expect(ordered[0].path).toBe('AGENTS.md');
    expect(ordered[1].path).toBe('README.md');
  });

  it('treats every declared agent-instruction file as priority', () => {
    for (const name of PRIORITY_FILES) {
      const ordered = prioritise([entry('src/a.ts'), entry(name)]);
      expect(ordered[0].path).toBe(name);
    }
  });

  it('prioritises .github workflows and instruction files by prefix', () => {
    const ordered = prioritise([
      entry('src/a.ts'),
      entry('.github/workflows/ci.yml'),
      entry('.github/copilot-instructions.md'),
    ]);
    expect(ordered[0].path.startsWith('.github/')).toBe(true);
    expect(ordered[1].path.startsWith('.github/')).toBe(true);
    expect(ordered[2].path).toBe('src/a.ts');
  });

  it('matches a priority filename in a subdirectory too', () => {
    // A monorepo puts CLAUDE.md in each package. All of them are worth
    // reading before any source file.
    const ordered = prioritise([entry('src/a.ts'), entry('packages/api/CLAUDE.md')]);
    expect(ordered[0].path).toBe('packages/api/CLAUDE.md');
  });

  it('is stable within a tier, so a rerun reports in the same order', () => {
    const input = [entry('src/b.ts'), entry('src/a.ts'), entry('src/c.ts')];
    expect(prioritise(input).map((e) => e.path)).toEqual(['src/b.ts', 'src/a.ts', 'src/c.ts']);
  });

  it('does not drop anything', () => {
    const input = [entry('AGENTS.md'), entry('a.ts'), entry('b.ts')];
    expect(prioritise(input)).toHaveLength(3);
  });
});

describe('summariseCoverage — a partial scan never reads as a clean bill of health', () => {
  it('says so plainly when the whole tree was read', () => {
    const line = summariseCoverage({ filesScanned: 12, filesTotal: 12, stoppedBy: 'complete' });
    expect(line).toContain('12 of 12');
    expect(line).not.toMatch(/not read/i);
  });

  it('names the cap that stopped it and how many files went unread', () => {
    const line = summariseCoverage({ filesScanned: 412, filesTotal: 2180, stoppedBy: 'max_bytes' });
    expect(line).toContain('412 of 2,180');
    expect(line).toContain('1,768');
    expect(line).toMatch(/not read/i);
  });

  it('distinguishes each stop reason', () => {
    const reasons = ['max_files', 'max_bytes', 'time', 'rate_limit'] as const;
    const lines = reasons.map((stoppedBy) =>
      summariseCoverage({ filesScanned: 1, filesTotal: 9, stoppedBy }),
    );
    // Four different explanations, not one generic "stopped early".
    expect(new Set(lines).size).toBe(4);
    for (const line of lines) expect(line).toMatch(/not read/i);
  });
});

describe('INV-18 — the scanner does not think', () => {
  /**
   * The claim is that a repository full of injections cannot influence this
   * scanner, because no model is involved in it. That is a property of what
   * the file imports, so it is checkable rather than merely stated.
   *
   * This is the same shape as inv8.test.ts and inv9.test.ts: grep the source
   * for the thing that must not be there. It proves nobody wired a model in,
   * which combined with the behavioural tests above is the whole invariant.
   */
  const SOURCE = readFileSync(join(process.cwd(), 'server', 'reposcan.ts'), 'utf8');

  it('imports no model client', () => {
    // Plain string matching, not regex: an assertion whose escaping can rot
    // is an assertion nobody can trust.
    for (const forbidden of [
      "from './gemini'",
      "from './reader'",
      "from './planner'",
      "from './classify'",
      '@google/genai',
    ]) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });

  it('calls nothing that generates', () => {
    for (const forbidden of ['generateContent', 'getAI(', 'classifyL2', 'buildReaderRequest']) {
      expect(SOURCE).not.toContain(forbidden);
    }
  });

  it('persists nothing — no artifact, no segment, no Firestore handle', () => {
    // Fetched repository text lives for one request. Storing excerpts of
    // someone else’s repository in this user’s database is a thing this
    // feature deliberately does not do.
    expect(SOURCE).not.toMatch(/adminDb/);
    expect(SOURCE).not.toMatch(/createSegment/);
    expect(SOURCE).not.toMatch(/artifactsRef/);
    expect(SOURCE).not.toMatch(/ingestUntrustedText/);
  });
});

describe('signal quality in a repository', () => {
  /**
   * A finding a user learns to scroll past is worse than one never shown: it
   * teaches them to distrust the whole report. Scanning this project's own
   * repository produced thirteen matches on README.md, eight of them
   * offdomain_url, burying instruction_override and concealment_request.
   */
  it('treats offdomain_url as noise inside a repository', async () => {
    const source = readFileSync(join(process.cwd(), 'server', 'reposcan.ts'), 'utf8');
    expect(source).toContain('NOISE_IN_REPOSITORIES');
    expect(source).toContain("'offdomain_url'");
  });

  it('does not discard any signal that can stand on its own', () => {
    // Only weak, non-high-confidence signals may ever be filtered. If this
    // list grows to include one that justifies a hostile verdict alone, the
    // scan has started hiding the findings it exists to surface.
    const source = readFileSync(join(process.cwd(), 'server', 'reposcan.ts'), 'utf8');
    for (const strong of [
      'instruction_override',
      'concealment_request',
      'tool_invocation_request',
      'fake_system_role',
      'hidden_unicode',
      'bidi_override',
    ]) {
      expect(source.includes(`NOISE_IN_REPOSITORIES = new Set([${strong}`)).toBe(false);
    }
  });
});
