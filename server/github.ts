/**
 * Amendment A.4 - Fetch safety.
 *
 * Outbound fetches are server-side only, against a hard hostname allowlist.
 * No user-supplied arbitrary URL is fetched: callers name a repository, never
 * a URL, and the URL is constructed here from validated components.
 */

/** The ONLY host this application will ever fetch from. */
const ALLOWED_HOST = 'api.github.com';

/** owner/name, GitHub's own character rules. Anything else is rejected. */
const REPO_REF = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?\/[A-Za-z0-9._-]{1,100}$/;

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  htmlUrl: string;
  updatedAt: string;
  author: string;
}

export class IngestError extends Error {
  constructor(message: string, readonly retryable: boolean = true) {
    super(message);
    this.name = 'IngestError';
  }
}

/**
 * Validates a "owner/name" reference. Rejects anything that could be coerced
 * into a different host or path - protocol-relative strings, traversal, query
 * or fragment injection.
 */
export function isValidRepoRef(ref: unknown): ref is string {
  if (typeof ref !== 'string') return false;
  const trimmed = ref.trim();
  if (!REPO_REF.test(trimmed)) return false;
  if (trimmed.includes('..')) return false;
  if (/[?#@\\]/.test(trimmed)) return false;
  return true;
}

function assertAllowedHost(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IngestError('Refusing to fetch a malformed URL.', false);
  }
  if (parsed.protocol !== 'https:') {
    throw new IngestError('Refusing a non-HTTPS outbound fetch.', false);
  }
  if (parsed.hostname.toLowerCase() !== ALLOWED_HOST) {
    // A.4: no redirect followed off-allowlist, no private/link-local reachable.
    throw new IngestError(`Refusing to fetch off-allowlist host: ${parsed.hostname}`, false);
  }
}

/**
 * Fetches open issues for one repository.
 *
 * The GitHub token is read from the environment at call time. Cloud Run injects
 * it from Secret Manager; it is never logged and never returned to the client.
 */
export async function fetchOpenIssues(
  repoRef: string,
  limit = 30,
): Promise<GitHubIssue[]> {
  if (!isValidRepoRef(repoRef)) {
    throw new IngestError('Invalid repository reference. Expected "owner/name".', false);
  }

  const [owner, name] = repoRef.trim().split('/');
  const url = `https://${ALLOWED_HOST}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    name,
  )}/issues?state=open&per_page=${Math.min(Math.max(1, limit), 100)}`;

  assertAllowedHost(url);

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'perimeter-ingest',
  };

  const token = process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers,
      // A.4: never follow a redirect, since the destination is not re-checked
      // against the allowlist by the runtime.
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError') {
      throw new IngestError('GitHub request timed out.', true);
    }
    throw new IngestError('Could not reach GitHub.', true);
  }

  if (res.status === 404) {
    throw new IngestError('Repository not found, or it is private.', false);
  }
  if (res.status === 401 || res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining === '0') {
      throw new IngestError('GitHub rate limit exceeded. Try again shortly.', true);
    }
    throw new IngestError('GitHub rejected the request. Check the configured token.', false);
  }
  if (!res.ok) {
    throw new IngestError(`GitHub returned ${res.status}.`, res.status >= 500);
  }

  const payload = await res.json().catch(() => null);
  if (!Array.isArray(payload)) {
    throw new IngestError('Unexpected response shape from GitHub.', true);
  }

  return payload
    // The issues endpoint also returns pull requests; they are not issues.
    .filter((item: any) => item && typeof item === 'object' && !item.pull_request)
    .map((item: any) => ({
      number: Number(item.number) || 0,
      title: typeof item.title === 'string' ? item.title : '(untitled)',
      body: typeof item.body === 'string' ? item.body : '',
      htmlUrl: typeof item.html_url === 'string' ? item.html_url : '',
      updatedAt: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
      author:
        item.user && typeof item.user.login === 'string' ? item.user.login : 'unknown',
    }))
    .filter((issue: GitHubIssue) => issue.number > 0);
}

/**
 * One guarded GET against the allowlisted host — Amendment I.
 *
 * Extracted so the repository scanner cannot accidentally introduce a second
 * fetch path with weaker rules. Every caller passes a path built from
 * isValidRepoRef-validated, URL-encoded components; no caller passes a URL.
 */
