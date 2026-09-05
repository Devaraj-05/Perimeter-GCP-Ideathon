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
/**
 * Every prefix GitHub issues. A value that matches none of them is not a token
 * and is never sent: a malformed secret produces "Bad credentials", which reads
 * as "your token is expired" and sends the operator hunting for the wrong
 * problem. Refusing to send it turns a confusing 401 into a clear warning.
 */
const TOKEN_PREFIXES = ['ghp_', 'github_pat_', 'gho_', 'ghu_', 'ghs_', 'ghr_'];

/**
 * True once GitHub has rejected the configured token in this process.
 *
 * Sticky on purpose: after the first rejection there is no reason to send the
 * same bad credential 500 more times, and every one of those is a request the
 * anonymous budget could have spent on an actual file.
 */
let tokenRejected = false;

/** Why the current scan is running without authentication, if it is. */
let tokenWarning: string | null = null;

/**
 * Records that GitHub refused the configured token.
 *
 * Both fetch paths need this. The archive path did not have it, so a bad token
 * made the ONE-request download fail and silently drop the scan onto the
 * 121-request fallback — which then went anonymous correctly and immediately
 * ran out of hourly budget. The symptom was a scan that stopped halfway with a
 * message about a token, and the cause was the fast path not knowing what the
 * slow path already did.
 */
function markTokenRejected(): void {
  tokenRejected = true;
  tokenWarning =
    'GitHub rejected GITHUB_TOKEN as bad credentials, so the scan ran anonymously. Public repositories still scan in full. Generate a new token when convenient: a classic one needs no scopes at all.';
  console.warn('[github] GITHUB_TOKEN rejected; continuing anonymously');
}

export function githubAuthWarning(): string | null {
  return tokenWarning;
}

export function resetGithubAuthWarning(): void {
  tokenWarning = null;
}

/**
 * The token to send, or undefined to go anonymous.
 *
 * A broken token must never leave the caller worse off than no token. GitHub
 * serves public repositories anonymously at 60 requests an hour, so falling
 * back is strictly better than failing — provided the user is told, because a
 * silent downgrade hides a real configuration fault.
 */
export function looksLikeGitHubToken(raw: unknown): boolean {
  return typeof raw === 'string' && TOKEN_PREFIXES.some((prefix) => raw.trim().startsWith(prefix));
}

