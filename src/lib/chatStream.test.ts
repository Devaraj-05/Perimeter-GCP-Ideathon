import { describe, it, expect } from 'vitest';
import { makeStreamReducer } from './chatStream';

/**
 * INV-20 at the receiving end.
 *
 * The server sends the verdict first. A client that would render text anyway
 * if it did not is a client where the invariant holds only by the server's
 * good behaviour, so the rule is enforced on both sides of the wire.
 */

describe('the taint verdict must precede any text', () => {
  it('accepts meta, then deltas', () => {
    const seen: string[] = [];
    let taint: boolean | null = null;
    const r = makeStreamReducer({
      onMeta: (m) => (taint = m.turnTaint),
      onDelta: (t) => seen.push(t),
    });
    r.push({ type: 'meta', turnTaint: true, contextIds: ['a'] });
    r.push({ type: 'delta', text: 'hi' });
    expect(taint).toBe(true);
    expect(seen).toEqual(['hi']);
  });

  it('refuses a delta that arrives before the verdict', () => {
    const r = makeStreamReducer({});
    expect(() => r.push({ type: 'delta', text: 'hi' })).toThrow(/before its safety verdict/);
  });

  it('surfaces an error record as an error', () => {
    const r = makeStreamReducer({});
    expect(() => r.push({ type: 'error', error: 'quota spent' })).toThrow('quota spent');
  });

  it('has no result until a final record arrives', () => {
    const r = makeStreamReducer({});
    r.push({ type: 'meta', turnTaint: false, contextIds: [] });
    r.push({ type: 'delta', text: 'partial' });
    expect(r.result()).toBeNull();
  });

  it('takes the final record as authoritative over the deltas', () => {
    const seen: string[] = [];
    const r = makeStreamReducer({ onDelta: (t) => seen.push(t) });
    r.push({ type: 'meta', turnTaint: false, contextIds: [] });
    r.push({ type: 'delta', text: 'par' });
    r.push({ type: 'final', reply: 'the whole answer', modelUsed: 'm', turnTaint: false });
    expect(r.result()!.reply).toBe('the whole answer');
    expect(seen).toEqual(['par']);
  });

  it('coerces a malformed final rather than trusting its shape', () => {
    const r = makeStreamReducer({});
    r.push({ type: 'meta', turnTaint: false, contextIds: [] });
    r.push({ type: 'final', reply: null, threatEvents: 'not an array', turnTaint: 'yes' });
    expect(r.result()).toEqual({
      reply: '',
      modelUsed: '',
      turnTaint: false,
      threatEvents: [],
      contextIds: [],
      timestamp: undefined,
    });
  });

  it('ignores records it does not recognise', () => {
    const r = makeStreamReducer({});
    expect(() => {
      r.push({ type: 'something_new' });
      r.push(null);
      r.push('nonsense');
    }).not.toThrow();
  });

  it('drops an empty delta rather than painting it', () => {
    const seen: string[] = [];
    const r = makeStreamReducer({ onDelta: (t) => seen.push(t) });
    r.push({ type: 'meta', turnTaint: false, contextIds: [] });
    r.push({ type: 'delta', text: '' });
    expect(seen).toEqual([]);
  });
});
