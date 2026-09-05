import { randomBytes } from 'crypto';
import { adminDb } from './auth';
import { getGitHubClientSecret, getOAuthEncryptionKey } from './secrets';
import { seal, open } from './tokencrypto';

/**
 * GitHub connection — Amendment J, INV-16, INV-17 and INV-19.
 *
 * Deliberately a near-copy of server/gmail.ts. That shape is proven here and
 * its failure modes are understood; a second OAuth implementation that drifts
 * from the first is a second set of mistakes.
 *
 * Two differences, both consequences of GitHub's flow:
 *
 *  - A classic OAuth App issues a NON-EXPIRING access token and no refresh
 *    token. There is no refresh path to build, and equally no expiry to limit
 *    damage — which is why disconnect revokes at GitHub rather than only
 *    deleting our copy.
 *  - The `repo` scope carries write access. This file never uses it; INV-19
 *    bounds the call sites and githubAuth.test.ts asserts the bound rather
 *    than trusting this comment.
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

/**
 * Throws unless every value this connection needs is present.
 *
 * clientId() and redirectUri() throw on their own; the encryption key and the
 * client secret are resolved lazily elsewhere and would otherwise go unnoticed
 * until the callback.
 */
async function assertConfigured(): Promise<void> {
  clientId();
  redirectUri();
  try {
    await getOAuthEncryptionKey();
  } catch {
    throw new GitHubAuthError('encryption_key_missing');
  }
  try {
    await getGitHubClientSecret();
  } catch {
    throw new GitHubAuthError('client_secret_missing');
  }
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
  // Everything this connection needs, checked BEFORE the user is sent to
  // GitHub. The encryption key is only used at the end, when the token comes
  // back to be sealed — so a missing one used to fail after the round trip and
  // surface as "that connection link was not valid", sending the operator to
  // look at the state nonce instead of at a key that was never configured.
  //
  // Failing here costs the user a click. Failing there costs them a consent
  // screen, a redirect, and a wrong diagnosis.
  await assertConfigured();

  const nonce = randomBytes(32).toString('base64url');

  await stateRef(nonce).set({
    uid,
    createdAt: Date.now(),
    used: false,
    // oauth_states is shared with the Gmail connection. Recording which
    // provider minted a nonce is what stops one resolving to an identity
    // under the other.
    provider: 'github',
  });

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

  const data = snap.data() as {
    uid?: string;
    createdAt?: number;
    used?: boolean;
    provider?: string;
  };
  await stateRef(nonce).delete().catch(() => undefined);

  if (data.provider !== 'github') throw new GitHubAuthError('bad_state');
  if (data.used === true) throw new GitHubAuthError('bad_state');
  if (!data.uid) throw new GitHubAuthError('bad_state');
  if (!data.createdAt || Date.now() - data.createdAt > STATE_TTL_MS) {
    throw new GitHubAuthError('state_expired');
  }

  return data.uid;
}

/** Exchanges the authorization code and stores the access token, encrypted. */
export async function completeConnect(uid: string, code: string): Promise<void> {
  // Resolved OUTSIDE the try, deliberately.
  //
  // These three used to sit inside it, so a Secret Manager failure — a missing
  // secret, a missing IAM binding — was caught and reported as
  // token_exchange_failed. That sends the operator to look at GitHub for a
  // request that never reached GitHub. A configuration failure and a provider
  // rejection need different actions, so they get different codes.
  const id = clientId();
  const redirect = redirectUri();
  let secret: string;
  try {
    secret = await getGitHubClientSecret();
  } catch {
    throw new GitHubAuthError('client_secret_missing');
  }

  let json: any;
  let status = 0;
  try {
    const res = await fetch(GITHUB_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        client_id: id,
        client_secret: secret,
        code,
        redirect_uri: redirect,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    json = await res.json();
    if (!res.ok) throw new Error('token_exchange_status');
  } catch {
    // The request body carries the client secret; nothing derived from it may
    // propagate to a caller (INV-8, INV-10). The status is safe and is the
    // difference between "GitHub refused us" and "we never reached GitHub".
    console.error('[github] exchange failed, http status:', status || 'no response');
    throw new GitHubAuthError('token_exchange_failed');
  }

  const access = typeof json?.access_token === 'string' ? json.access_token : '';
  if (!access) {
    // GitHub answers a bad secret or a spent code with HTTP 200 and an error
    // body, so this branch is the common failure rather than an edge case.
    // The code is GitHub's own and names the fault; it is logged, never
    // rendered, because this page is reachable by anyone with a URL.
    const reason = typeof json?.error === 'string' ? json.error : 'no_access_token_in_response';
    console.error('[github] exchange returned nothing usable:', reason);
    throw new GitHubAuthError('no_access_token');
  }

  await connectionRef(uid).set({
    accessToken: await seal(access),
    connectedAt: new Date().toISOString(),
    scope: typeof json?.scope === 'string' ? json.scope : GITHUB_SCOPE,
  });
}

export async function isConnected(uid: string): Promise<boolean> {
  return (await connectionRef(uid).get()).exists;
}

/** The stored credential, opened. Null when absent or unreadable. */
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
 * disconnected when the credential remained valid. The revocation is the one
 * place this application issues a non-GET GitHub request; it touches no
 * repository and its purpose is to give up access (INV-19).
 *
 * Our copy is deleted first and regardless: failing to forget a credential
 * because GitHub was unreachable is the wrong way round.
 */
export async function disconnect(uid: string): Promise<void> {
  const credential = await githubToken(uid);
  await connectionRef(uid).delete().catch(() => undefined);
  if (!credential) return;

  try {
    const id = clientId();
    const basic = Buffer.from(`${id}:${await getGitHubClientSecret()}`).toString('base64');
    await fetch(`${GITHUB_API}/applications/${encodeURIComponent(id)}/token`, {
      method: 'DELETE',
      headers: {
        authorization: `Basic ${basic}`,
        accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ access_token: credential }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Best effort. Our copy is already gone.
  }
}
