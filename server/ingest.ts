import { Router, Response } from 'express';
import { requireAuth, AuthedRequest, adminDb } from './auth';
import { fetchOpenIssues, isValidRepoRef, IngestError } from './github';
import { detectL1, fuseVerdict } from './detect';
import { classifyL2 } from './classify';

/**
 * Amendment A.5 - Ingestion endpoints.
 *
 * Every route requires a verified caller and operates only on sources owned by
 * that caller. Ownership is derived from the verified ID token (req.uid), never
 * read from the request body - a uid in a payload is attacker-controlled.
 */

export const ingestRouter = Router();

const MAX_SOURCES_PER_USER = 10;

/** Firestore rejects undefined; Directive 6 requires stripping before writes. */
function clean<T extends Record<string, any>>(obj: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function sourcesRef(uid: string) {
  return adminDb().collection('users').doc(uid).collection('sources');
}

function artifactsRef(uid: string) {
  return adminDb().collection('users').doc(uid).collection('artifacts');
}

// ---------------------------------------------------------------
// Source management
// ---------------------------------------------------------------

ingestRouter.get('/sources', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const snap = await sourcesRef(req.uid!).orderBy('createdAt', 'desc').get();
    res.json({ sources: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err: any) {
    console.error('[ingest] list sources failed:', err?.message);
    res.status(500).json({ error: 'Could not load your sources. Please retry.' });
  }
});

ingestRouter.post('/sources', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const ref = typeof data.ref === 'string' ? data.ref.trim() : '';

    if (!isValidRepoRef(ref)) {
      return res
        .status(400)
        .json({ error: 'Enter a public repository as "owner/name", e.g. facebook/react.' });
    }

    const existing = await sourcesRef(req.uid!).get();
    if (existing.size >= MAX_SOURCES_PER_USER) {
      return res
        .status(400)
        .json({ error: `You can track up to ${MAX_SOURCES_PER_USER} repositories.` });
    }
    if (existing.docs.some((d) => d.data().ref === ref)) {
      return res.status(409).json({ error: 'That repository is already being tracked.' });
    }

    const doc = sourcesRef(req.uid!).doc();
    const source = clean({
      id: doc.id,
      kind: 'github_repo',
      ref,
      enabled: true,
      createdAt: new Date().toISOString(),
      lastRunAt: null,
      lastRunStatus: 'never',
      lastRunError: null,
      artifactCount: 0,
    });

    await doc.set(source);
    res.status(201).json({ source });
  } catch (err: any) {
    console.error('[ingest] add source failed:', err?.message);
    res.status(500).json({ error: 'Could not add the repository. Please retry.' });
  }
});

ingestRouter.delete('/sources/:sourceId', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const sourceId = String(req.params.sourceId || '');
    // Path is uid-scoped, so a foreign sourceId simply does not resolve.
    const doc = sourcesRef(req.uid!).doc(sourceId);
    if (!(await doc.get()).exists) {
      return res.status(404).json({ error: 'Source not found.' });
    }

    const owned = await artifactsRef(req.uid!).where('sourceId', '==', sourceId).get();
    const batch = adminDb().batch();
    owned.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc);
    await batch.commit();

    res.json({ ok: true, removedArtifacts: owned.size });
  } catch (err: any) {
    console.error('[ingest] remove source failed:', err?.message);
    res.status(500).json({ error: 'Could not remove the repository. Please retry.' });
  }
});

// ---------------------------------------------------------------
// Artifacts (read-only to clients; written by Admin SDK only - A.6)
// ---------------------------------------------------------------

ingestRouter.get('/artifacts', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const snap = await artifactsRef(req.uid!).orderBy('fetchedAt', 'desc').limit(200).get();
    res.json({ artifacts: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  } catch (err: any) {
    console.error('[ingest] list artifacts failed:', err?.message);
    res.status(500).json({ error: 'Could not load artifacts. Please retry.' });
  }
});

// ---------------------------------------------------------------
// Ingest Gateway
// ---------------------------------------------------------------

/**
 * Runs one source. Returns a per-source result and records last-run state on
 * the source document - A.5 treats a silently failing run as a defect.
 */
export async function runSourceIngest(
  uid: string,
  sourceId: string,
): Promise<{ fetched: number; written: number; verdicts: Record<string, number> }> {
  const sourceDoc = sourcesRef(uid).doc(sourceId);
  const snap = await sourceDoc.get();
  if (!snap.exists) {
    throw new IngestError('Source not found.', false);
  }

  const source = snap.data() as { ref: string };
  const verdicts: Record<string, number> = { clean: 0, suspicious: 0, hostile: 0 };
  let written = 0;

  try {
    const issues = await fetchOpenIssues(source.ref);

    for (const issue of issues) {
      const combined = `${issue.title}\n\n${issue.body}`;

      const l1 = detectL1(combined, {
        allowedHosts: ['github.com', 'githubusercontent.com'],
      });
      const l2 = await classifyL2(combined);
      const verdict = fuseVerdict(l1, l2.score);
      verdicts[verdict] = (verdicts[verdict] || 0) + 1;

      // A.5: idempotent on (sourceId, externalId).
      const artifactId = `${sourceId}__${issue.number}`;

      await artifactsRef(uid)
        .doc(artifactId)
        .set(
          clean({
            id: artifactId,
            sourceId,
            sourceRef: source.ref,
            externalId: String(issue.number),
            title: issue.title,
            body: issue.body,
            author: issue.author,
            url: issue.htmlUrl,
            // A.1: immutable, and no code path promotes this to trusted.
            trust: 'untrusted',
            threatScore: Math.max(l1.score, l2.score ?? 0),
            l1Score: l1.score,
            l2Score: l2.score,
            signals: l1.signals,
            categories: l2.categories,
            verdict,
            classifierError: l2.error ?? null,
            fetchedAt: new Date().toISOString(),
            externalUpdatedAt: issue.updatedAt,
          }),
          { merge: true },
        );
      written++;
    }

    await sourceDoc.update(
      clean({
        lastRunAt: new Date().toISOString(),
        lastRunStatus: 'ok',
        lastRunError: null,
        artifactCount: written,
      }),
    );

    return { fetched: issues.length, written, verdicts };
  } catch (err: any) {
    const message =
      err instanceof IngestError ? err.message : 'Ingest failed unexpectedly.';
    await sourceDoc
      .update(
        clean({
          lastRunAt: new Date().toISOString(),
          lastRunStatus: 'error',
          lastRunError: message,
        }),
      )
      .catch(() => undefined);
    throw err instanceof IngestError ? err : new IngestError(message, true);
  }
}

ingestRouter.post('/run', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const sourceId = typeof data.sourceId === 'string' ? data.sourceId.trim() : '';
    if (!sourceId) {
      return res.status(400).json({ error: 'sourceId is required.' });
    }

    const result = await runSourceIngest(req.uid!, sourceId);
    res.json({ ok: true, ...result });
  } catch (err: any) {
    if (err instanceof IngestError) {
      return res.status(err.retryable ? 503 : 400).json({ error: err.message });
    }
    console.error('[ingest] run failed:', err?.message);
    res.status(500).json({ error: 'Ingest failed. Please retry.' });
  }
});
