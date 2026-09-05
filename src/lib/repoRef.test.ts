import { describe, it, expect } from 'vitest';
import { findRepoReference, isExplicitRef } from './repoRef';

describe('explicit references', () => {
  it.each([
    ['https://github.com/Devaraj-05/Perimeter-GCP-Ideathon', 'Devaraj-05/Perimeter-GCP-Ideathon'],
    ['http://github.com/a/b', 'a/b'],
    ['github.com/a/b', 'a/b'],
    ['a/b', 'a/b'],
    ['https://github.com/a/b.git', 'a/b'],
    ['https://github.com/a/b/', 'a/b'],
  ])('%s resolves to %s', (input, ref) => {
    expect(findRepoReference(input)).toEqual({ kind: 'explicit', ref });
  });

  it('finds one inside a sentence', () => {
    expect(findRepoReference('please scan github.com/foo/bar for injections')).toEqual({
      kind: 'explicit',
      ref: 'foo/bar',
    });
  });

  it('strips trailing prose punctuation', () => {
    expect(findRepoReference('look at foo/bar.')).toEqual({ kind: 'explicit', ref: 'foo/bar' });
  });

  it('prefers an explicit reference over a bare one anywhere in the message', () => {
    // "scan my-notes at foo/bar" must not scan my-notes.
    expect(findRepoReference('scan my-notes at foo/bar')).toEqual({
      kind: 'explicit',
      ref: 'foo/bar',
    });
  });

  it('rejects a path that is not owner/name', () => {
    expect(isExplicitRef('a/b/c')).toBe(false);
    expect(isExplicitRef('a')).toBe(false);
    expect(isExplicitRef('a/')).toBe(false);
    expect(isExplicitRef('/b')).toBe(false);
  });

  it('is not fooled by a lookalike host', () => {
    // notgithub.com/a/b keeps its host, so it is not two clean segments and
    // cannot be mistaken for owner/name.
    expect(findRepoReference('notgithub.com/a/b')).not.toEqual({
      kind: 'explicit',
      ref: 'a/b',
    });
  });
});

describe('bare names are candidates, not answers', () => {
  it('returns a bare name for a short message', () => {
    expect(findRepoReference('Perimeter-GCP-Ideathon')).toEqual({
      kind: 'bare',
      name: 'Perimeter-GCP-Ideathon',
    });
  });

  it('ignores ordinary words that are repository-shaped', () => {
    for (const text of ['scan my repo', 'check this code', 'look at the project']) {
      expect(findRepoReference(text), text).toBeNull();
    }
  });

  it('does not search on the strength of a word in a paragraph', () => {
    const prose =
      'I have been thinking about how the deployment pipeline behaves when a build fails ' +
      'and whether the retry logic is doing something sensible here';
    expect(findRepoReference(prose)).toBeNull();
  });

  it('needs a repo-ish shape for a very short token', () => {
    expect(findRepoReference('hey')).toBeNull();
    expect(findRepoReference('api')).toBeNull();
    // Hyphens, underscores, dots or digits read as a name rather than a word.
    expect(findRepoReference('api-v2')).toEqual({ kind: 'bare', name: 'api-v2' });
  });
});

describe('nothing at all', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['what is a prompt injection?', 'a question'],
  ])('%s yields null', (text) => {
    expect(findRepoReference(text)).toBeNull();
  });

  it('survives being handed a non-string', () => {
    expect(findRepoReference(undefined as any)).toBeNull();
    expect(findRepoReference(null as any)).toBeNull();
    expect(findRepoReference(42 as any)).toBeNull();
  });
});
