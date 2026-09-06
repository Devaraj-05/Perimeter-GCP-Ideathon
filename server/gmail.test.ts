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

  it('will not consume a nonce issued for another provider', () => {
    // oauth_states is shared with the GitHub connection (Amendment J).
    // A GitHub nonce must not resolve to a uid here.
    expect(GMAIL).toContain("provider: 'gmail'");
    expect(GMAIL).toContain("data.provider !== 'gmail'");
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

describe('INV-26 — a mailbox search term comes only from the user (Amendment R.3)', () => {
  it('the search term reaches Gmail as a query parameter, never as text', () => {
    // The whole safety argument: `q` selects documents. It is URL-encoded into
    // the request and is never concatenated into a prompt or a path, so the
    // worst a strange term can do is select different mail belonging to the
    // same user who typed it.
    const fn = GMAIL.slice(GMAIL.indexOf('export async function fetchRecent'));
    expect(fn).toContain('new URLSearchParams');
    expect(fn).toMatch(/params\.set\('q',\s*q\)/);
  });

  it('a term is stripped of control characters and capped', () => {
    // Defence in depth on top of the caller-side rule. A newline in a query
    // string is the shape of a request-splitting attempt; it never reaches the
    // wire.
    const fn = GMAIL.slice(GMAIL.indexOf('export async function fetchRecent'));
    expect(fn).toMatch(/replace\(\/\[/);
    expect(fn).toContain('slice(0, 200)');
  });

  it('the route takes the term from the request body and nothing else', () => {
    // The body is the user's own composer text, forwarded by their own client.
    // There is deliberately no path that reads a search term out of an
    // artifact, a turn or a tool result — that would be an attacker choosing
    // which of the user's emails this server reads.
    const h = ROUTES.slice(ROUTES.indexOf("gmailRouter.post('/ingest'"));
    expect(h).toMatch(/data\.query/);
    expect(h).toContain('fetchRecent(uid, max, query)');
    // `query` is bound exactly once, and its only source is the request body.
    const bindings = h.match(/(?:const|let|var)\s+query\s*=/g) ?? [];
    expect(bindings).toHaveLength(1);
    expect(h).toMatch(/const query = typeof data\.query === 'string'/);
  });

  it('every message still enters through the shared untrusted ingest', () => {
    // The selector changed. The airlock did not.
    const h = ROUTES.slice(ROUTES.indexOf("gmailRouter.post('/ingest'"));
    expect(h).toContain('ingestUntrustedText(');
  });
});

describe('Amendment R.4 — the same screening, less waiting', () => {
  it('messages are fetched concurrently and bounded', () => {
    const fn = GMAIL.slice(GMAIL.indexOf('export async function fetchRecent'));
    expect(fn).toContain('mapPool(');
    expect(fn).toContain('GMAIL_FETCH_CONCURRENCY');
    // The defect: a serial for-loop of 15s round trips on the critical path.
    expect(fn).not.toMatch(/for\s*\(const ref of/);
  });

  it('messages are screened concurrently and bounded', () => {
    const h = ROUTES.slice(ROUTES.indexOf("gmailRouter.post('/ingest'"));
    expect(h).toContain('mapPool(');
    expect(h).toContain('GMAIL_INGEST_CONCURRENCY');
    expect(h).not.toMatch(/for\s*\(const m of messages\)/);
  });

  it('concurrency is capped, never unbounded', () => {
    // Promise.all over a whole mailbox would convert a slow turn into a
    // rate-limited one, which is a worse failure than the one being fixed.
    const h = ROUTES.slice(ROUTES.indexOf("gmailRouter.post('/ingest'"));
    expect(h).not.toContain('Promise.all(messages');
    expect(ROUTES).toMatch(/GMAIL_INGEST_CONCURRENCY = Number\(/);
  });

  it('both detectors still run on every document', () => {
    // The point of the amendment is that this work is unchanged - it is only
    // no longer serialised. If either screen were skipped or sampled, the
    // latency win would have been bought with the product's actual thesis.
    const INGEST = strip(readFileSync(join(process.cwd(), 'server', 'ingest.ts'), 'utf8'));
    const fn = INGEST.slice(INGEST.indexOf('export async function ingestUntrustedText'));
    expect(fn).toContain('detectL1(');
    expect(fn).toContain('classifyL2(');
    expect(fn).toContain('fuseVerdict(');
  });

  it('the classifier, the segment write and the embedding no longer wait on each other', () => {
    const INGEST = strip(readFileSync(join(process.cwd(), 'server', 'ingest.ts'), 'utf8'));
    const fn = INGEST.slice(INGEST.indexOf('export async function ingestUntrustedText'));
    expect(fn).toMatch(/await Promise\.all\(\[/);
    // None of the three reads another's result, so serialising them bought
    // nothing and cost two round trips per document.
    expect(fn).not.toMatch(/const l2 = await classifyL2/);
    expect(fn).not.toMatch(/const embedding = await embedText/);
  });
});
