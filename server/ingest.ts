import { Router, Response } from 'express';
import { requireAuth, AuthedRequest, adminDb } from './auth';
import { fetchOpenIssues, isValidRepoRef, IngestError } from './github';
import { detectL1, fuseVerdict, Match } from './detect';
import { classifyL2 } from './classify';
import { safeFetch } from './fetchurl';
import { createSegment, SourceType } from './segments';
import { logEvent } from './perimeterLog';
import { PerimeterViolation } from './segments';
import { checkRateLimit } from './ratelimit';
import { extractTextFromFile, ExtractError, MAX_FILE_BYTES } from './extract';
import { scanRepository } from './reposcan';

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

/**
 * The one path by which anything untrusted becomes an artifact — Amendment F.
 *
 * Extracted from the /link handler so that notes, files and email all screen,
 * segment and store identically to a fetched web page. The alternative was a
 * second copy of this per input type, which is how one of them eventually ends
 * up skipping classifyL2 or forgetting `zone: 'UNTRUSTED'` and nobody notices.
 *
 * Callers supply only text. Producing that text from a PDF, an image or an
 * inbox is the caller's problem; everything after it is identical here.
 *
 * INV-14: the zone is hardcoded. There is no parameter that makes content
 * arrive as anything other than UNTRUSTED.
 */
/** Matches the artifact `body` cap, so nothing is silently truncated later. */
const MAX_NOTE_CHARS = 20_000;

export interface IngestedArtifact {
  artifactId: string;
  segmentId: string;
  title: string;
  verdict: string;
  signals: string[];
  /** Where each signal fired, so the caller can show evidence rather than a badge. */
  matches: Match[];
  bytes: number;
}

export async function ingestUntrustedText(
  uid: string,
  input: {
    text: string;
    /**
     * Recorded on the segment. Uses the existing SourceType union rather than a
     * free string so a typo cannot create a zone-adjacent field nobody queries.
     */
    sourceType: SourceType;
    /** Where it came from: a URL, a filename, a message id. */
    sourceRef: string;
    /** Shown in the UI. Falls back to sourceRef. */
    title?: string;
    /** Grouping id for the sources panel. */
    sourceId?: string;
    author?: string;
    /** Hosts whose presence in the text is expected rather than suspicious. */
    allowedHosts?: string[];
    /** Prefix for the artifact document id. */
    idPrefix?: string;
    truncated?: boolean;
  },
): Promise<IngestedArtifact> {
  const combined = input.text;

  // Screening. L1 and L2 are defence in depth here - the boundary is that this
  // text only ever reaches the Reader, which holds no tools.
  const l1 = detectL1(combined, input.allowedHosts ? { allowedHosts: input.allowedHosts } : undefined);
  const l2 = await classifyL2(combined);
  const verdict = fuseVerdict(l1, l2.score);

  const segment = await createSegment(uid, {
    zone: 'UNTRUSTED',
    text: combined,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
  });

  const title = input.title || input.sourceRef;
  const artifactId = `${input.idPrefix ?? input.sourceType}__${segment.id}`;
  const bytes = Buffer.byteLength(combined, 'utf8');

  await artifactsRef(uid).doc(artifactId).set(
    clean({
      id: artifactId,
      segmentId: segment.id,
      sourceId: input.sourceId ?? `pasted_${input.sourceType}s`,
      sourceRef: input.sourceRef,
      externalId: segment.id,
      title,
      body: combined.slice(0, 20_000),
      author: input.author ?? input.sourceType,
      url: input.sourceType === 'url' ? input.sourceRef : null,
      trust: 'untrusted',
      threatScore: Math.max(l1.score, l2.score ?? 0),
      l1Score: l1.score,
      l2Score: l2.score,
      signals: l1.signals,
      // Stored, not merely returned. Evidence that lives only in the ingest
      // response dies on reload, and the user would have to re-upload the file
      // to see why it was flagged. Safe to store because excerpts are capped at
      // 200 chars and the document at 100 matches, upstream in detect.ts.
      matches: l1.matches,
      categories: l2.categories,
      verdict,
      classifierError: l2.error ?? null,
      fetchedAt: new Date().toISOString(),
      externalUpdatedAt: new Date().toISOString(),
      bytes,
      truncated: input.truncated ?? false,
    }),
  );

  return {
    artifactId,
    segmentId: segment.id,
    title,
    verdict,
    signals: l1.signals,
    matches: l1.matches,
    bytes,
  };
}

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

    const result = await ingestUntrustedText(uid, {
      text: page.text,
      sourceType: 'url',
      sourceRef: page.finalUrl,
      sourceId: 'pasted_links',
      author: 'web',
      allowedHosts: [new URL(page.finalUrl).hostname],
      idPrefix: 'link',
      truncated: page.truncated,
    });

    await logEvent(uid, {
      kind: 'ingest',
      zone: 'UNTRUSTED',
      decision: 'allow',
      reason: `fetched:${result.verdict}`,
      detail: {
        url: page.finalUrl,
        bytes: page.bytes,
        signals: result.signals,
        verdict: result.verdict,
      },
    });

    res.status(201).json({
      artifactId: result.artifactId,
      segmentId: result.segmentId,
      url: page.finalUrl,
      verdict: result.verdict,
      signals: result.signals,
      matches: result.matches,
      bytes: page.bytes,
      truncated: page.truncated,
    });
  } catch (err: any) {
    console.error('[ingest] link failed:', err?.message);
    res.status(500).json({ error: 'Could not read that link. Please retry.' });
  }
});

