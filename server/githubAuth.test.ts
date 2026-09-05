import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The GitHub connection, asserted against its own source — Amendment J.
 *
 * Source-grep assertions, matching server/gmail.test.ts. These check
 * properties a runtime test cannot reach without a live OAuth provider: that
 * identity comes from a nonce rather than a query string, that a token is
 * sealed before it is written, and that no call site uses the write half of
 * the scope it was granted.
 */

/**
 * Comments are stripped before every assertion, matching gmail.test.ts. These
 * are claims about code; prose must neither satisfy nor violate one, and this
 * file's own comments name the very strings it asserts on.
 */
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const SOURCE = strip(readFileSync(join(process.cwd(), 'server', 'githubAuth.ts'), 'utf8'));
const ROUTES_PATH = join(process.cwd(), 'server', 'githubRoutes.ts');

describe('INV-17 — identity never comes from the callback request', () => {
  it('the uid is read from the consumed nonce, never from the query string', () => {
    expect(SOURCE).toContain('consumeState');
    expect(SOURCE).not.toContain('query.uid');
    expect(SOURCE).not.toContain('body.uid');
  });

  it('the state document is deleted when consumed, so a replay finds nothing', () => {
    expect(SOURCE).toContain('stateRef(nonce).delete()');
  });

  it('a consent expires', () => {
    expect(SOURCE).toContain('STATE_TTL_MS');
  });

  it('the nonce is generated with a CSPRNG, not Math.random', () => {
    expect(SOURCE).toContain('randomBytes(32)');
    expect(SOURCE).not.toContain('Math.random');
  });

  it('will not consume a nonce issued for another provider', () => {
    // oauth_states is shared with the Gmail connection. A nonce minted for one
    // provider must not resolve to an identity under the other.
    expect(SOURCE).toContain("provider: 'github'");
    expect(SOURCE).toContain("data.provider !== 'github'");
  });
});

describe('INV-16 — the token never escapes the server', () => {
  it('the access token is sealed before it is written', () => {
    expect(SOURCE).toContain('await seal(');
  });

  it('nothing logs a token or a client secret', () => {
    for (const line of SOURCE.split('\n')) {
      if (!line.includes('console.')) continue;
      expect(line).not.toContain('token');
      expect(line).not.toContain('secret');
    }
  });

  it('token-exchange failures do not propagate the provider error', () => {
    // The request body carries the client secret. Nothing derived from that
    // exchange may reach a caller (INV-8, INV-10).
    expect(SOURCE).toContain("throw new GitHubAuthError('token_exchange_failed')");
  });
});

describe('INV-19 — the credential is used for reads', () => {
  it('the only non-GET calls are the token exchange and the revocation', () => {
    const methods = [...SOURCE.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1]);
    // POST is the OAuth exchange at github.com, which touches no repository.
    // DELETE is the revocation. Nothing else.
    expect(new Set(methods)).toEqual(new Set(['POST', 'DELETE']));
  });

  it('disconnect revokes at GitHub rather than only forgetting locally', () => {
    // A classic OAuth App token does not expire. Deleting our copy while the
    // grant is still live would leave a user believing they had disconnected.
    expect(SOURCE).toContain('/applications/');
    expect(SOURCE).toContain("method: 'DELETE'");
  });
});

describe('the scope is requested once and recorded', () => {
  it('declares the scope as a named constant', () => {
    expect(SOURCE).toContain("export const GITHUB_SCOPE = 'repo'");
  });
});

describe('only the callback is unauthenticated', () => {
  const ROUTES = strip(readFileSync(ROUTES_PATH, 'utf8'));

  it('every route except the callback requires auth', () => {
    const routes = [...ROUTES.matchAll(/githubRouter\.(get|post)\('([^']+)',\s*([a-zA-Z]+)/g)];
    expect(routes.length).toBeGreaterThan(0);
    for (const [, , path, second] of routes) {
      if (path === '/callback') {
        expect(second).not.toBe('requireAuth');
      } else {
        expect(second, path).toBe('requireAuth');
      }
    }
  });

  it('no route returns a token or the connection document', () => {
    expect(ROUTES).not.toContain('accessToken');
    expect(ROUTES).not.toContain('githubToken');
  });

  it('the callback page renders only literal strings', () => {
    // Nothing from the query string reaches the HTML.
    expect(ROUTES).not.toContain('page(req.query');
    expect(ROUTES).not.toContain('${req.query');
  });
});

describe('INV-19 — every GitHub URL is on the allowlist', () => {
  const GITHUB_SOURCE = strip(readFileSync(join(process.cwd(), 'server', 'github.ts'), 'utf8'));

  it('github.ts declares an endpoint allowlist', () => {
    expect(GITHUB_SOURCE).toContain('READ_ENDPOINTS');
    expect(GITHUB_SOURCE).toContain('assertReadEndpoint');
  });

  it('every fetch in github.ts is a GET', () => {
    // github.ts is the file that touches repositories. The one non-GET call
    // in the application is the revocation in githubAuth.ts, which touches
    // none. A repo-scoped token can write; this is what makes "we only read"
    // checkable rather than asserted.
    const methods = [...GITHUB_SOURCE.matchAll(/method:s*.([A-Z]+)./g)].map((m) => m[1]);
    expect(methods).toEqual([]);
  });
});
