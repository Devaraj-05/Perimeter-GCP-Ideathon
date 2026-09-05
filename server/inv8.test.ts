import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';

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

/**
 * Google API keys that have ever appeared in this history and are known to be
 * public by design.
 *
 * Held as SHA-256 digests rather than values. Listing a key here in full would
 * commit it again, in the very file that exists to stop that.
 */
const KNOWN_PUBLIC_HISTORICAL: Record<string, string> = {
  // The current Firebase web key. Also read from the config at runtime below;
  // pinned here so the history scan does not depend on that file existing.
  '2113e74341c7b199a14bcf00ed2b5e398b498dd528295bbe4d27a15525364f1c': 'current Firebase web key',

  // The Firebase web key of gen-lang-client-0060098211, the original AI Studio
  // project this application migrated away from on 2026-09-01 (382121c). A
  // Firebase web key identifies a project and authorises nothing; it is
  // protected by security rules and authorised domains rather than by secrecy.
  // It is in history because this config file's apiKey line changed, and it
  // stays there because rewriting history to remove a public-by-design value
  // would break every clone for no benefit.
  //
  // What DOES matter about it is in the README: that project should have its
  // key deleted, because an unwatched project with a live key is a sign-up and
  // quota surface nobody is looking at.
  '63a14d60812e47c27b3559f19302fbc4380201361f712a159e07f0c54587969b':
    'Firebase web key of the abandoned gen-lang-client-0060098211 project',
};

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Every Google API key that appears anywhere in this repository history.
 *
 * The tracked-file scan below cannot see these. This file's own docstring says a
 * key survives in history even after the file is deleted, and then it only
 * looked at the present — which is how two GitHub secret-scanning alerts
 * arrived for values that exist in no tracked file.
 */
function historicalGoogleKeys(): string[] {
  try {
    const log = execSync('git log --all -p --no-color', {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
    return [...new Set(log.match(GOOGLE_KEY) ?? [])];
  } catch {
    return [];
  }
}

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

  it('no Google API key in HISTORY is anything but a known public one', () => {
    // Deleting a file does not remove its contents from git. A key committed
    // once is reachable forever, which is what GitHub secret scanning reports
    // and what the tracked-file check above cannot see.
    const unknown = historicalGoogleKeys().filter(
      (k) => !(digest(k) in KNOWN_PUBLIC_HISTORICAL),
    );

    expect(
      unknown.map((k) => `${k.slice(0, 12)}… sha256=${digest(k).slice(0, 16)}`),
      'a key in history cannot be un-committed: rotate it, then add its digest here with a reason',
    ).toEqual([]);
  });

  it('the history scan is not vacuous', () => {
    // If the log scan silently returns nothing, the test above passes while
    // checking nothing at all.
    expect(historicalGoogleKeys().length).toBeGreaterThan(0);
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
