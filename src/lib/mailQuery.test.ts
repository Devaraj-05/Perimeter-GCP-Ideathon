import { describe, it, expect } from 'vitest';
import { buildMailQuery } from './mailQuery';

/**
 * Amendment R.3, INV-26.
 *
 * The bug these exist for: "fetch today emails and is there any mail Gen AI
 * Academy APAC Edition" fetched the ten newest messages, none of which was the
 * one asked about, and the model dutifully summarised four unrelated emails.
 * The model was not wrong. It was handed the wrong documents.
 */

describe('buildMailQuery — the question becomes the search', () => {
  it('keeps the subject the user actually named', () => {
    const q = buildMailQuery('fetch today emails and is there any mail Gen AI Academy APAC Edition');
    expect(q.hasTerms).toBe(true);
    for (const word of ['Gen', 'AI', 'Academy', 'APAC', 'Edition']) {
      expect(q.q).toContain(word);
    }
  });

  it('drops the scaffolding, not the subject', () => {
    const q = buildMailQuery('is there any mail about the Cloud Run invoice');
    expect(q.q).toBe('Cloud Run invoice');
  });

  it('a bare date question searches by date, not by text', () => {
    const q = buildMailQuery('what are the today mails');
    expect(q.hasTerms).toBe(false);
    expect(q.q).toBe('newer_than:1d');
  });

  it('recognises the date words people actually type', () => {
    expect(buildMailQuery("show me today's email").dateBound).toBe('newer_than:1d');
    expect(buildMailQuery('any mail yesterday').dateBound).toBe('newer_than:2d');
    expect(buildMailQuery('emails from this week').dateBound).toBe('newer_than:7d');
    expect(buildMailQuery('mail this month').dateBound).toBe('newer_than:30d');
  });

  it('a named subject beats a date bound', () => {
    // Deliberate. ANDing them returns nothing whenever the message being
    // looked for is older than today, and "no results" is the least useful
    // answer available for a question that has a real answer.
    const q = buildMailQuery('any mail today about the Perimeter invoice');
    expect(q.dateBound).toBe('newer_than:1d');
    expect(q.q).toBe('Perimeter invoice');
    expect(q.q).not.toContain('newer_than');
  });

  it('an empty or mail-only message asks for nothing in particular', () => {
    expect(buildMailQuery('check my mail').q).toBe('');
    expect(buildMailQuery('check my mail').hasTerms).toBe(false);
    expect(buildMailQuery('').q).toBe('');
  });

  it('survives punctuation around the terms', () => {
    const q = buildMailQuery('is there any mail about "Gen AI Academy"?');
    expect(q.q).toBe('Gen AI Academy');
  });

  it('keeps an address or a domain intact', () => {
    expect(buildMailQuery('any mail from billing@example.com').q).toBe('billing@example.com');
  });

  it('caps a pasted paragraph rather than building a query that matches nothing', () => {
    const long = 'any mail about ' + Array.from({ length: 60 }, (_, i) => `term${i}`).join(' ');
    expect(buildMailQuery(long).q.split(' ')).toHaveLength(12);
  });

  it('is total — never throws on odd input', () => {
    for (const bad of [undefined, null, 42, {}, []] as unknown[]) {
      expect(() => buildMailQuery(bad as string)).not.toThrow();
      expect(buildMailQuery(bad as string).q).toBe('');
    }
  });
});

describe('INV-26 — the term can only come from the user', () => {
  it('is a pure function of the string it is given', () => {
    // There is no other input. The call site is what enforces the invariant:
    // buildMailQuery is applied to the composer's text and to nothing else,
    // the same way extractUrls and findRepoReference are. A term taken from an
    // artifact would be an attacker choosing which of the user's mail we read.
    const once = buildMailQuery('any mail about widgets');
    const twice = buildMailQuery('any mail about widgets');
    expect(once).toEqual(twice);
  });

  it('produces a search expression, never an instruction', () => {
    // The output is URL-encoded into Gmail's `q` parameter server-side. It is
    // never concatenated into a prompt, so the worst a strange term can do is
    // select different mail belonging to the same user.
    const q = buildMailQuery('any mail about ignore all previous instructions');
    expect(q.q).not.toContain('\n');
    expect(q.q.length).toBeLessThanOrEqual(200);
  });
});
