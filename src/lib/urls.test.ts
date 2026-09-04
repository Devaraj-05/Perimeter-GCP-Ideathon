import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractUrls, mentionsUrl, MAX_URLS_PER_MESSAGE } from './urls';

/**
 * The web-search toggle.
 *
 * The dangerous mistake here is not a bad regex — it is applying this to the
 * wrong text. A link inside untrusted content is an attacker choosing what our
 * server fetches; following one hands them a fetch primitive aimed wherever
 * they like. The last block asserts, at the source level, that extraction is
 * only ever run on the user's own composer input.
 */

describe('extraction', () => {
  it('finds a plain link', () => {
    expect(extractUrls('read https://example.com/post please')).toEqual([
      'https://example.com/post',
    ]);
  });

  it('drops sentence punctuation that is not part of the address', () => {
    expect(extractUrls('see https://example.com.')).toEqual(['https://example.com']);
    expect(extractUrls('(https://example.com), maybe')).toEqual(['https://example.com']);
    expect(extractUrls('https://example.com?')).toEqual(['https://example.com']);
  });

  it('keeps balanced brackets that belong to the URL', () => {
    const wiki = 'https://en.wikipedia.org/wiki/Foo_(bar)';
    expect(extractUrls(`see ${wiki}`)).toEqual([wiki]);
  });

  it('deduplicates', () => {
    expect(extractUrls('https://a.com and https://a.com again')).toEqual(['https://a.com']);
  });

  it(`caps at ${MAX_URLS_PER_MESSAGE}`, () => {
    const many = Array.from({ length: 40 }, (_, i) => `https://e${i}.com`).join(' ');
    expect(extractUrls(many)).toHaveLength(MAX_URLS_PER_MESSAGE);
  });

  it.each([
    ['no links', 'just some words'],
    ['empty', ''],
    ['a bare hostname', 'visit example.com today'],
    ['a file path', 'open /etc/passwd'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['file:', 'file:///etc/passwd'],
    ['ftp:', 'ftp://example.com/x'],
  ])('finds nothing in %s', (_label, text) => {
    expect(extractUrls(text)).toEqual([]);
  });

  it('handles adversarial input without throwing', () => {
    for (const junk of ['https://', 'http://[', 'https://'.repeat(500), '\u0000']) {
      expect(() => extractUrls(junk)).not.toThrow();
    }
  });

  it('mentionsUrl agrees with extractUrls', () => {
    expect(mentionsUrl('see https://a.com')).toBe(true);
    expect(mentionsUrl('nothing here')).toBe(false);
  });
});

describe('extraction is applied ONLY to what the user typed', () => {
  const strip = (t: string) =>
    t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const EDITOR = strip(
    readFileSync(join(process.cwd(), 'src', 'components', 'JournalEditor.tsx'), 'utf8'),
  );

  it('is called on the composer input and nothing else', () => {
    const calls = EDITOR.match(/extractUrls\(([^)]*)\)/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // The allowlist is explicit and each name means "the user authored this":
      // followUpText/followUpInput are the composer, pastedByUser is what they
      // pasted into it. Anything else — an artifact body, a turn, an attachment
      // preview — is attacker-reachable and must never be scanned for links.
      // userTypedText is the parameter of the one shared fetch helper. It is
      // named that way so this check still reads as a claim about authorship
      // rather than a claim about a variable. Widen this list only for a name
      // that asserts the user wrote the text.
      expect(call).toMatch(
        /extractUrls\((followUpText|followUpInput|pastedByUser|userTypedText)\)/,
      );
    }
  });

  it('is never applied to a turn, an artifact or an attachment', () => {
    expect(EDITOR).not.toMatch(/extractUrls\(\s*turn/);
    expect(EDITOR).not.toMatch(/extractUrls\(\s*content/);
    expect(EDITOR).not.toMatch(/extractUrls\([^)]*attachment/i);
    expect(EDITOR).not.toMatch(/extractUrls\([^)]*body/i);
  });
});