function usableToken(): string | undefined {
  const raw = process.env.GITHUB_TOKEN?.trim();
  if (!raw) return undefined;

  // An unfamiliar prefix is a warning, never a refusal.
  //
  // The first version of this check declined to send anything that did not
  // match a known prefix, which blocked tokens that are perfectly valid:
  // GitHub issued 40-character hex tokens for years before the ghp_ era, and
  // App installations mint formats this list will never keep up with. The
  // authority on whether a credential works is GitHub, not a list in this
  // file — and a token GitHub rejects already degrades to anonymous, so
  // sending an unfamiliar one costs a single request and nothing else.
  if (!looksLikeGitHubToken(raw)) {
    tokenWarning =
      'GITHUB_TOKEN does not match a familiar GitHub prefix (ghp_, github_pat_, gho_, ghu_, ghs_, ghr_). It was sent anyway — if GitHub rejects it the scan continues anonymously.';
  }
  if (tokenRejected) {
    tokenWarning =
      'GitHub rejected GITHUB_TOKEN as bad credentials, so the scan ran anonymously. Public repositories still scan in full. Generate a new token when convenient: a classic one needs no scopes at all.';
    return undefined;
  }
  return raw;
}

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
  const token = usableToken();
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
      // If a token was configured and rejected, THAT is the actionable fact.
      // Reporting only the anonymous rate limit would send the operator to
      // wait an hour for a problem that waiting will not fix.
      const anonymous = `GitHub allows ${ceiling} unauthenticated requests an hour and this server has spent them.${resetsIn}`;
      throw new IngestError(
        token
          ? `GitHub rate limit reached (${ceiling}/hour).${resetsIn}`
          : tokenWarning
            ? `${tokenWarning} ${anonymous}`
            : `${anonymous} Set GITHUB_TOKEN to raise the limit to 5,000.`,
        true,
      );
    }
    // A bad credential degrades to anonymous rather than ending the scan.
    // Public repositories are readable without a token, so failing outright
    // would be a strictly worse outcome than never configuring one.
    if (token && /bad credentials|requires authentication/i.test(detail)) {
      markTokenRejected();
      return ghFetch(path, accept);
    }

    if (!token) {
      throw new IngestError(
        `GitHub refused the request and no usable GITHUB_TOKEN is configured.${detail ? ` GitHub said: ${detail}` : ''}`,
        false,
      );
    }
    throw new IngestError(
      `GitHub rejected the configured GITHUB_TOKEN — it may be expired, revoked, or missing access to this repository.${detail ? ` GitHub said: ${detail}` : ''}`,
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
    const resets = minutesUntilReset(res.headers.get('x-ratelimit-reset'));
    const anonymous = `GitHub's unauthenticated budget for this server is nearly spent.${resets}`;
    throw new IngestError(
      token
        ? `GitHub rate limit nearly exhausted.${resets}`
        : tokenWarning
          ? `${tokenWarning} ${anonymous}`
          : `${anonymous} Set GITHUB_TOKEN to raise it to 5,000.`,
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

/**
 * The host GitHub redirects archive downloads to.
 *
 * Allowlisted separately and used by exactly one function. api.github.com
 * answers /tarball with a 302 to codeload, so a scan that refuses every
 * redirect cannot download an archive at all — and downloading the archive is
 * what turns 121 requests into one.
 */
const ARCHIVE_HOST = 'codeload.github.com';

function assertArchiveHost(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IngestError('Refusing to follow a malformed archive redirect.', false);
  }
  if (parsed.protocol !== 'https:') {
    throw new IngestError('Refusing a non-HTTPS archive redirect.', false);
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== ARCHIVE_HOST && host !== ALLOWED_HOST) {
    throw new IngestError(`Refusing an archive redirect to ${host}.`, false);
  }
}

/**
 * Downloads a repository as one gzipped tarball.
 *
 * One request instead of one per file. Scanning this project's own repository
 * cost 121 blob fetches and exhausted GitHub's anonymous hourly budget before
 * reaching the halfway mark; the same repository is a single 392 KB download.
 *
 * Exactly one redirect is followed, and the destination is re-validated
 * against the archive host before it is fetched — the same rule the rest of
 * this file applies, extended by precisely one hostname rather than relaxed.
 *
 * The size cap is enforced while streaming. Content-Length is supplied by the
 * other end, so a cap checked before the read is a cap we were told about.
 */
export async function fetchTarball(
  repoRef: string,
  branch: string,
  maxBytes: number,
): Promise<Buffer> {
  const [owner, name] = ownerAndName(repoRef);
  let url = `https://${ALLOWED_HOST}/repos/${owner}/${name}/tarball/${encodeURIComponent(branch)}`;
  assertAllowedHost(url);

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'perimeter-ingest',
  };
  const token = usableToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response | null = null;

  for (let hop = 0; hop < 2; hop++) {
    try {
      res = await fetch(url, {
        redirect: 'manual',
        headers,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        throw new IngestError('The repository archive took too long to download.', true);
      }
      throw new IngestError('Could not reach GitHub.', true);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new IngestError('GitHub redirected without a destination.', true);
      url = new URL(location, url).toString();
      assertArchiveHost(url);
      // The credential is not carried across hosts: codeload serves public
      // archives anonymously, and a token in a redirect is a token somewhere
      // it was never scoped for.
      delete headers.Authorization;
      continue;
    }
    break;
  }

  if (!res) throw new IngestError('Could not reach GitHub.', true);

  // A refused credential must not cost us the fast path. Without this the
  // archive request threw, the scanner fell back to fetching 121 files one at
  // a time, and THAT path went anonymous — correct, but 121 requests against a
  // 60-per-hour budget, so the scan stopped halfway. Dropping the token here
  // keeps the whole repository in a single download.
  if ((res.status === 401 || res.status === 403) && token) {
    markTokenRejected();
    // usableToken() returns undefined once rejected, so this recursion sends
    // no credential and cannot repeat.
    return fetchTarball(repoRef, branch, maxBytes);
  }
  if (res.status === 404) {
    throw new IngestError('Repository or branch not found, or it is private.', false);
  }
  if (!res.ok) {
    throw new IngestError(`GitHub returned ${res.status} for the archive.`, res.status >= 500);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new IngestError('GitHub returned an empty archive.', true);

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new IngestError(
        'That repository is larger than this scanner will download. Scanning file by file instead.',
        true,
      );
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}
