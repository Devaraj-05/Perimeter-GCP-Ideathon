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
 * (INV-17). Honouring a uid from that query string would let anyone attach
 * their GitHub account to somebody else's Perimeter account by editing a URL.
 */
export const githubRouter = Router();

/** Typed, generic, and never the provider's own words (INV-10). */
function userFacing(code: string): [number, string] {
  const table: Record<string, [number, string]> = {
    oauth_not_configured: [
      503,
      'GitHub is not configured on this deployment: set GITHUB_CLIENT_ID and GITHUB_OAUTH_REDIRECT.',
    ],
    encryption_key_missing: [
      503,
      'GitHub is not configured on this deployment: GOOGLE_OAUTH_ENC_KEY is missing, and stored tokens cannot be sealed without it.',
    ],
    client_secret_missing: [
      503,
      'GitHub is not configured on this deployment: the OAuth client secret is missing.',
    ],
    bad_state: [400, 'That connection link was not valid.'],
    state_expired: [400, 'That connection link expired. Start again.'],
    token_exchange_failed: [502, 'GitHub did not complete the connection.'],
    no_access_token: [502, 'GitHub did not return a usable credential.'],
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
 * Responds with a small HTML page rather than JSON: a human's browser lands
 * here, not a fetch call. Every string in that page is a literal, and nothing
 * from the query string reaches it.
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
