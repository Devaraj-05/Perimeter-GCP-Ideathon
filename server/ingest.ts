import { Router, Response } from 'express';
import { requireAuth, AuthedRequest, adminDb } from './auth';
import { fetchOpenIssues, isValidRepoRef, IngestError } from './github';
import { detectL1, fuseVerdict } from './detect';
import { classifyL2 } from './classify';
import { safeFetch } from './fetchurl';
import { createSegment } from './segments';
import { logEvent } from './perimeterLog';
import { PerimeterViolation } from './segments';

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


// ---------------------------------------------------------------
// Pasted links — the natural way untrusted content enters a journal
// ---------------------------------------------------------------

/**
 * Fetches a URL the user pasted and stores it as an UNTRUSTED artifact.
 *
 * The user supplies a URL, not a host from an allowlist, so this is the SSRF
 * surface and safeFetch is what stands on it. Every refusal is a
 * PerimeterViolation naming INV-11, which the client renders as a sentence.
 *
 * The fetched text is NOT summarised here. It becomes an untrusted segment and
 * only the Reader ever sees it, which is the whole airlock.
 */
ingestRouter.post('/link', requireAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const url = typeof data.url === 'string' ? data.url.trim() : '';
    if (!url) {
      return res.status(400).json({ error: 'A URL is required.' });
    }

    let page;
    try {
      page = await safeFetch(url);
    } catch (err: any) {
      if (err instanceof PerimeterViolation) {
        await logEvent(uid, {
          kind: 'ingest',
          decision: 'deny',
          reason: err.message,
          invariant: 'INV-11',
          detail: { url },
        });
        // The reason is safe to show: it describes our refusal, not the target.
        return res.status(400).json({ error: `Refused to fetch that link. ${err.message}` });
      }
      throw err;
    }

    // Screening. L1 and L2 are defence in depth here - the boundary is that
    // this text only ever reaches the Reader, which holds no tools.
    const combined = page.text;
    const l1 = detectL1(combined, { allowedHosts: [new URL(page.finalUrl).hostname] });
    const l2 = await classifyL2(combined);
    const verdict = fuseVerdict(l1, l2.score);

    const segment = await createSegment(uid, {
      zone: 'UNTRUSTED',
      text: combined,
      sourceType: 'url',
      sourceRef: page.finalUrl,
    });

    const artifactId = `link__${segment.id}`;
    await artifactsRef(uid).doc(artifactId).set(
      clean({
        id: artifactId,
        segmentId: segment.id,
        sourceId: 'pasted_links',
        sourceRef: page.finalUrl,
        externalId: segment.id,
        title: page.finalUrl,
        body: combined.slice(0, 20_000),
        author: 'web',
        url: page.finalUrl,
        trust: 'untrusted',
        threatScore: Math.max(l1.score, l2.score ?? 0),
        l1Score: l1.score,
        l2Score: l2.score,
        signals: l1.signals,
        categories: l2.categories,
        verdict,
        classifierError: l2.error ?? null,
        fetchedAt: new Date().toISOString(),
        externalUpdatedAt: new Date().toISOString(),
        bytes: page.bytes,
        truncated: page.truncated,
      }),
    );

    await logEvent(uid, {
      kind: 'ingest',
      zone: 'UNTRUSTED',
      decision: 'allow',
      reason: `fetched:${verdict}`,
      detail: { url: page.finalUrl, bytes: page.bytes, signals: l1.signals, verdict },
    });

    res.status(201).json({
      artifactId,
      segmentId: segment.id,
      url: page.finalUrl,
      verdict,
      signals: l1.signals,
      bytes: page.bytes,
      truncated: page.truncated,
    });
  } catch (err: any) {
    console.error('[ingest] link failed:', err?.message);
    res.status(500).json({ error: 'Could not read that link. Please retry.' });
  }
});
