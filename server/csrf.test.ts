import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * CSRF immunity, asserted structurally — H1.
 *
 * A cross-site request forgery works only when the browser attaches the
 * credential automatically — that is, when auth rides in a cookie. This
 * application authenticates every request from an `Authorization: Bearer`
 * header, which a cross-origin page cannot set on a request it forges, so
 * there is no CSRF surface to defend rather than a defence to add.
 *
 * The risk is not that this is wrong today; it is that someone later adds
 * cookie-session auth "for convenience" and reopens the hole silently. These
 * assertions are what make that a failing test rather than a quiet
 * regression. Source-grep, matching gmail.test.ts and account.test.ts.
 */
const strip = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const read = (f: string) => strip(readFileSync(join(process.cwd(), 'server', f), 'utf8'));
const AUTH = read('auth.ts');

describe('authentication is Bearer-token, not cookie', () => {
  it('reads the credential from the Authorization header', () => {
    expect(AUTH).toContain('req.headers?.authorization');
    expect(AUTH).toMatch(/scheme.*bearer|bearer.*scheme/i);
  });

  it('never reads a cookie for authentication', () => {
    // The single property that makes the app CSRF-immune. A cookie the browser
    // attaches automatically is the entire CSRF precondition.
    expect(AUTH).not.toMatch(/req\.cookies/);
    expect(AUTH).not.toMatch(/headers(\?\.|\.)cookie/);
    expect(AUTH).not.toMatch(/cookie-parser|cookieParser/);
  });

  it('sources the uid only from the verified token', () => {
    // INV-3, and the other half of CSRF immunity: even a forged request that
    // somehow arrived could not name a victim, because the uid comes from the
    // token's own claims, not from anything the request chose.
    expect(AUTH).toContain('decoded.uid');
    expect(AUTH).not.toMatch(/req\.body\.uid|req\.query\.uid|req\.params\.uid/);
  });
});

describe('no route trusts an ambient credential', () => {
  const server = strip(readFileSync(join(process.cwd(), 'server.ts'), 'utf8'));

  it('the app installs no cookie middleware', () => {
    // If cookie-session or cookie-parser is ever mounted, this fails and asks
    // why — which is the point.
    expect(server).not.toMatch(/cookie-parser|cookie-session|cookieParser/);
    expect(server).not.toMatch(/app\.use\([^)]*cookie/i);
  });

  it('does not reflect an arbitrary Origin back as CORS allow', () => {
    // Reflecting Origin with credentials would undo the Bearer protection.
    expect(server).not.toMatch(/Access-Control-Allow-Origin['"`]?\s*[,:]\s*req/i);
    expect(server).not.toMatch(/Access-Control-Allow-Credentials/i);
  });
});
