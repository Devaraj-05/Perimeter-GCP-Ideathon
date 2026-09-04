import { describe, it, expect } from 'vitest';
import { looksLikeGitHubToken, isValidRepoRef } from './github';

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
