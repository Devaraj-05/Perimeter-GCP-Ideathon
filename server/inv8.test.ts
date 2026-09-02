import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

/**
 * INV-8 as an executable check — secrets are never committed.
 *
 * This deliberately scans what git actually tracks rather than what is on
 * disk. A key sitting in an ignored .env is fine and expected; the same key in
 * a tracked file is a leak that survives in history forever, even after the
 * file is deleted.
 *
 * The naive version of this check greps dist/ for /AIza.../ and fails on the
 * PUBLIC Firebase web API key, which is supposed to ship in a client bundle.
 * A check that fires on correct code is a check people mute, so this one
 * excludes the known-public Firebase config value and looks for anything else.
 */

/** Files git is tracking. Untracked and ignored files are intentionally excluded. */
function trackedFiles(): string[] {
  try {
    return execSync('git ls-files', { encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The Firebase web API key is public by design: it identifies the project to
 * Firebase and is protected by security rules and authorised domains, not by
 * secrecy. It legitimately appears in firebase-applet-config.json and in the
 * built client bundle.
 */
function publicFirebaseKey(): string | null {
  if (!existsSync('firebase-applet-config.json')) return null;
  const cfg = JSON.parse(readFileSync('firebase-applet-config.json', 'utf8'));
  return typeof cfg.apiKey === 'string' ? cfg.apiKey : null;
}

const GOOGLE_KEY = /AIza[0-9A-Za-z_-]{30,}/g;

describe('INV-8 — no secret is committed to the repository', () => {
  const tracked = trackedFiles();
  const knownPublic = publicFirebaseKey();

  it('can enumerate tracked files (guards against a vacuous pass)', () => {
    expect(tracked.length).toBeGreaterThan(10);
  });

  it('no .env file is tracked', () => {
    const envFiles = tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.example'));
    expect(envFiles).toEqual([]);
  });

  it('no Google API key other than the public Firebase web key is tracked', () => {
    const offenders: string[] = [];

    for (const file of tracked) {
      if (!existsSync(file)) continue;
      let body: string;
      try {
        body = readFileSync(file, 'utf8');
      } catch {
        continue; // binary or unreadable
      }

      const found = body.match(GOOGLE_KEY) ?? [];
      for (const key of found) {
        if (knownPublic && key === knownPublic) continue; // public by design
        offenders.push(`${file}: ${key.slice(0, 12)}…`);
      }
    }

    expect(
      offenders,
      'a key in a tracked file stays in git history even after deletion',
    ).toEqual([]);
  });

  it('no GitHub personal access token is tracked', () => {
    const pat = /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}/;
    const offenders = tracked.filter((f) => {
      if (!existsSync(f)) return false;
      try {
        return pat.test(readFileSync(f, 'utf8'));
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });

  it('no service account private key is tracked', () => {
    // Built from parts so the literal markers never appear in this file.
    // Otherwise the guard flags itself the moment it is committed - which is
    // exactly what happened on the first run, and the reason self-exclusion
    // would have been the wrong fix: a guard that skips its own file cannot
    // catch a secret pasted into it.
    const SA_MARKER = '"type": "' + 'service_account"';
    const PEM_MARKER = 'BEGIN' + ' PRIVATE KEY';

    const offenders = tracked.filter((f) => {
      if (!existsSync(f)) return false;
      try {
        const body = readFileSync(f, 'utf8');
        return body.includes(SA_MARKER) || body.includes(PEM_MARKER);
      } catch {
        return false;
      }
    });
    expect(offenders).toEqual([]);
  });
});
