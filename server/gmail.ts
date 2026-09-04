import { randomBytes } from 'crypto';
import { adminDb } from './auth';
import { getGoogleClientSecret } from './secrets';
import { seal, open } from './tokencrypto';

/**
 * Gmail connection — Amendment H, INV-16 and INV-17.
 *
 * Read-only. We never send mail, and the scope requested says so.
 *
 * The subtle part is INV-17. The OAuth callback arrives as a browser redirect
 * from Google: it carries no bearer token, so there is no authenticated user on
 * that request. Identity therefore comes from a `state` nonce this server
 * issued and stored against a uid, consumed once. Accepting a uid from the
 * callback's query string instead would let anyone attach their own inbox to
 * another person's account by editing a URL.
 */

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

/** Read-only. Requesting more than is needed is how consent screens lose trust. */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** A consent that has not completed in ten minutes is abandoned, not pending. */
const STATE_TTL_MS = 10 * 60 * 1000;

export class GmailError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'GmailError';
  }
}

function clientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!id) throw new GmailError('oauth_not_configured');
  return id;
}

function redirectUri(): string {
  const uri = process.env.GOOGLE_OAUTH_REDIRECT?.trim();
  if (!uri) throw new GmailError('oauth_not_configured');
  return uri;
}

function stateRef(nonce: string) {
  return adminDb().collection('oauth_states').doc(nonce);
}

function connectionRef(uid: string) {
  return adminDb().collection('users').doc(uid).collection('private').doc('gmail');
}

/**
 * Starts a consent. Returns the URL the browser should visit.
 *
 * Called from an authenticated route, which is the only place the uid is known,
 * and binds that uid to a single-use nonce.
 */
export async function beginConnect(uid: string): Promise<string> {
  const nonce = randomBytes(32).toString('base64url');

  await stateRef(nonce).set({
    uid,
    createdAt: Date.now(),
    used: false,
  });

  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GMAIL_SCOPE,
    // offline + consent so a refresh token is actually issued; Google omits it
    // on repeat consents otherwise, and the connection silently lasts an hour.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state: nonce,
  });

  return `${GOOGLE_AUTH}?${params.toString()}`;
}

/**
 * Resolves a callback's state to the uid that started it — INV-17.
 *
 * Single use and time-limited. The document is deleted on consumption, so a
 * replayed callback finds nothing rather than re-attaching an inbox.
 */
export async function consumeState(nonce: string): Promise<string> {
  if (!nonce || typeof nonce !== 'string') throw new GmailError('bad_state');

  const snap = await stateRef(nonce).get();
  if (!snap.exists) throw new GmailError('bad_state');

  const data = snap.data() as { uid?: string; createdAt?: number; used?: boolean };
  await stateRef(nonce).delete().catch(() => undefined);

  if (data.used === true) throw new GmailError('bad_state');
  if (!data.uid) throw new GmailError('bad_state');
  if (!data.createdAt || Date.now() - data.createdAt > STATE_TTL_MS) {
    throw new GmailError('state_expired');
  }

  return data.uid;
}

/** Exchanges the authorization code and stores the refresh token, encrypted. */
export async function completeConnect(uid: string, code: string): Promise<void> {
  const body = new URLSearchParams({
    code,
    client_id: clientId(),
    client_secret: await getGoogleClientSecret(),
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });

  let json: any;
  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    json = await res.json();
    if (!res.ok) throw new Error('token_exchange_status');
  } catch {
    // The request body carries the client secret; nothing derived from it may
    // propagate (INV-8, INV-10).
    throw new GmailError('token_exchange_failed');
  }

  const refresh = typeof json?.refresh_token === 'string' ? json.refresh_token : '';
  if (!refresh) throw new GmailError('no_refresh_token');

  await connectionRef(uid).set({
    refreshToken: await seal(refresh),
    connectedAt: new Date().toISOString(),
    scope: GMAIL_SCOPE,
  });
}

export async function isConnected(uid: string): Promise<boolean> {
  return (await connectionRef(uid).get()).exists;
}

export async function disconnect(uid: string): Promise<void> {
  await connectionRef(uid).delete().catch(() => undefined);
}

/** Trades the stored refresh token for a short-lived access token. */
async function accessToken(uid: string): Promise<string> {
  const snap = await connectionRef(uid).get();
  if (!snap.exists) throw new GmailError('not_connected');

  const sealed = (snap.data() as any)?.refreshToken;
  if (typeof sealed !== 'string') throw new GmailError('not_connected');

  const refresh = await open(sealed);

  let json: any;
  try {
    const res = await fetch(GOOGLE_TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refresh,
        client_id: clientId(),
        client_secret: await getGoogleClientSecret(),
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    json = await res.json();
    if (!res.ok) throw new Error('refresh_status');
  } catch {
    throw new GmailError('refresh_failed');
  }

  const token = typeof json?.access_token === 'string' ? json.access_token : '';
  if (!token) throw new GmailError('refresh_failed');
  return token;
}

export interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  body: string;
}

/** Decodes Gmail's base64url payload parts. */
function decodePart(data: string): string {
  try {
    return Buffer.from(data, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

/** Walks the MIME tree for the first text/plain body. */
function firstTextBody(payload: any): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) return decodePart(payload.body.data);
  for (const part of payload.parts ?? []) {
    const found = firstTextBody(part);
    if (found) return found;
  }
  if (payload.body?.data) return decodePart(payload.body.data);
  return '';
}

/**
 * Fetches recent messages.
 *
 * Everything returned here is attacker-controlled: anyone can send an email, so
 * subject, sender and body are all UNTRUSTED. The sender address in particular
 * is not identity — it is a claim printed on an envelope.
 */
export async function fetchRecent(uid: string, max = 5): Promise<GmailMessage[]> {
  const token = await accessToken(uid);
  const auth = { authorization: `Bearer ${token}` };

  let list: any;
  try {
    const res = await fetch(`${GMAIL_API}/messages?maxResults=${Math.min(max, 10)}`, {
      headers: auth,
      signal: AbortSignal.timeout(15_000),
    });
    list = await res.json();
    if (!res.ok) throw new Error('list_status');
  } catch {
    throw new GmailError('gmail_unreachable');
  }

  const out: GmailMessage[] = [];
  for (const ref of (list?.messages ?? []).slice(0, max)) {
    try {
      const res = await fetch(`${GMAIL_API}/messages/${encodeURIComponent(ref.id)}?format=full`, {
        headers: auth,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const msg = await res.json();

      const headers: any[] = msg?.payload?.headers ?? [];
      const header = (name: string) =>
        String(headers.find((h) => String(h?.name).toLowerCase() === name)?.value ?? '').slice(
          0,
          300,
        );

      out.push({
        id: String(msg?.id ?? ref.id),
        subject: header('subject') || '(no subject)',
        from: header('from') || '(unknown sender)',
        body: firstTextBody(msg?.payload).slice(0, 20_000),
      });
    } catch {
      // One unreadable message must not abort the rest.
      continue;
    }
  }

  return out;
}
