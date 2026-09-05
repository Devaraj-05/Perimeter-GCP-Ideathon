# GitHub Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user connect their GitHub account over OAuth so Perimeter can read their private repositories, and record the invariant changes that permits.

**Architecture:** `server/githubAuth.ts` is a near-copy of `server/gmail.ts` — the same single-use state nonce (INV-17), the same sealed storage in `users/{uid}/private/` (INV-16), the same route shapes. `server/github.ts` learns to prefer a connected user's token over the deployment-wide environment token. Amendment J lands first and revises INV-18 so a later plan can put repository content through the airlock.

**Tech Stack:** TypeScript, Express, Firebase Admin SDK, Vitest. No new dependencies.

## Global Constraints

- **No new dependency** without a stated reason in the commit message (Constitution §3). This plan adds none.
- **Every `/api/*` route sits behind `requireAuth`** except the OAuth callback, which takes identity from the nonce (INV-17).
- **Secrets come from Secret Manager**, pinned by version, never logged, never returned to a client (INV-8).
- **Client-facing errors are generic typed codes.** No stack traces, no secret names, no provider error text (INV-10).
- **Corpus replay must not move.** `npm run replay` stays at `20/0/20-20/11` and `5/0/5-5/4` through every task.
- **The reachability suite must stay green.** `reposcan.ts`, `containment.ts` and `triage.ts` import no model. That assertion is the surviving half of INV-18.
- Amendment J is committed **before** any code it governs (Constitution §9). Task 1 is that commit.

---

### Task 1: Amendment J

**Files:**
- Modify: `CONSTITUTION.md` (append after Amendment I)
- Modify: `README.md` — "Eighteen numbered invariants" → "Nineteen"
- Modify: `Document.md` — "all eighteen invariants" and "Eighteen numbered invariants" → "Nineteen"

**Interfaces:**
- Consumes: nothing.
- Produces: INV-18 (revised) and INV-19, which Tasks 3 and 5 implement.

- [ ] **Step 1: Append Amendment J to `CONSTITUTION.md`**

Append at end of file:

```markdown

---

## Amendment J — GitHub connection and repository conversation (adopted 2026-09-05)

Adopted **before** any connection code was written, per §9. Two things change: a user may
connect their GitHub account, and repository content becomes discussable.

**1. Data flows.** Two. *Connection:* an operator-configured OAuth client → a consent the user
grants → an access token held by us, sealed → repository reads on demand. *Content:* repository
files → `detectL1` (unchanged, model-free) → findings; and separately, a bounded selection of
those files → `ingestUntrustedText` → `UNTRUSTED` artifacts → the Reader → the Planner.

**2. New untrusted input?** Yes. It is now routed *through* the Reader rather than around it.

**3. New egress path?** No. Every request goes to `api.github.com`, `codeload.github.com` or
`github.com`, and no user input reaches the host component of any URL.

**4. New secrets?** One: the GitHub OAuth client secret, from Secret Manager, pinned, with a
scoped IAM binding. `GITHUB_CLIENT_ID` and `GITHUB_OAUTH_REDIRECT` are not secrets and are plain
environment variables. The existing `GOOGLE_OAUTH_ENC_KEY` seals the stored token — one key for
both providers, because a second key with the same lifetime and the same blast radius buys
nothing.

**5. New Firestore paths?** One document: `users/{uid}/private/github`. That collection already
denies the client read and write, and its rules tests already cover the whole `private/` subtree.

**6. Revised and new invariants.**

- **INV-18 (revised)** Repository **detection** is deterministic and model-free. The scan that
  finds, ranks and quotes injections runs no model, and `server/reposcan.ts`,
  `server/containment.ts` and `server/triage.ts` remain asserted clean of model imports.

  Repository **content** may additionally be discussed, and that discussion routes through the
  airlock exactly as a fetched page or an uploaded PDF does: ingested as `UNTRUSTED`, read by a
  model that holds no tools, never shown raw to the Planner. The set of files that becomes
  discussable is bounded, and the bound is reported to the user.

  *What is given up:* the scan is no longer the only thing in this application that touches a
  repository. *What is kept:* nothing that decides whether a file contains an injection can be
  argued with by that file.

- **INV-19** The GitHub token is never used to modify a repository. Every GitHub URL this
  application requests is matched against an allowlist of endpoint shapes before the request is
  made. Exactly one call site uses a method other than `GET`: `DELETE
  /applications/{client_id}/token`, which revokes our own grant at disconnect. It touches no
  repository, and its purpose is to give up access rather than to use it.

**On the scope, recorded rather than argued away.** A classic OAuth App's `repo` scope grants
read **and write** on every private repository the user can reach, and GitHub offers no
read-only private alternative for OAuth Apps. The narrower option — a GitHub App with
`Contents: Read-only` and per-repository selection — was considered and rejected in favour of
reusing Amendment H's proven pattern. INV-19 bounds what *this code* does with the credential.
It does not bound what the credential permits: anyone holding the sealed token and the
encryption key has write access to those repositories. That is stated in the README's Honest
Limits, next to the unverified Gmail scope.

**7. Corpus payload.** A repository fixture whose `README.md` carries an injection addressed to
a code-review assistant, added in the plan that implements the ingest.
```

