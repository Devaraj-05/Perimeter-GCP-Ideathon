import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * INV-16 and INV-17 — Amendment H.
 *
 * The OAuth callback is the one route in this application that cannot be
 * authenticated: Google redirects a browser to it, and that request carries no
 * bearer token. Everything about its safety rests on identity coming from a
 * server-issued single-use nonce rather than from anything in the request.
 *
 * The consequence of getting it wrong is specific and severe: anyone could
 * attach their own inbox to someone else's account by editing a URL, and the
 * victim's assistant would then be reading the attacker's chosen mail.
 *
 * These are source-level assertions because the property is structural — it is
 * about which inputs the code is willing to derive identity from. Comments are
 * stripped so prose neither satisfies nor violates a claim about code.
 */
const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const GMAIL = strip(readFileSync(join(process.cwd(), 'server', 'gmail.ts'), 'utf8'));
const ROUTES = strip(readFileSync(join(process.cwd(), 'server', 'gmailRoutes.ts'), 'utf8'));

describe('INV-17 — identity never comes from the callback request', () => {
  it('the callback derives its uid only by consuming the state nonce', () => {
    const cb = ROUTES.slice(ROUTES.indexOf("gmailRouter.get('/callback'"));
    expect(cb).toContain('consumeState(');
    // The failure this prevents: reading a uid straight off the URL.
    expect(cb).not.toMatch(/req\.query\.uid/);
    expect(cb).not.toMatch(/req\.body\.uid/);
    expect(cb).not.toMatch(/query\.userId/);
  });

  it('the state document is deleted when consumed, so a replay finds nothing', () => {
    const fn = GMAIL.slice(GMAIL.indexOf('export async function consumeState'));
    expect(fn).toMatch(/\.delete\(\)/);
  });

  it('a consent expires', () => {
    expect(GMAIL).toContain('STATE_TTL_MS');
    expect(GMAIL).toMatch(/createdAt\s*>\s*STATE_TTL_MS/);
  });

  it('the nonce is generated with a CSPRNG, not Math.random', () => {
    expect(GMAIL).toMatch(/randomBytes\(32\)/);
    expect(GMAIL).not.toContain('Math.random');
  });

  it('only the callback is unauthenticated; every other route requires auth', () => {
    const routes = ROUTES.match(/gmailRouter\.(get|post)\((.|\n)*?\)/g) ?? [];
    const unauthenticated = routes.filter((r) => !r.includes('requireAuth'));
    expect(unauthenticated).toHaveLength(1);
    expect(unauthenticated[0]).toContain('/callback');
  });
});

describe('INV-16 — the token never escapes the server', () => {
  it('the refresh token is sealed before it is written', () => {
    const fn = GMAIL.slice(GMAIL.indexOf('export async function completeConnect'));
    expect(fn).toMatch(/refreshToken:\s*await seal\(/);
    // The failure this prevents: writing the raw token.
    expect(fn).not.toMatch(/refreshToken:\s*refresh\b/);
  });

  it('no route ever returns a token or the connection document', () => {
    expect(ROUTES).not.toMatch(/refreshToken/);
    expect(ROUTES).not.toMatch(/access_token/);
    // /status answers a boolean, not the record.
    const status = ROUTES.slice(ROUTES.indexOf("gmailRouter.get('/status'"));
    expect(status).toContain('connected:');
  });

  it('nothing logs a token or a client secret', () => {
    const logs = GMAIL.match(/console\.[a-z]+\([^)]*\)/g) ?? [];
    for (const line of logs) {
      expect(line).not.toMatch(/refresh|token|secret|client_secret/i);
    }
  });

  it('token-exchange failures do not propagate the provider error', () => {
    // The request body carries the client secret; an error derived from it is
    // a secret disclosure.
    const fn = GMAIL.slice(GMAIL.indexOf('export async function completeConnect'));
    expect(fn).toMatch(/catch\s*\{/);
    expect(fn).toContain("GmailError('token_exchange_failed')");
  });
});

describe('the mailbox is read-only and its content is untrusted', () => {
  it('requests only the read-only scope', () => {
    expect(GMAIL).toContain('gmail.readonly');
    expect(GMAIL).not.toMatch(/gmail\.(send|modify|compose)/);
  });

  it('asks for a durable token explicitly', () => {
    // Without offline+consent Google omits the refresh token on repeat
    // consents and the connection silently lasts one hour.
    expect(GMAIL).toContain("access_type: 'offline'");
    expect(GMAIL).toContain("prompt: 'consent'");
  });

  it('message content goes through the shared untrusted ingest path', () => {
    const ing = ROUTES.slice(ROUTES.indexOf("gmailRouter.post('/ingest'"));
    expect(ing).toContain('ingestUntrustedText(');
    // Subject and sender are attacker-chosen, so they are part of the body.
    expect(ing).toMatch(/From: \$\{m\.from\}/);
    expect(ing).toMatch(/Subject: \$\{m\.subject\}/);
  });

  it('the ingest log records counts, never subjects senders or bodies', () => {
    const ing = ROUTES.slice(ROUTES.indexOf("gmailRouter.post('/ingest'"));
    const logCall = ing.slice(ing.indexOf('logEvent('));
    expect(logCall).toContain('count:');
    expect(logCall).not.toMatch(/subject|from:|body/);
  });

  it('caps how many messages a single call can pull', () => {
    expect(ROUTES).toMatch(/Math\.min\(Math\.max\(1, Number\(data\.max\)\), 10\)/);
  });
});
