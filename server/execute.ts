import { adminDb } from './auth';
import { getToolSpec } from './tools';

/**
 * Tool Executor - Amendment B.2.
 *
 * The only place a tool actually runs. Two properties matter here:
 *
 *  1. Every query is rooted at users/{uid}, taken from the verified ID token.
 *     There is no code path where a uid arrives from a request body or from
 *     model-proposed arguments, so a tool cannot be pointed at another user.
 *  2. Ownership is re-verified HERE, not only at the request boundary. A
 *     proposal that passed policy minutes ago is still checked against current
 *     ownership before it touches anything.
 */

export interface ExecutionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function userRoot(uid: string) {
  return adminDb().collection('users').doc(uid);
}

async function searchArtifacts(uid: string, query: string): Promise<ExecutionResult> {
  const snap = await userRoot(uid).collection('artifacts').limit(200).get();
  const needle = query.toLowerCase().slice(0, 200);

  const matches = snap.docs
    .map((d) => d.data() as any)
    .filter(
      (a) =>
        String(a.title || '').toLowerCase().includes(needle) ||
        String(a.body || '').toLowerCase().includes(needle),
    )
    .slice(0, 10)
    .map((a) => ({
      title: a.title,
      source: a.sourceRef,
      externalId: a.externalId,
      verdict: a.verdict,
    }));

  return { ok: true, result: { matches, count: matches.length } };
}

async function summariseSource(uid: string, sourceId: string): Promise<ExecutionResult> {
  // Ownership re-verification: the path is uid-scoped, so a source belonging to
  // anyone else simply does not resolve here.
  const source = await userRoot(uid).collection('sources').doc(sourceId).get();
  if (!source.exists) {
    return { ok: false, error: 'Source not found.' };
  }

  const artifacts = await userRoot(uid)
    .collection('artifacts')
    .where('sourceId', '==', sourceId)
    .limit(100)
    .get();

  const counts = { clean: 0, suspicious: 0, hostile: 0 } as Record<string, number>;
  const titles: string[] = [];
  artifacts.docs.forEach((d) => {
    const a = d.data() as any;
    counts[a.verdict] = (counts[a.verdict] || 0) + 1;
    if (titles.length < 20) titles.push(`#${a.externalId} ${a.title}`);
  });

  return {
    ok: true,
    result: { source: (source.data() as any).ref, total: artifacts.size, verdicts: counts, titles },
  };
}

async function createNote(
  uid: string,
  title: string,
  body: string,
): Promise<ExecutionResult> {
  const doc = userRoot(uid).collection('entries').doc();
  const now = new Date().toISOString();

  await doc.set({
    id: doc.id,
    userId: uid,
    title: title.slice(0, 200),
    content: body.slice(0, 20_000),
    category: 'Ideas & Brainstorming',
    mood: 'Reflective',
    mode: 'companion',
    turns: [],
    // Provenance: a note the agent created is marked as such, so it is never
    // mistaken later for something the user wrote themselves.
    createdBy: 'agent',
    createdAt: now,
    updatedAt: now,
  });

  return { ok: true, result: { entryId: doc.id, title } };
}

/**
 * Runs an approved proposal. Callers must have obtained an ALLOW (or an
 * approved CONFIRM) from the Policy Engine first; this function does not
 * re-decide policy, it enforces ownership and executes.
 */
export async function executeTool(
  uid: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<ExecutionResult> {
  const spec = getToolSpec(tool);
  if (!spec) {
    return { ok: false, error: 'Unknown tool.' };
  }

  try {
    switch (spec.name) {
      case 'search_artifacts':
        return await searchArtifacts(uid, String(args.query ?? ''));
      case 'summarise_source':
        return await summariseSource(uid, String(args.sourceId ?? ''));
      case 'create_note':
        return await createNote(uid, String(args.title ?? ''), String(args.body ?? ''));
      default:
        return { ok: false, error: 'Unknown tool.' };
    }
  } catch (err: any) {
    console.error(`[execute] ${tool} failed:`, err?.message);
    return { ok: false, error: 'Tool execution failed.' };
  }
}
