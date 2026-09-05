import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Email and password sign-in, asserted against its own source.
 *
 * This path is a deliberate deviation from Directive 3, made at the project
 * owner's instruction after the conflict was raised. A deviation that is
 * decided on deserves MORE checking than one that was never contemplated, so
 * the properties that make it defensible are pinned here rather than assumed.
 *
 * Source-grep, matching gmail.test.ts and inv8.test.ts: these are claims about
 * code that a render test cannot reach without a live Firebase project.
 */
const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), 'utf8');

const FIREBASE = strip(read('src', 'lib', 'firebase.ts'));
const APP = strip(read('src', 'App.tsx'));
const LANDING = strip(read('src', 'components', 'LandingPage.tsx'));

describe('the password is never handled beyond the SDK call', () => {
  it('nothing logs a password', () => {
    for (const [name, src] of [
      ['firebase.ts', FIREBASE],
      ['App.tsx', APP],
      ['LandingPage.tsx', LANDING],
    ] as const) {
      for (const line of src.split('\n')) {
        if (!line.includes('console.')) continue;
        // The VALUE, not the word. "Password reset failed:" is a label and
        // discloses nothing; `, password)` would be the leak.
        expect(line, `${name}: ${line.trim()}`).not.toMatch(
          /[,(]\s*(password|confirm)\b|\$\{\s*(password|confirm)\b/,
        );
      }
    }
  });

  it('the password never reaches our own server', () => {
    // Firebase Authentication holds the credential. If a password were posted
    // to /api/* it would pass through our logs, our error handlers and our
    // Cloud Run request traces.
    expect(FIREBASE).not.toMatch(/fetch\([^)]*password/i);
    expect(APP).not.toMatch(/apiFetch[^)]*password/i);
    expect(APP).not.toMatch(/fetch\([^)]*password/i);
  });

  it('no password is written to storage', () => {
    for (const src of [FIREBASE, APP, LANDING]) {
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/i);
    }
  });

  it('App.tsx holds no password state, only passes it through', () => {
    // It arrives as an argument, goes to the SDK, and is gone. A useState
    // holding it would outlive the submit and land in React devtools.
    expect(APP).not.toMatch(/useState[^;]{0,40}[Pp]assword/);
  });
});

describe('errors say what the user can act on, and nothing more', () => {
  it('the raw Firebase error is never shown', () => {
    // Firebase messages carry internal detail and sometimes the address
    // itself. INV-10 keeps that class of thing off the screen.
    expect(APP).toContain('describeAuthError(err)');
    expect(APP).not.toMatch(/setAuthError\(err\?\.message/);
  });

  it('only the error CODE is logged, never the error object', () => {
    for (const line of APP.split('\n')) {
      if (!line.includes('console.error') || !line.includes('sign')) continue;
      if (!line.includes('err')) continue;
      expect(line.trim()).toMatch(/err\?\.code/);
    }
  });

  it('wrong password and no such account are indistinguishable', () => {
    // Firebase collapses these into auth/invalid-credential on purpose, so a
    // sign-in form cannot be used to discover which addresses have accounts.
    // Splitting them apart to be more helpful would hand back that oracle.
    const table = FIREBASE.slice(FIREBASE.indexOf('const table'));
    const wrong = /'auth\/wrong-password':\s*'([^']+)'/.exec(table)?.[1];
    const missing = /'auth\/user-not-found':\s*'([^']+)'/.exec(table)?.[1];
    const invalid = /'auth\/invalid-credential':\s*'([^']+)'/.exec(table)?.[1];
    expect(wrong).toBeDefined();
    expect(wrong).toBe(missing);
    expect(wrong).toBe(invalid);
  });

  it('the reset confirmation does not reveal whether the account exists', () => {
    // Same words either way, and it is set in a finally so a thrown error
    // cannot change the wording.
    expect(APP).toMatch(/If an account exists for that address/);
    const reset = APP.slice(APP.indexOf('handlePasswordReset'));
    // The confirmation itself, not the setAuthNotice(null) that clears state
    // at the top of the handler.
    expect(reset.indexOf('finally')).toBeLessThan(reset.indexOf('If an account exists'));
  });

  it('has copy for every failure a user can actually cause', () => {
    for (const code of [
      'auth/invalid-email',
      'auth/email-already-in-use',
      'auth/weak-password',
      'auth/too-many-requests',
      'auth/network-request-failed',
      'auth/operation-not-allowed',
    ]) {
      expect(FIREBASE, code).toContain(code);
    }
  });

  it('falls back to a sentence rather than an empty string', () => {
    expect(FIREBASE).toMatch(/table\[code\] \?\? '[^']+'/);
  });
});

describe('federated sign-in remains the prescribed default', () => {
  it('Google sign-in is still present', () => {
    expect(FIREBASE).toContain('signInWithPopup');
    expect(LANDING).toContain('Sign in with Google');
  });

  it('the email form is behind a disclosure, not the primary control', () => {
    expect(LANDING).toContain('Use an email address instead');
  });

  it('the deviation is recorded in the source, not left to be discovered', () => {
    // A directive departed from silently is indistinguishable from one that
    // was never read.
    expect(read('src', 'lib', 'firebase.ts')).toMatch(/deliberate deviation from Directive 3/);
  });
});