/**
 * Ingests text the user pasted — Amendment F.
 *
 * The natural way suspicious content actually arrives: someone copies an email
 * body, a message, a document excerpt, and wants to know what is in it. There
 * is deliberately no path that treats this as more trustworthy than a fetched
 * page. A human pasting it says nothing about who wrote it, and the entire
 * scenario is a human pasting something an attacker wrote.
 */
ingestRouter.post('/note', requireAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try {
    const limit = checkRateLimit(`note:${uid}`, Number(process.env.NOTE_RATE_LIMIT_PER_HOUR) || 60);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: `Too many notes. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
      });
    }

    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const text = typeof data.text === 'string' ? data.text.trim() : '';
    const label = typeof data.label === 'string' ? data.label.trim().slice(0, 120) : '';

    if (!text) return res.status(400).json({ error: 'Paste some text first.' });
    if (text.length > MAX_NOTE_CHARS) {
      return res.status(400).json({ error: `Notes are capped at ${MAX_NOTE_CHARS} characters.` });
    }

    // The label is the user's own words, so it is safe as a title, but it is
    // still capped and never used to build a path or a query.
    const result = await ingestUntrustedText(uid, {
      text,
      sourceType: 'paste',
      sourceRef: 'pasted note',
      title: label || `Pasted note — ${new Date().toLocaleString()}`,
      sourceId: 'pasted_notes',
      author: 'pasted',
      idPrefix: 'note',
    });

    await logEvent(uid, {
      kind: 'ingest',
      zone: 'UNTRUSTED',
      decision: 'allow',
      reason: `pasted:${result.verdict}`,
      // The note text itself is not copied into the log; logEvent hashes long
      // strings and the artifact already holds the body.
      detail: { bytes: result.bytes, signals: result.signals, verdict: result.verdict },
    });

    res.status(201).json({
      artifactId: result.artifactId,
      segmentId: result.segmentId,
      title: result.title,
      verdict: result.verdict,
      signals: result.signals,
      matches: result.matches,
      bytes: result.bytes,
    });
  } catch (err: any) {
    console.error('[ingest] note failed:', err?.message);
    res.status(500).json({ error: 'Could not save that note. Please retry.' });
  }
});

/**
 * Ingests an uploaded file — Amendment G, INV-15.
 *
 * Bytes in, text out, bytes gone. Nothing binary is stored, so there is no
 * blob store to secure and nothing to leak. The declared MIME type is ignored
 * entirely; the real type comes from the leading bytes.
 */
ingestRouter.post('/file', requireAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try {
    const limit = checkRateLimit(`file:${uid}`, Number(process.env.FILE_RATE_LIMIT_PER_HOUR) || 20);
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: `Too many uploads. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
      });
    }

    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const b64 = typeof data.data === 'string' ? data.data : '';
    const filename = typeof data.filename === 'string' ? data.filename.trim().slice(0, 120) : '';

    if (!b64) return res.status(400).json({ error: 'No file received.' });

    // Reject on the encoded length before decoding, so an oversized upload
    // never becomes an oversized Buffer.
    if (b64.length > Math.ceil((MAX_FILE_BYTES * 4) / 3) + 1024) {
      return res.status(400).json({ error: 'That file is too large. The limit is 5MB.' });
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(b64, 'base64');
    } catch {
      return res.status(400).json({ error: 'That file could not be read.' });
    }

    let extracted;
    try {
      extracted = await extractTextFromFile(bytes);
    } catch (err: any) {
      if (err instanceof ExtractError) {
        const messages: Record<string, [number, string]> = {
          empty_file: [400, 'That file is empty.'],
          file_too_large: [400, 'That file is too large. The limit is 5MB.'],
          unsupported_file_type: [400, 'Only PDF, PNG, JPEG, GIF and WebP files are supported.'],
          no_text_found: [422, 'No readable text was found in that file.'],
          transcription_failed: [502, 'Could not read that file. Please retry.'],
        };
        const [status, message] = messages[err.code] ?? [502, 'Could not read that file.'];
        return res.status(status).json({ error: message, code: err.code });
      }
      throw err;
    }

    const result = await ingestUntrustedText(uid, {
      text: extracted.text,
      sourceType: extracted.kind === 'image' ? 'image' : 'file',
      sourceRef: filename || `uploaded ${extracted.kind}`,
      title: filename || `Uploaded ${extracted.kind} — ${new Date().toLocaleString()}`,
      sourceId: `uploaded_${extracted.kind}s`,
      author: extracted.kind,
      idPrefix: extracted.kind,
    });

    await logEvent(uid, {
      kind: 'ingest',
      zone: 'UNTRUSTED',
      decision: 'allow',
      reason: `uploaded:${result.verdict}`,
      // Byte count and type only. The file itself was never stored and its
      // text already lives on the artifact.
      detail: {
        fileKind: extracted.kind,
        uploadedBytes: bytes.length,
        signals: result.signals,
        verdict: result.verdict,
      },
    });

    res.status(201).json({
      artifactId: result.artifactId,
      segmentId: result.segmentId,
      title: result.title,
      kind: extracted.kind,
      verdict: result.verdict,
      signals: result.signals,
      // The evidence, which this route alone was dropping. Without it a PDF
      // came back verdict 'hostile' with an empty match list, and the report
      // rendered "No injection attempts found" beside a HOSTILE chip — the
      // product's central claim contradicting itself on screen.
      matches: result.matches,
      bytes: result.bytes,
    });
  } catch (err: any) {
    console.error('[ingest] file failed:', err?.message);
    res.status(500).json({ error: 'Could not read that file. Please retry.' });
  }
});