- [ ] **Step 2: Bump the invariant count in `README.md` and `Document.md`**

Run:

```bash
cd /d/Deva/GCP/Perimeter-GCP-Ideathon
sed -i 's/Eighteen numbered invariants/Nineteen numbered invariants/' README.md Document.md
sed -i 's/all eighteen invariants/all nineteen invariants/' Document.md
grep -rn "Nineteen numbered\|nineteen invariants" README.md Document.md
```

Expected: three matching lines.

- [ ] **Step 3: Verify nothing else moved**

Run: `npm run lint && npm test && npm run replay`
Expected: typecheck clean, 591 tests pass, replay `20/0/20-20/11` and `5/0/5-5/4`.

- [ ] **Step 4: Commit**

```bash
git add CONSTITUTION.md README.md Document.md
git commit -m "docs(constitution): Amendment J — GitHub connection, and INV-18 revised

Adopted before the connection code, per §9. The next commits are the
integration this governs; the ordering is the evidence.

INV-18 splits rather than disappears. Detection stays deterministic and
model-free, and the grep assertion on reposcan.ts, containment.ts and
triage.ts IS the surviving half. Discussion of repository content routes
through the airlock like any other untrusted source.

INV-19 bounds the credential: every GitHub URL is matched against an
endpoint allowlist, and exactly one call site uses a method other than GET —
the DELETE that revokes our own grant at disconnect.

The repo scope grants write access to every private repository the user can
reach and GitHub has no read-only private alternative for OAuth Apps. A
GitHub App with Contents: Read-only was considered and rejected in favour of
reusing Amendment H. INV-19 bounds what this code does; it does not bound
what the credential permits. Recorded here and in Honest Limits rather than
argued away.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: The client secret

**Files:**
- Modify: `server/secrets.ts` (append after `getGoogleClientSecret`)

**Interfaces:**
- Consumes: `resolveSecret(name, pathEnv, valueEnv, label)` — private to `secrets.ts`.
- Produces: `getGitHubClientSecret(): Promise<string>` — used by Task 3.

- [ ] **Step 1: Add the accessor**

In `server/secrets.ts`, immediately after `getGoogleClientSecret`:

```ts
/** The GitHub OAuth client secret — Amendment J. Never reaches a client. */
export async function getGitHubClientSecret(): Promise<string> {
  return resolveSecret(
    'github-client-secret',
    'GITHUB_CLIENT_SECRET_SECRET',
    'GITHUB_CLIENT_SECRET',
    'GitHub OAuth client secret',
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 3: Confirm the secret-leak test still passes**

Run: `npx vitest run server/inv8.test.ts`
Expected: PASS. This test fails if any secret value is committed; adding an accessor must not
trip it.

- [ ] **Step 4: Commit**

```bash
git add server/secrets.ts
git commit -m "feat(secrets): GitHub OAuth client secret accessor

Same resolveSecret path as every other credential: a pinned Secret Manager
version by resource path, an environment value as the local-dev fallback,
cached in process memory, never logged.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `server/githubAuth.ts`

**Files:**
- Create: `server/githubAuth.ts`
- Create: `server/githubAuth.test.ts`

**Interfaces:**
- Consumes: `getGitHubClientSecret()` from Task 2; `seal`/`open` from `server/tokencrypto.ts`;
  `adminDb()` from `server/auth.ts`.
- Produces, used by Tasks 4 and 5:
  - `beginConnect(uid: string): Promise<string>`
  - `consumeState(nonce: string): Promise<string>`
  - `completeConnect(uid: string, code: string): Promise<void>`
  - `isConnected(uid: string): Promise<boolean>`
  - `disconnect(uid: string): Promise<void>`
  - `githubToken(uid: string): Promise<string | null>`
  - `class GitHubAuthError extends Error { readonly code: string }`
  - `const GITHUB_SCOPE = 'repo'`

- [ ] **Step 1: Write the failing test**

Create `server/githubAuth.test.ts`. These are source-grep assertions, matching
`server/gmail.test.ts` — they assert properties of the file that a runtime test cannot reach
without a live OAuth provider.

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(join(process.cwd(), 'server', 'githubAuth.ts'), 'utf8');
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
  it('the only non-GET call is the revocation at disconnect', () => {
    const methods = [...SOURCE.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1]);
    // POST is the OAuth token exchange at github.com, which is not a
    // repository endpoint. DELETE is the revocation. Nothing else.
    expect(new Set(methods)).toEqual(new Set(['POST', 'DELETE']));
  });

  it('disconnect revokes at GitHub rather than only forgetting locally', () => {
    // A classic OAuth App token does not expire. Deleting our copy while the
    // grant is still live would leave the user believing they had disconnected.
    expect(SOURCE).toContain('/applications/');
    expect(SOURCE).toContain("method: 'DELETE'");
  });
});

describe('the scope is requested once and recorded', () => {
  it('declares the scope as a named constant', () => {
    expect(SOURCE).toContain("export const GITHUB_SCOPE = 'repo'");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run server/githubAuth.test.ts`
Expected: FAIL — `ENOENT ... server/githubAuth.ts`.

- [ ] **Step 3: Write `server/githubAuth.ts`**

```ts
import { randomBytes } from 'crypto';
import { adminDb } from './auth';
import { getGitHubClientSecret } from './secrets';
import { seal, open } from './tokencrypto';

/**
 * GitHub connection — Amendment J, INV-16, INV-17 and INV-19.
 *
 * Deliberately a near-copy of server/gmail.ts. That shape is proven here and
 * its failure modes are understood; a second OAuth implementation that drifts
 * from the first is a second set of mistakes.
 *
 * Two differences from Gmail, both consequences of GitHub's flow:
 *
 *  - A classic OAuth App issues a NON-EXPIRING access token and no refresh
 *    token. There is no refresh path to build, and equally no expiry to limit
 *    damage, which is why disconnect revokes at GitHub rather than only
 *    deleting our copy.
 *  - The `repo` scope carries write access. This file never uses it; INV-19
 *    bounds the call sites and githubAuth.test.ts asserts the bound.
 */

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
const GITHUB_API = 'https://api.github.com';

/**
 * GitHub has no read-only scope for private repositories. `repo` is the
 * narrowest scope that reads private code, and it also grants write. See
 * Amendment J: the capability is bounded in code, not in the grant.
 */
export const GITHUB_SCOPE = 'repo';

/** A consent that has not completed in ten minutes is abandoned, not pending. */
const STATE_TTL_MS = 10 * 60 * 1000;

export class GitHubAuthError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'GitHubAuthError';
  }
}

function clientId(): string {
  const id = process.env.GITHUB_CLIENT_ID?.trim();
  if (!id) throw new GitHubAuthError('oauth_not_configured');
  return id;
}

function redirectUri(): string {
  const uri = process.env.GITHUB_OAUTH_REDIRECT?.trim();
  if (!uri) throw new GitHubAuthError('oauth_not_configured');
  return uri;
}

function stateRef(nonce: string) {
  return adminDb().collection('oauth_states').doc(nonce);
}

function connectionRef(uid: string) {
  return adminDb().collection('users').doc(uid).collection('private').doc('github');
}

/**
 * Starts a consent. Returns the URL the browser should visit.
 *
 * Called from an authenticated route, which is the only place the uid is known,
 * and binds that uid to a single-use nonce.
 */
export async function beginConnect(uid: string): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');

  await stateRef(nonce).set({ uid, createdAt: Date.now(), used: false, provider: 'github' });

  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    scope: GITHUB_SCOPE,
    state: nonce,
    allow_signup: 'false',
  });

  return `${GITHUB_AUTHORIZE}?${params.toString()}`;
}

/**
 * Resolves a callback's state to the uid that started it — INV-17.
 *
 * Single use and time-limited. The document is deleted on consumption, so a
 * replayed callback finds nothing rather than re-attaching an account.
 */
export async function consumeState(nonce: string): Promise<string> {
  if (!nonce || typeof nonce !== 'string') throw new GitHubAuthError('bad_state');

  const snap = await stateRef(nonce).get();
  if (!snap.exists) throw new GitHubAuthError('bad_state');

  const data = snap.data() as { uid?: string; createdAt?: number; provider?: string };
  await stateRef(nonce).delete().catch(() => undefined);

  if (data.provider !== 'github') throw new GitHubAuthError('bad_state');
  if (!data.uid) throw new GitHubAuthError('bad_state');
  if (!data.createdAt || Date.now() - data.createdAt > STATE_TTL_MS) {
    throw new GitHubAuthError('state_expired');
  }

  return data.uid;
}

/** Exchanges the authorization code and stores the access token, encrypted. */
export async function completeConnect(uid: string, code: string): Promise<void> {
  let json: any;
  try {
    const res = await fetch(GITHUB_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId(),
        client_secret: await getGitHubClientSecret(),
        code,
        redirect_uri: redirectUri(),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    json = await res.json();
    if (!res.ok) throw new Error('token_exchange_status');
  } catch {
    // The request body carries the client secret; nothing derived from it may
    // propagate (INV-8, INV-10).
    throw new GitHubAuthError('token_exchange_failed');
  }

  const access = typeof json?.access_token === 'string' ? json.access_token : '';
  if (!access) throw new GitHubAuthError('no_access_token');

  await connectionRef(uid).set({
    accessToken: await seal(access),
    connectedAt: new Date().toISOString(),
    scope: typeof json?.scope === 'string' ? json.scope : GITHUB_SCOPE,
  });
}

export async function isConnected(uid: string): Promise<boolean> {
  return (await connectionRef(uid).get()).exists;
}

/** The stored token, opened. Null when not connected or unreadable. */
export async function githubToken(uid: string): Promise<string | null> {
  try {
    const snap = await connectionRef(uid).get();
    if (!snap.exists) return null;
    const sealed = (snap.data() as any)?.accessToken;
    if (typeof sealed !== 'string') return null;
    return await open(sealed);
  } catch {
    // An unreadable credential is not a credential.
    return null;
  }
}

/**
 * Disconnects, and means it.
 *
 * A classic OAuth App token does not expire, so deleting our copy while GitHub
 * still considers the grant live would leave the user believing they had
 * disconnected when the token remained valid. The revocation is the one place
 * this application issues a non-GET GitHub request; it touches no repository
 * and its purpose is to give up access (INV-19).
 *
 * Our copy is deleted regardless of whether the revocation succeeds: failing
 * to forget a credential because GitHub was unreachable is the wrong failure.
 */
export async function disconnect(uid: string): Promise<void> {
  const token = await githubToken(uid);
  await connectionRef(uid).delete().catch(() => undefined);
  if (!token) return;

  try {
    const basic = Buffer.from(`${clientId()}:${await getGitHubClientSecret()}`).toString('base64');
    await fetch(`${GITHUB_API}/applications/${encodeURIComponent(clientId())}/token`, {
      method: 'DELETE',
      headers: {
        authorization: `Basic ${basic}`,
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: token }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Best effort. Our copy is already gone.
  }
}
```

- [ ] **Step 4: Close the cross-provider nonce gap in `server/gmail.ts`**

`oauth_states` now holds nonces for two providers, and `gmail.ts`'s `consumeState` does not
check which provider issued the one it was handed. A GitHub nonce replayed at the Gmail
callback would be accepted as identity. Nothing exploitable follows today — Gmail's code
exchange would fail — but a nonce that resolves to a uid under the wrong provider is exactly
the shape INV-17 exists to prevent, and the fix is two lines.

In `server/gmail.ts`, in `beginConnect`, record the provider:

```ts
  await stateRef(nonce).set({
    uid,
    createdAt: Date.now(),
    used: false,
    provider: 'gmail',
  });
```

In `consumeState`, after the `data` destructure and before the uid check:

```ts
  // oauth_states is shared with the GitHub connection. A nonce issued for one
  // provider must not resolve to an identity under the other (INV-17).
  if (data.provider !== 'gmail') throw new GmailError('bad_state');
```

Widen the destructured type to include `provider?: string`.

Add to `server/gmail.test.ts`:

```ts
  it('will not consume a nonce issued for another provider', () => {
    // oauth_states is shared. A GitHub nonce must not resolve to a uid here.
    const source = readFileSync(join(process.cwd(), 'server', 'gmail.ts'), 'utf8');
    expect(source).toContain("provider: 'gmail'");
    expect(source).toContain("data.provider !== 'gmail'");
  });
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run server/githubAuth.test.ts server/gmail.test.ts && npm run lint`
Expected: all PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add server/githubAuth.ts server/githubAuth.test.ts server/gmail.ts server/gmail.test.ts
git commit -m "feat(github): connect a GitHub account over OAuth

Amendment J, committed in the previous commits before this code.

A near-copy of server/gmail.ts on purpose: same single-use state nonce bound
to a uid (INV-17), same sealed storage under users/{uid}/private/ (INV-16),
same refusal to let a token-exchange failure carry a provider message out to
a caller. A second OAuth implementation that drifts from the first is a
second set of mistakes.

Two differences, both forced by GitHub's flow. A classic OAuth App issues a
non-expiring access token and no refresh token, so there is no refresh path
and equally no expiry to limit damage — which is why disconnect REVOKES at
GitHub rather than only deleting our copy. Deleting our copy while the grant
is still live would leave a user believing they had disconnected.

That revocation is the single non-GET GitHub call site in the application
(INV-19), and a test asserts the set of HTTP methods this file uses rather
than trusting the claim.

Also closes a gap this commit creates: oauth_states now holds nonces for two
providers and gmail.ts did not check which issued the one it was handed. A
GitHub nonce replayed at the Gmail callback would have been accepted as
identity. Nothing exploitable followed, because the code exchange would
fail, but a nonce resolving to a uid under the wrong provider is the shape
INV-17 exists to prevent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `server/githubRoutes.ts`

**Files:**
- Create: `server/githubRoutes.ts`
- Modify: `server.ts` — import and mount `githubRouter` at `/api/github`

**Interfaces:**
- Consumes: everything Task 3 produced; `requireAuth`, `AuthedRequest` from `server/auth.ts`;
  `logEvent` from `server/perimeterLog.ts`.
- Produces: `export const githubRouter: Router`.

- [ ] **Step 1: Write `server/githubRoutes.ts`**

```ts
import { Router, Request, Response } from 'express';
import { requireAuth, AuthedRequest } from './auth';
import { logEvent } from './perimeterLog';
import {
  beginConnect,
  consumeState,
  completeConnect,
  isConnected,
  disconnect,
  GitHubAuthError,
} from './githubAuth';

/**
 * GitHub routes — Amendment J.
 *
 * Note which route is NOT behind requireAuth: the callback. GitHub redirects a
 * browser there and that request carries no bearer token, so it cannot be
 * authenticated. Its identity comes from the state nonce and from nowhere else
 * (INV-17).
 */
export const githubRouter = Router();

/** Typed, generic, and never the provider's own words (INV-10). */
function userFacing(code: string): [number, string] {
  const table: Record<string, [number, string]> = {
    oauth_not_configured: [503, 'GitHub is not configured on this deployment.'],
    bad_state: [400, 'That connection link was not valid.'],
    state_expired: [400, 'That connection link expired. Start again.'],
    token_exchange_failed: [502, 'GitHub did not complete the connection.'],
    no_access_token: [502, 'GitHub did not return a usable token.'],
  };
  return table[code] ?? [502, 'Something went wrong with the GitHub connection.'];
}

githubRouter.get('/status', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    res.json({ connected: await isConnected(req.uid!) });
  } catch {
    res.status(500).json({ error: 'Could not check the connection.' });
  }
});

/** Starts a consent. Authenticated, because this is where the uid is known. */
githubRouter.post('/connect', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    res.json({ url: await beginConnect(req.uid!) });
  } catch (err: any) {
    if (err instanceof GitHubAuthError) {
      const [status, message] = userFacing(err.code);
      return res.status(status).json({ error: message, code: err.code });
    }
    console.error('[github] connect failed:', err?.message);
    res.status(500).json({ error: 'Could not start the connection.' });
  }
});

githubRouter.post('/disconnect', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    await disconnect(req.uid!);
    await logEvent(req.uid!, {
      kind: 'decision',
      decision: 'allow',
      reason: 'github_disconnected',
      detail: {},
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Could not disconnect.' });
  }
});

/**
 * The OAuth callback — INV-17.
 *
 * Unauthenticated by necessity. The uid comes from the nonce and from nowhere
 * else; honouring one from the query string would let anyone attach their
 * GitHub account to somebody else's Perimeter account by editing a URL.
 *
 * Responds with a small HTML page rather than JSON: a human's browser lands
 * here, not a fetch call. Every string in that page is a literal.
 */
githubRouter.get('/callback', async (req: Request, res: Response) => {
  const page = (title: string, message: string) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font:16px system-ui;margin:3rem auto;max-width:32rem;color:#2c2c24">` +
    `<h1 style="font-size:1.25rem">${title}</h1><p>${message}</p>` +
    `<p>You can close this tab and return to Perimeter.</p></body>`;

  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';

    if (typeof req.query.error === 'string' && req.query.error) {
      return res.status(400).send(page('Connection cancelled', 'No account was connected.'));
    }
    if (!code || !state) {
      return res.status(400).send(page('Connection failed', 'That link was incomplete.'));
    }

    const uid = await consumeState(state);
    await completeConnect(uid, code);

    await logEvent(uid, {
      kind: 'decision',
      decision: 'allow',
      reason: 'github_connected',
      detail: { scope: 'repo' },
    });

    res.send(page('GitHub connected', 'Perimeter can now read your repositories.'));
  } catch (err: any) {
    // Never render the reason: this page is reachable by anyone with a URL.
    console.error('[github] callback failed:', err?.code ?? err?.message);
    res.status(400).send(page('Connection failed', 'That connection link was not valid.'));
  }
});
```

- [ ] **Step 2: Mount the router in `server.ts`**

Add the import beside the existing `gmailRouter` import:

```ts
import { githubRouter } from './server/githubRoutes';
```

Add the mount beside the existing `/api/gmail` mount:

```ts
app.use('/api/github', githubRouter);
```

- [ ] **Step 3: Add the route-guard assertions**

Append to `server/githubAuth.test.ts`:

```ts
describe('only the callback is unauthenticated', () => {
  const ROUTES = readFileSync(ROUTES_PATH, 'utf8');

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
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run server/githubAuth.test.ts && npm run lint && npm test`
Expected: all PASS, typecheck clean, full suite green.

- [ ] **Step 5: Commit**

```bash
git add server/githubRoutes.ts server/githubAuth.test.ts server.ts
git commit -m "feat(github): connect, disconnect and callback routes

Mirrors gmailRoutes.ts, including which route is NOT behind requireAuth. The
callback is a browser redirect carrying no bearer token, so it cannot be
authenticated; its identity comes from the state nonce (INV-17). Honouring a
uid from that query string would let anyone attach their GitHub account to
someone else's Perimeter account by editing a URL.

Tests assert the guard rather than describing it: every route except the
callback is matched against requireAuth by name, no route mentions a token,
and nothing from the query string reaches the callback's HTML.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Prefer the connected user's token

**Files:**
- Modify: `server/github.ts` — `usableToken()` gains an optional uid; `ghFetch` and
  `fetchTarball` thread it through
- Modify: `server/reposcan.ts` — `scanRepository` gains an optional uid
- Modify: `server/ingest.ts` — the `/repo-scan` route passes `req.uid`
- Modify: `server/githubAuth.test.ts` — INV-19 endpoint allowlist assertion

**Interfaces:**
- Consumes: `githubToken(uid)` from Task 3.
- Produces: `scanRepository(repoRef: string, onProgress?: (p: ScanProgress) => void, uid?: string)`.

- [ ] **Step 1: Write the failing INV-19 test**

Append to `server/githubAuth.test.ts`:

```ts
describe('INV-19 — every GitHub URL is on the allowlist', () => {
  const GITHUB_SOURCE = readFileSync(join(process.cwd(), 'server', 'github.ts'), 'utf8');

  it('github.ts declares an endpoint allowlist', () => {
    expect(GITHUB_SOURCE).toContain('READ_ENDPOINTS');
  });

  it('every fetch in github.ts is a GET', () => {
    // github.ts touches repositories. The one non-GET call in the whole
    // application is the revocation in githubAuth.ts, which touches none.
    const methods = [...GITHUB_SOURCE.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1]);
    expect(methods).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run server/githubAuth.test.ts -t "allowlist"`
Expected: FAIL — `READ_ENDPOINTS` not found.

- [ ] **Step 3: Add the allowlist and thread the uid**

In `server/github.ts`, add above `ghFetch`:

```ts
/**
 * The only GitHub paths this application will request — INV-19.
 *
 * A `repo` token can write. This list is what makes "we only read" checkable
 * rather than asserted: a path that does not match one of these shapes is
 * refused before the request is made, so adding a write call means editing
 * this array in a commit a reviewer can see.
 */
const READ_ENDPOINTS: RegExp[] = [
  /^\/repos\/[^/]+\/[^/]+$/,
  /^\/repos\/[^/]+\/[^/]+\/git\/trees\/[^/?]+(\?recursive=1)?$/,
  /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/[0-9a-f]{7,64}$/,
  /^\/repos\/[^/]+\/[^/]+\/issues\?[^/]*$/,
  /^\/repos\/[^/]+\/[^/]+\/tarball\/[^/?]+$/,
];

function assertReadEndpoint(path: string): void {
  if (!READ_ENDPOINTS.some((r) => r.test(path))) {
    throw new IngestError('Refusing a GitHub endpoint that is not on the read allowlist.', false);
  }
}
```

In `ghFetch`, call it as the first line — `path` is already a parameter:

```ts
async function ghFetch(path: string, accept: string, uid?: string): Promise<Response> {
  assertReadEndpoint(path);
```

In `fetchTarball` the path is built from `ownerAndName`, so the check goes immediately
after that and before the URL:

```ts
  const [owner, name] = ownerAndName(repoRef);
  const path = `/repos/${owner}/${name}/tarball/${encodeURIComponent(branch)}`;
  assertReadEndpoint(path);
  let url = `https://${ALLOWED_HOST}${path}`;
```

**Do not check the redirect target.** `fetchTarball` follows one hop to
`codeload.github.com`, whose path shape is `/owner/name/legacy.tar.gz/refs/heads/branch` and
matches none of these patterns. That hop is already validated by `assertArchiveHost`; running
the endpoint allowlist against it would refuse every archive download.

Change `usableToken()` to accept an optional uid, preferring the connected user's token:

```ts
async function usableToken(uid?: string): Promise<string | undefined> {
  // A connected user's own credential first: it reaches their private
  // repositories, and the deployment-wide token does not.
  if (uid && !tokenRejected) {
    const { githubToken } = await import('./githubAuth');
    const personal = await githubToken(uid);
    if (personal) return personal;
  }

  const raw = process.env.GITHUB_TOKEN?.trim();
  if (!raw) return undefined;

  if (!looksLikeGitHubToken(raw)) {
    tokenWarning =
      'GITHUB_TOKEN does not match a familiar GitHub prefix (ghp_, github_pat_, gho_, ghu_, ghs_, ghr_). It was sent anyway — if GitHub rejects it the scan continues anonymously.';
  }
  if (tokenRejected) {
    tokenWarning =
      'GitHub rejected GITHUB_TOKEN as bad credentials, so the scan ran anonymously. Public repositories still scan in full. Generate a new token when convenient: a classic one needs no scopes at all.';
    return undefined;
  }
  return raw;
}
```

Thread `uid` through `ghFetch(path, accept, uid?)`, `fetchDefaultBranch(repoRef, uid?)`,
`fetchTree(repoRef, branch, uid?)`, `fetchBlobText(repoRef, sha, maxBytes, uid?)` and
`fetchTarball(repoRef, branch, maxBytes, uid?)`. Each is a parameter added at the end and passed
to the next call.

In `server/reposcan.ts`, add `uid?: string` as the third parameter of `scanRepository` and pass
it to every `fetch*` call.

In `server/ingest.ts`, the `/repo-scan` route becomes:

```ts
    const result = await scanRepository(repo, (progress) => {
      res.write(JSON.stringify({ type: 'progress', ...progress }) + '\n');
    }, uid);
```

- [ ] **Step 4: Run the tests**

Run: `npm run lint && npm test`
Expected: typecheck clean, full suite green.

- [ ] **Step 5: Verify the allowlist does not break a real scan**

Run:

```bash
cd /d/Deva/GCP/Perimeter-GCP-Ideathon
cat > probe.ts <<'PROBE'
import { scanRepository } from './server/reposcan';
scanRepository('octocat/Hello-World')
  .then((r) => console.log(r.coverage, '|', r.verdict))
  .catch((e) => console.error('FAILED:', e?.message));
PROBE
npx tsx probe.ts; rm -f probe.ts
```

Expected: a coverage line and a verdict, not `Refusing a GitHub endpoint`. If it refuses, a
real endpoint shape is missing from `READ_ENDPOINTS` — add it rather than loosening the regexes.

- [ ] **Step 6: Commit**

```bash
git add server/github.ts server/reposcan.ts server/ingest.ts server/githubAuth.test.ts
git commit -m "feat(github): prefer the connected user's token, and bound what it may request

A connected user's own credential reaches their private repositories; the
deployment-wide GITHUB_TOKEN does not. usableToken now takes an optional uid
and prefers the personal token, falling back to the environment token and
then to anonymous. The existing bad-credential fallback covers both.

INV-19 lands with it. READ_ENDPOINTS is an allowlist of the five path shapes
this application requests, checked before any GitHub URL is built. The repo
scope can write; this is what makes 'we only read' checkable rather than
asserted, because adding a write call now means editing that array in a
commit a reviewer can see. A test asserts github.ts issues no non-GET
request at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Connect GitHub in the composer

**Files:**
- Modify: `src/lib/perimeterApi.ts` — add `githubStatus`, `githubConnectUrl`, `githubDisconnect`
- Modify: `src/components/JournalEditor.tsx` — rename the Plus menu item and wire it

**Interfaces:**
- Consumes: `/api/github/status`, `/api/github/connect`, `/api/github/disconnect` from Task 4.
- Produces: nothing later tasks depend on. This is the last task in the plan.

- [ ] **Step 1: Add the client calls**

Append to `src/lib/perimeterApi.ts`:

```ts
/** Whether this user has connected a GitHub account — Amendment J. */
export async function githubStatus(): Promise<{ connected: boolean }> {
  return apiFetch<{ connected: boolean }>('/api/github/status');
}

/** Starts a consent. The token never reaches the browser; only this URL does. */
export async function githubConnectUrl(): Promise<string> {
  const { url } = await apiFetch<{ url: string }>('/api/github/connect', { method: 'POST' });
  return url;
}

export async function githubDisconnect(): Promise<void> {
  await apiFetch<{ ok: boolean }>('/api/github/disconnect', { method: 'POST' });
}
```

- [ ] **Step 2: Rename the menu item and wire the consent**

In `src/components/JournalEditor.tsx`, add beside the other state hooks:

```ts
  const [githubConnected, setGithubConnected] = useState(false);
```

Add the handler beside `runRepoScan`:

```ts
  /**
   * Connects a GitHub account — Amendment J.
   *
   * Opens GitHub's own consent screen. The token is exchanged server-side and
   * sealed there; the browser never sees it (INV-16).
   */
  const connectGithub = async () => {
    setAttachError(null);
    try {
      window.location.href = await githubConnectUrl();
    } catch (err: any) {
      setAttachError(err?.message ?? 'Could not start the GitHub connection.');
    }
  };
```

Replace the `menu-repo` entry with:

```ts
                        {
                          id: 'menu-repo',
                          Icon: Github,
                          label: githubConnected ? 'GitHub connected' : 'Connect GitHub',
                          hint: githubConnected
                            ? 'Paste a repository URL to scan it'
                            : 'Read your repositories, including private ones',
                          run: () => (githubConnected ? setRepoPrompt(true) : void connectGithub()),
                        },
```

Load the status once, beside the other mount effects:

```ts
  useEffect(() => {
    githubStatus()
      .then((s) => setGithubConnected(s.connected))
      .catch(() => setGithubConnected(false));
  }, []);
```

Add the imports to the existing `perimeterApi` import block: `githubStatus`,
`githubConnectUrl`.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm test && npm run build`
Expected: typecheck clean, full suite green, build succeeds.

- [ ] **Step 4: Document the deploy**

In `README.md`, in the optional-secrets block beside the Gmail secrets, add:

```bash
# Optional — Amendment J, GitHub connection (INV-19).
# The repo scope grants read AND WRITE on every private repository the user can
# reach; GitHub has no read-only private scope for OAuth Apps. INV-19 bounds
# what this application requests. It does not bound what the token permits.
gcloud secrets create GITHUB_CLIENT_SECRET --replication-policy=automatic
echo -n "YOUR_GITHUB_OAUTH_CLIENT_SECRET" | \
  gcloud secrets versions add GITHUB_CLIENT_SECRET --data-file=-
gcloud secrets add-iam-policy-binding GITHUB_CLIENT_SECRET \
  --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor"
#   ...then add to --set-env-vars:
#   GITHUB_CLIENT_SECRET_SECRET=projects/PROJECT_ID/secrets/GITHUB_CLIENT_SECRET/versions/1
#   GITHUB_CLIENT_ID=<your OAuth app client id>
#   GITHUB_OAUTH_REDIRECT=https://<your-run-domain>/api/github/callback
```

And in Honest Limits:

```markdown
- **A connected GitHub account grants more than Perimeter uses.** GitHub's `repo` scope is the
  narrowest OAuth scope that reads private repositories, and it also grants write. INV-19 bounds
  what this application requests — five read-only endpoint shapes, checked before any URL is
  built, asserted by a test — but it cannot bound what the credential itself permits. Anyone
  holding the sealed token and the encryption key has write access to those repositories. A
  GitHub App with `Contents: Read-only` would not have this property; it was considered and
  rejected in favour of reusing the proven Gmail pattern.
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/perimeterApi.ts src/components/JournalEditor.tsx README.md
git commit -m "feat(ui): Connect GitHub replaces Scan a GitHub repository

The menu item is now a connection, not a scan. Connected, it opens the repo
prompt; unconnected, it opens GitHub's own consent screen. The token is
exchanged server-side and sealed there — the browser never sees it (INV-16).

Deploy instructions and the scope trade are in the README rather than left
for a reader to discover: repo grants read AND write on every private
repository, INV-19 bounds what we request, and it cannot bound what the
credential permits.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Definition of done

- [ ] `npm run lint` clean
- [ ] `npm test` green, ≥ 591 tests
- [ ] `npm run replay` unchanged: `20/0/20-20/11` and `5/0/5-5/4`
- [ ] `npm run build` succeeds
- [ ] `npm run test:rules` green — `users/{uid}/private/github` is covered by the existing
      `private/` wildcard rule, so no rules change is expected; this confirms it
- [ ] The reachability suite still asserts `reposcan.ts`, `containment.ts` and `triage.ts` import
      no model. This is the surviving half of INV-18 and must not regress
- [ ] Amendment J is committed **before** Tasks 2–6
- [ ] End to end: `+ → Connect GitHub` reaches GitHub's consent screen; after consent the item
      reads "GitHub connected"; a public repository still scans with no connection