function minutesUntilReset(header: string | null): string {
  const reset = Number(header);
  if (!Number.isFinite(reset) || reset <= 0) return '';
  const minutes = Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60_000));
  return ` It resets in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

async function ghFetch(path: string, accept: string): Promise<Response> {
  const url = `https://${ALLOWED_HOST}${path}`;
  assertAllowedHost(url);

  const headers: Record<string, string> = {
    Accept: accept,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'perimeter-ingest',
  };
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(url, {
      // A.4: never follow a redirect — the destination is not re-checked
      // against the allowlist by the runtime.
      redirect: 'error',
      headers,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err: any) {
    if (err?.name === 'TimeoutError') throw new IngestError('GitHub request timed out.', true);
    throw new IngestError('Could not reach GitHub.', true);
  }

  if (res.status === 404) {
    throw new IngestError('Repository not found, or it is private.', false);
  }
  if (res.status === 401 || res.status === 403) {
    // "Check the configured token" was the old message for all of these, which
    // is actively misleading when there is no token to check. Each of these
    // causes needs a different action from the operator, so each gets its own
    // sentence.
    const remaining = res.headers.get('x-ratelimit-remaining');
    const ceiling = res.headers.get('x-ratelimit-limit') ?? '60';
    const resetsIn = minutesUntilReset(res.headers.get('x-ratelimit-reset'));

    // GitHub's own explanation, capped and treated as third-party text.
    const detail = await res
      .json()
      .then((b: any) => (typeof b?.message === 'string' ? b.message.slice(0, 200) : ''))
      .catch(() => '');

    if (remaining === '0') {
      throw new IngestError(
        token
          ? `GitHub rate limit reached (${ceiling}/hour).${resetsIn}`
          : `GitHub allows ${ceiling} unauthenticated requests an hour and this server has spent them.${resetsIn} Set GITHUB_TOKEN to raise the limit to 5,000.`,
        true,
      );
    }
    if (!token) {
      throw new IngestError(
        `GitHub refused the request and no GITHUB_TOKEN is configured.${detail ? ` GitHub said: ${detail}` : ''}`,
        false,
      );
    }
    throw new IngestError(
      `GitHub rejected the configured GITHUB_TOKEN — it may be expired, revoked, or missing the scope for this repository.${detail ? ` GitHub said: ${detail}` : ''}`,
      false,
    );
  }
  if (!res.ok) {
    throw new IngestError(`GitHub returned ${res.status}.`, res.status >= 500);
  }

  // A budget this thin cannot finish a tree walk, and a scan that dies at file
  // 400 with an error is worse than one that stops and says how far it got.
  const left = Number(res.headers.get('x-ratelimit-remaining') ?? '999');
  if (Number.isFinite(left) && left <= 2) {
    throw new IngestError(
      token
        ? `GitHub rate limit nearly exhausted.${minutesUntilReset(res.headers.get('x-ratelimit-reset'))}`
        : `GitHub's unauthenticated budget for this server is nearly spent.${minutesUntilReset(res.headers.get('x-ratelimit-reset'))} Set GITHUB_TOKEN to raise it to 5,000.`,
      true,
    );
  }

  return res;
}

function ownerAndName(repoRef: string): [string, string] {
  if (!isValidRepoRef(repoRef)) {
    throw new IngestError('Invalid repository reference. Expected "owner/name".', false);
  }
  const [owner, name] = repoRef.trim().split('/');
  return [encodeURIComponent(owner), encodeURIComponent(name)];
}

/** The branch a scan reads. Never taken from user input. */
export async function fetchDefaultBranch(repoRef: string): Promise<string> {
  const [owner, name] = ownerAndName(repoRef);
  const res = await ghFetch(`/repos/${owner}/${name}`, 'application/vnd.github+json');
  const payload: any = await res.json().catch(() => null);
  const branch = payload?.default_branch;
  if (typeof branch !== 'string' || !branch) {
    throw new IngestError('Unexpected response shape from GitHub.', true);
  }
  return branch;
}

export interface GitHubTreeEntry {
  path: string;
  sha: string;
  size?: number;
  type: string;
}

/**
 * The whole default-branch tree in one request.
 *
 * GitHub truncates very large trees and says so. Reported rather than hidden:
 * a scan that silently read half a repository is the failure INV-18 names.
 */
export async function fetchTree(repoRef: string, branch: string): Promise<GitHubTreeEntry[]> {
  const [owner, name] = ownerAndName(repoRef);
  const res = await ghFetch(
    `/repos/${owner}/${name}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    'application/vnd.github+json',
  );
  const payload: any = await res.json().catch(() => null);
  if (!payload || !Array.isArray(payload.tree)) {
    throw new IngestError('Unexpected response shape from GitHub.', true);
  }
  return payload.tree as GitHubTreeEntry[];
}

/**
 * One blob as text, capped while reading.
 *
 * The raw media type returns file bytes rather than base64 JSON. The cap is
 * enforced on what actually arrives, because Content-Length is supplied by the
 * other end and a size checked before the read is a size we were told.
 */
export async function fetchBlobText(
  repoRef: string,
  sha: string,
  maxBytes: number,
): Promise<string> {
  const [owner, name] = ownerAndName(repoRef);
  if (!/^[0-9a-f]{7,64}$/i.test(String(sha))) {
    throw new IngestError('Invalid blob reference.', false);
  }

  const res = await ghFetch(
    `/repos/${owner}/${name}/git/blobs/${sha}`,
    'application/vnd.github.raw',
  );

  const reader = res.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}
