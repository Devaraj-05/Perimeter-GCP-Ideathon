import { Router, Request, Response } from 'express';
import { requireAuth, AuthedRequest } from './auth';
import { checkRateLimit } from './ratelimit';
import { logEvent } from './perimeterLog';
import {
  beginConnect,
  consumeState,
  completeConnect,
  isConnected,
  disconnect,
  fetchRecent,
  GmailError,
} from './gmail';
import { ingestUntrustedText } from './ingest';

/**
 * Gmail routes — Amendment H.
 *
 * Note which route is NOT behind requireAuth: the callback. Google redirects a
 * browser there and that request carries no bearer token, so it cannot be
 * authenticated in the usual way. Its identity comes from the single-use state
 * nonce instead (INV-17), which is why the nonce is the only thing in this file
 * that must be treated as a credential.
 */

export const gmailRouter = Router();

/** Maps an internal code to something safe to display (INV-10). */
function userFacing(code: string): [number, string] {
  const table: Record<string, [number, string]> = {
    oauth_not_configured: [503, 'Email connection is not configured on this deployment.'],
    bad_state: [400, 'That connection link is no longer valid. Start again.'],
    state_expired: [400, 'That connection link expired. Start again.'],
    token_exchange_failed: [502, 'Google refused the connection. Please retry.'],
    no_refresh_token: [502, 'Google did not return a durable token. Try connecting again.'],
    not_connected: [400, 'No mailbox is connected.'],
    refresh_failed: [502, 'The connection expired. Reconnect your mailbox.'],
    gmail_unreachable: [502, 'Could not reach Gmail right now. Please retry.'],
  };
  return table[code] ?? [502, 'Something went wrong with the mail connection.'];
}

gmailRouter.get('/status', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    res.json({ connected: await isConnected(req.uid!) });
  } catch {
    res.status(500).json({ error: 'Could not check the connection.' });
  }
});

/** Starts a consent. Authenticated, because this is where the uid is known. */
gmailRouter.post('/connect', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    res.json({ url: await beginConnect(req.uid!) });
  } catch (err: any) {
    if (err instanceof GmailError) {
      const [status, message] = userFacing(err.code);
      return res.status(status).json({ error: message, code: err.code });
    }
    console.error('[gmail] connect failed:', err?.message);
    res.status(500).json({ error: 'Could not start the connection.' });
  }
});

gmailRouter.post('/disconnect', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    await disconnect(req.uid!);
    await logEvent(req.uid!, {
      kind: 'decision',
      decision: 'allow',
      reason: 'gmail_disconnected',
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
 * else; a uid in the query string is ignored, because honouring one would let
 * anyone attach their inbox to another account by editing a URL.
 *
 * Responds with a small HTML page rather than JSON: a human's browser lands
 * here, not a fetch call.
 */
gmailRouter.get('/callback', async (req: Request, res: Response) => {
  const page = (title: string, message: string) =>
    `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font:16px system-ui;margin:3rem auto;max-width:32rem;color:#2c2c24">` +
    `<h1 style="font-size:1.25rem">${title}</h1><p>${message}</p>` +
    `<p>You can close this tab and return to Perimeter.</p></body>`;

  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';

    if (typeof req.query.error === 'string' && req.query.error) {
      return res.status(400).send(page('Connection cancelled', 'No mailbox was connected.'));
    }
    if (!code || !state) {
      return res.status(400).send(page('Connection failed', 'That link was incomplete.'));
    }

    const uid = await consumeState(state);
    await completeConnect(uid, code);

    await logEvent(uid, {
      kind: 'decision',
      decision: 'allow',
      reason: 'gmail_connected',
      detail: { scope: 'gmail.readonly' },
    });

    res.send(page('Mailbox connected', 'Perimeter can now read recent messages, read-only.'));
  } catch (err: any) {
    // Never render the reason: this page is reachable by anyone with a URL.
    console.error('[gmail] callback failed:', err?.code ?? err?.message);
    res.status(400).send(page('Connection failed', 'That connection link was not valid.'));
  }
});

/**
 * Pulls recent messages in as UNTRUSTED artifacts.
 *
 * Subject, sender and body are all attacker-controlled — anyone can send an
 * email — so every part of a message goes through the same ingest path as a
 * fetched web page. The sender address is included in the text because it is
 * part of the content, not because it is identity.
 */
gmailRouter.post('/ingest', requireAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try {
    const limit = checkRateLimit(`gmail:${uid}`, Number(process.env.GMAIL_RATE_LIMIT_PER_HOUR) || 10);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: `Too many mailbox reads. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
      });
    }

    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const max = Number.isFinite(data.max) ? Math.min(Math.max(1, Number(data.max)), 10) : 5;

    const messages = await fetchRecent(uid, max);
    const ingested = [];

    for (const m of messages) {
      const result = await ingestUntrustedText(uid, {
        text: `From: ${m.from}\nSubject: ${m.subject}\n\n${m.body}`,
        sourceType: 'paste',
        sourceRef: `gmail:${m.id}`,
        title: m.subject,
        sourceId: 'gmail',
        author: 'email',
        idPrefix: 'email',
      });
      ingested.push({
        artifactId: result.artifactId,
        title: result.title,
        verdict: result.verdict,
      });
    }

    await logEvent(uid, {
      kind: 'ingest',
      zone: 'UNTRUSTED',
      decision: 'allow',
      reason: `gmail:${ingested.length}_messages`,
      // Counts and verdicts only. No subjects, no senders, no bodies.
      detail: {
        count: ingested.length,
        hostile: ingested.filter((i) => i.verdict === 'hostile').length,
      },
    });

    res.status(201).json({ messages: ingested });
  } catch (err: any) {
    if (err instanceof GmailError) {
      const [status, message] = userFacing(err.code);
      return res.status(status).json({ error: message, code: err.code });
    }
    console.error('[gmail] ingest failed:', err?.message);
    res.status(500).json({ error: 'Could not read your mailbox. Please retry.' });
  }
});
