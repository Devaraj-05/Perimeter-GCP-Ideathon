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