/**
 * Repository injection scan — Amendment I, INV-18.
 *
 * Reads a public repository and reports where prompt injections are, with the
 * matched text quoted. It does not summarise, and it never will: no model is
 * involved anywhere in this path, which is what makes the scanner itself
 * un-injectable. server/reposcan.test.ts asserts that property against the
 * source rather than trusting this comment.
 *
 * Nothing is persisted. Repository text lives for the length of this request;
 * only the fact that a scan ran reaches the perimeter log, because storing
 * excerpts of someone else's repository in this user's database is not
 * something this feature should do.
 */
ingestRouter.post('/repo-scan', requireAuth, async (req: AuthedRequest, res: Response) => {
  const uid = req.uid!;
  try {
    const limit = checkRateLimit(
      `reposcan:${uid}`,
      Number(process.env.REPOSCAN_RATE_LIMIT_PER_HOUR) || 10,
    );
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds));
      return res.status(429).json({
        error: `Too many repository scans. Try again in ${Math.ceil(
          limit.retryAfterSeconds / 60,
        )} minute(s).`,
      });
    }

    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const repo = typeof data.repo === 'string' ? data.repo.trim() : '';
    if (!isValidRepoRef(repo)) {
      // Rejected before any network call: the reference becomes a URL path.
      return res.status(400).json({ error: 'Expected a repository as "owner/name".' });
    }

    // NDJSON: one JSON object per line, flushed as each batch lands. A tree
    // walk takes tens of seconds and a spinner with no numbers reads as a
    // hang, so progress is streamed rather than withheld until the end.
    //
    // Streamed over POST rather than SSE deliberately: EventSource cannot set
    // an Authorization header, and moving the token into a query string to
    // work around that would put a credential in URLs and access logs.
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');

    const result = await scanRepository(
      repo,
      (progress) => {
        res.write(JSON.stringify({ type: 'progress', ...progress }) + '\n');
      },
      // A connected user's own credential reaches their private repositories;
      // the deployment-wide token does not.
      uid,
    );

    await logEvent(uid, {
      kind: 'ingest',
      zone: 'UNTRUSTED',
      decision: 'allow',
      reason: `repo_scanned:${result.verdict}`,
      invariant: 'INV-18',
      detail: {
        repo: result.repo,
        branch: result.defaultBranch,
        filesScanned: result.filesScanned,
        filesTotal: result.filesTotal,
        stoppedBy: result.stoppedBy,
        // Counts only. The excerpts stay in the response and are never stored.
        findingCount: result.findings.length,
        live: result.tierCounts.live,
        active: result.tierCounts.active,
        quoted: result.tierCounts.quoted,
        weak: result.tierCounts.weak,
      },
    });

    res.write(JSON.stringify({ type: 'result', ...result }) + '\n');
    res.end();
  } catch (err: any) {
    const message =
      err instanceof IngestError
        ? err.message
        : 'That scan could not be completed. Please retry.';
    if (!(err instanceof IngestError)) {
      console.error('[ingest] repo scan failed:', err?.message);
    }

    // Once bytes are on the wire the status line is already sent, so a failure
    // mid-scan has to arrive as a line in the stream rather than as a status.
    if (res.headersSent) {
      res.write(JSON.stringify({ type: 'error', error: message }) + '\n');
      return res.end();
    }
    res.status(err instanceof IngestError && err.retryable ? 503 : 400).json({ error: message });
  }
});
