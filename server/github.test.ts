import { describe, it, expect, vi, afterEach } from 'vitest';
import { looksLikeGitHubToken, isValidRepoRef, fetchOpenIssues } from './github';

/**
 * Token shape, checked before the credential is ever sent.
 *
 * A value that is not a GitHub token produces "Bad credentials" from GitHub,
 * which reads as "your token expired" and sends the operator hunting for the
 * wrong problem — renewing a token that was never a token. Refusing to send it
 * turns a confusing 401 into a warning that names the actual fault.
 */
describe('looksLikeGitHubToken', () => {
  it('accepts every prefix GitHub issues', () => {
    for (const prefix of ['ghp_', 'github_pat_', 'gho_', 'ghu_', 'ghs_', 'ghr_']) {
      expect(looksLikeGitHubToken(prefix + 'abc123')).toBe(true);
    }
  });

  it('tolerates surrounding whitespace, which is how a pasted token arrives', () => {
    expect(looksLikeGitHubToken('  ghp_abc123\n')).toBe(true);
  });

  it('rejects anything that is not one', () => {
    for (const bad of ['not-a-real-token', '', '   ', 'AIzaSyBsomethingelse', 'Bearer ghp_x']) {
      expect(looksLikeGitHubToken(bad)).toBe(false);
    }
  });

  it('rejects a non-string without throwing', () => {
    for (const bad of [undefined, null, 42, {}]) {
      expect(looksLikeGitHubToken(bad)).toBe(false);
    }
  });
});

describe('isValidRepoRef — the reference becomes a URL path', () => {
  it('accepts owner/name', () => {
    expect(isValidRepoRef('Devaraj-05/Perimeter-GCP-Ideathon')).toBe(true);
  });

  it('rejects traversal, protocol confusion and query injection', () => {
    for (const bad of [
      '../../etc/passwd',
      'owner/../../x',
      'https://evil.example/owner/name',
      'owner/name?x=1',
      'owner/name#frag',
      'owner@host/name',
      'owner\name',
      'not a repo',
      '/leading',
    ]) {
      expect(isValidRepoRef(bad)).toBe(false);
    }
  });
});

describe('a rejected GITHUB_TOKEN must not break a public repo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const ok = () =>
    new Response(JSON.stringify([{ number: 1, title: 'x', body: 'y', updated_at: 't' }]), {
      status: 200,
    });
  const rejected = () =>
    new Response('Bad credentials', { status: 401, headers: { 'x-ratelimit-remaining': '59' } });

  it('retries anonymously when the token is rejected, and succeeds', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_stale_token_value_that_is_rejected_00000');
    const calls: (string | null)[] = [];
    vi.stubGlobal('fetch', (_url: string, init: any) => {
      const auth = init?.headers?.Authorization ?? null;
      calls.push(auth);
      // First call carries the token and is rejected; the retry carries none.
      return Promise.resolve(auth ? rejected() : ok());
    });

    const issues = await fetchOpenIssues('owner/public-repo', 5);
    expect(issues.length).toBe(1);
    // Two attempts: with token, then without.
    expect(calls.length).toBe(2);
    expect(calls[0]).toMatch(/^Bearer /);
    expect(calls[1]).toBeNull();
  });

  it('does not retry-loop when the token is rate-limited', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_valid_but_ratelimited_000000000000000000');
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('rate limited', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
      ),
    );
    await expect(fetchOpenIssues('owner/public-repo', 5)).rejects.toThrow(/rate limit/i);
  });

  it('uses the token on the first try when it is valid', async () => {
    vi.stubEnv('GITHUB_TOKEN', 'ghp_valid_token_0000000000000000000000000000');
    let count = 0;
    vi.stubGlobal('fetch', () => {
      count++;
      return Promise.resolve(ok());
    });
    await fetchOpenIssues('owner/public-repo', 5);
    expect(count).toBe(1); // no retry needed
  });
});
