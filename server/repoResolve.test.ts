import { describe, it, expect } from 'vitest';
import { decide, toCandidate, isResolvableName, type RepoCandidate } from './repoResolve';

const candidate = (over: Partial<RepoCandidate> = {}): RepoCandidate => ({
  ref: 'someone/thing',
  description: null,
  private: false,
  stars: 0,
  owned: false,
  ...over,
});

describe('deciding is as much about refusing', () => {
  it('a single match is the answer', () => {
    const c = candidate();
    expect(decide([c])).toEqual({ kind: 'one', candidate: c });
  });

  it('no match is no match, not a guess', () => {
    expect(decide([])).toEqual({ kind: 'none' });
  });

  it('one OWNED match wins over any number of strangers', () => {
    // "my repo called api" means theirs.
    const mine = candidate({ ref: 'me/api', owned: true });
    const r = decide([candidate({ ref: 'a/api', stars: 9000 }), mine, candidate({ ref: 'b/api' })]);
    expect(r).toEqual({ kind: 'one', candidate: mine });
  });

  it('two owned matches is still a question', () => {
    // Ownership disambiguates; it does not decide between two of your own.
    const r = decide([
      candidate({ ref: 'me/api', owned: true }),
      candidate({ ref: 'me/api-v2', owned: true }),
    ]);
    expect(r.kind).toBe('many');
  });

  it('several strangers is a question, never a coin flip', () => {
    // Scanning the wrong repository is worse than scanning none: the user
    // gets a confident report about code they have never seen.
    const r = decide([candidate({ ref: 'a/api' }), candidate({ ref: 'b/api' })]);
    expect(r.kind).toBe('many');
  });

  it('leads the question with the most likely answer', () => {
    const r = decide([
      candidate({ ref: 'low/api', stars: 2 }),
      candidate({ ref: 'high/api', stars: 900 }),
      candidate({ ref: 'mid/api', stars: 50 }),
    ]);
    expect(r.kind).toBe('many');
    if (r.kind === 'many') expect(r.candidates.map((c) => c.ref)).toEqual([
      'high/api',
      'mid/api',
      'low/api',
    ]);
  });

  it('puts owned repositories first even when asking', () => {
    const r = decide([
      candidate({ ref: 'famous/api', stars: 9000 }),
      candidate({ ref: 'me/api', owned: true, stars: 0 }),
      candidate({ ref: 'me/api2', owned: true, stars: 1 }),
    ]);
    if (r.kind === 'many') expect(r.candidates[0].owned).toBe(true);
  });

  it('never asks about more than five', () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate({ ref: `o${i}/api` }));
    const r = decide(many);
    if (r.kind === 'many') expect(r.candidates.length).toBe(5);
  });
});

describe('shaping a GitHub row', () => {
  it('reads a well formed row', () => {
    const c = toCandidate(
      { full_name: 'me/api', description: 'a thing', private: true, stargazers_count: 7 },
      'me',
    );
    expect(c).toEqual({
      ref: 'me/api',
      description: 'a thing',
      private: true,
      stars: 7,
      owned: true,
    });
  });

  it('matches ownership case-insensitively', () => {
    expect(toCandidate({ full_name: 'Devaraj-05/x' }, 'devaraj-05')!.owned).toBe(true);
  });

  it('is not owned when nobody is signed in', () => {
    expect(toCandidate({ full_name: 'a/b' }, null)!.owned).toBe(false);
  });

  it('caps a description rather than carrying a whole README', () => {
    const c = toCandidate({ full_name: 'a/b', description: 'x'.repeat(5000) }, null);
    expect(c!.description!.length).toBe(200);
  });

  it.each([
    ['null', null],
    ['a string', 'a/b'],
    ['no full_name', { description: 'x' }],
    ['full_name not owner/name', { full_name: 'justaname' }],
    ['full_name too deep', { full_name: 'a/b/c' }],
  ])('%s is not a candidate', (_label, row) => {
    expect(toCandidate(row, null)).toBeNull();
  });

  it('defaults missing fields rather than trusting them', () => {
    const c = toCandidate({ full_name: 'a/b' }, null)!;
    expect(c).toMatchObject({ description: null, private: false, stars: 0 });
  });
});

describe('names we will look up at all', () => {
  it.each(['api', 'api-v2', 'Perimeter-GCP-Ideathon', 'a.b_c-1'])('%s is resolvable', (n) => {
    expect(isResolvableName(n)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['a slash', 'a/b'],
    ['a space', 'a b'],
    ['a quote', 'a"b'],
    ['a wildcard', 'a*'],
    ['too long', 'x'.repeat(101)],
  ])('%s is not', (_label, n) => {
    expect(isResolvableName(n)).toBe(false);
  });

  it('rejects anything that could alter the query it lands in', () => {
    // The name becomes a search query parameter. Nothing that could add a
    // qualifier or escape the term is looked up.
    for (const n of ['a+user:someone', 'a&per_page=100', 'a in:name', 'a\nb']) {
      expect(isResolvableName(n), n).toBe(false);
    }
  });
});
