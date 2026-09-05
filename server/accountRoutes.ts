import { Router, Response } from 'express';
import { requireAuth, AuthedRequest } from './auth';
import { exportAccount, deleteAccount } from './account';
import { logEvent } from './perimeterLog';

/**
 * Account export and deletion — Amendment N.
 *
 * Both sit behind `requireAuth` and take their uid from the verified token,
 * never from the request (INV-3). There is deliberately no admin variant and no
 * uid parameter: a route that can export or delete *a* user is one bug away
 * from exporting or deleting *any* user, and nothing in this product needs it.
 *
 * Neither route is reachable by the agent. The Planner's tool registry has no
 * export and no delete, so an instruction hidden in a document has nothing to
 * call — a property of the registry rather than of prompt wording, asserted in
 * account.test.ts.
 */
export const accountRouter = Router();

accountRouter.get('/export', requireAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try {
    const data = await exportAccount(uid);

    // Logged as an observation. An export is not a refusal and not a tool
    // call, but it is a moment where everything an account holds was read in
    // one go, and the log is where that belongs.
    await logEvent(uid, {
      kind: 'account',
      zone: 'USER',
      tool: null,
      decision: null,
      reason: 'account_exported',
      invariant: 'INV-22',
      detail: {
        collections: Object.keys(data.collections).length,
        documents: Object.values(data.collections).reduce((n, rows) => n + rows.length, 0),
      },
    }).catch(() => undefined);

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="perimeter-export-${stamp}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('[account] export failed:', err?.message);
    return res.status(500).json({ error: 'Could not build your export. Please retry.' });
  }
});

/**
 * Deletion, behind a typed confirmation.
 *
 * §10 reserves a confirmation dialog for genuinely irreversible actions, and
 * this is the only one in the product. The client asks the user to type
 * DELETE; the server requires it too, because a guard that lives only in the
 * UI is not a guard — it is a suggestion to anyone holding a token.
 */
accountRouter.post('/delete', requireAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  if (body.confirm !== 'DELETE') {
    return res.status(400).json({
      error: 'Deletion needs an explicit confirmation.',
      code: 'confirmation_required',
    });
  }

  try {
    // Written BEFORE the deletion, because the collection it writes to is
    // about to be removed and an event recorded after the fact would be
    // recorded into nothing.
    await logEvent(uid, {
      kind: 'account',
      zone: 'USER',
      tool: null,
      decision: null,
      reason: 'account_deletion_requested',
      invariant: 'INV-23',
      detail: {},
    }).catch(() => undefined);

    const report = await deleteAccount(uid);

    return res.status(200).json({
      ok: true,
      // Reported honestly. If the Auth record survived, the user can still
      // sign in to an empty workspace and needs to know that rather than
      // discovering it.
      authUserDeleted: report.authUserDeleted,
      revoked: report.revoked,
    });
  } catch (err: any) {
    console.error('[account] deletion failed:', err?.message);
    return res.status(500).json({
      error: 'Deletion did not complete. Nothing was partially removed that you can lose — sign in and try again.',
    });
  }
});
