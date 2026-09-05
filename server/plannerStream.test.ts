import { describe, it, expect } from 'vitest';
import { consumeLadder, LadderExhausted, type StreamChunk } from './plannerStream';

/**
 * The commit rule — Amendment L, INV-20 — against fake streams.
 *
 * The property that matters is not "it retries". It is that it STOPS retrying
 * the instant a token has been shown to the user, because a token written to
 * the response cannot be withdrawn and a second attempt would stitch two
 * different answers together on screen.
 */

const MODELS = ['m1', 'm2', 'm3'] as const;

/** A stream that yields, then optionally throws partway. */
function fake(chunks: StreamChunk[], throwAfter?: number): AsyncIterable<StreamChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      // The bound is the throw point, not the chunk count, so throwAfter: 0
      // models a stream that dies before producing anything at all.
      for (let i = 0; ; i++) {
        if (throwAfter !== undefined && i === throwAfter) throw new Error('mid-stream 503');
        if (i >= chunks.length) return;
        yield chunks[i];
      }
    },
  };
}

const text = (...s: string[]): StreamChunk[] => s.map((t) => ({ text: t }));

const base = {
  models: MODELS,
  isRecoverable: () => true,
  onDelta: () => {},
};

describe('before the first chunk, the ladder behaves normally', () => {
  it('falls to the next model when opening fails', async () => {
    const tried: string[] = [];
    const r = await consumeLadder({
      ...base,
      open: async (m) => {
        tried.push(m);
        if (m === 'm1') throw new Error('503');
        return fake(text('hi'));
      },
    });
    expect(tried).toEqual(['m1', 'm2']);
    expect(r.modelUsed).toBe('m2');
  });

  it('falls to the next model when the FIRST pull fails', async () => {
    // Distinct from open() failing: the connection was made and then died
    // before producing anything. Nothing has been shown, so this is still a
    // clean retry.
    const r = await consumeLadder({
      ...base,
      open: async (m) => (m === 'm1' ? fake([], 0) : fake(text('ok'))),
    });
    expect(r.modelUsed).toBe('m2');
  });

  it('emits nothing at all for a model that failed before committing', async () => {
    // The user must not see a fragment of an answer that was then abandoned.
    const seen: string[] = [];
    await consumeLadder({
      ...base,
      onDelta: (t) => seen.push(t),
      open: async (m) => (m === 'm1' ? fake([], 0) : fake(text('real answer'))),
    });
    expect(seen).toEqual(['real answer']);
  });

  it('does not retry an unrecoverable failure', async () => {
    const tried: string[] = [];
    await expect(
      consumeLadder({
        ...base,
        isRecoverable: () => false,
        open: async (m) => {
          tried.push(m);
          throw new Error('400 bad request');
        },
      }),
    ).rejects.toThrow('400 bad request');
    expect(tried).toEqual(['m1']);
  });

  it('never retries a fatal error, even a recoverable-looking one', async () => {
    // A perimeter violation means something is architecturally wrong and we
    // want to be told, not to have it retried three times and hidden.
    class PerimeterViolation extends Error {}
    const tried: string[] = [];
    await expect(
      consumeLadder({
        ...base,
        isRecoverable: () => true,
        isFatal: (e) => e instanceof PerimeterViolation,
        open: async (m) => {
          tried.push(m);
          throw new PerimeterViolation('INV-1');
        },
      }),
    ).rejects.toThrow('INV-1');
    expect(tried).toEqual(['m1']);
  });

  it('throws LadderExhausted carrying the last error when every model fails', async () => {
    const err = await consumeLadder({
      ...base,
      open: async () => {
        throw new Error('last one');
      },
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LadderExhausted);
    expect((err as LadderExhausted).lastError).toMatchObject({ message: 'last one' });
  });
});

describe('after the first chunk, the ladder is closed', () => {
  it('does NOT fall back when the stream dies mid-answer', async () => {
    // The whole point. Falling back here would append a second model's answer
    // to the half of the first one already on the user's screen.
    const tried: string[] = [];
    await expect(
      consumeLadder({
        ...base,
        open: async (m) => {
          tried.push(m);
          return fake(text('half an ', 'answer'), 1);
        },
      }),
    ).rejects.toThrow('mid-stream 503');
    expect(tried).toEqual(['m1']);
  });

  it('keeps what was already emitted rather than replaying it', async () => {
    const seen: string[] = [];
    await consumeLadder({
      ...base,
      onDelta: (t) => seen.push(t),
      open: async () => fake(text('a', 'b'), 2),
    }).catch(() => undefined);
    expect(seen).toEqual(['a', 'b']);
  });
});

describe('aggregation matches what the broker expects', () => {
  it('joins text in order with no separator', async () => {
    const r = await consumeLadder({ ...base, open: async () => fake(text('Hel', 'lo ', 'world')) });
    expect(r.response.text).toBe('Hello world');
  });

  it('collects function calls from every chunk', async () => {
    // The broker must see the COMPLETE call list. A tool authorised on a
    // partial response would breach INV-4 and INV-6.
    const r = await consumeLadder({
      ...base,
      open: async () =>
        fake([
          { text: 'thinking' },
          { functionCalls: [{ name: 'create_note', args: { title: 'x' } }] },
          { functionCalls: [{ name: 'send_digest', args: {} }] },
        ]),
    });
    expect(r.response.functionCalls.map((c) => c.name)).toEqual(['create_note', 'send_digest']);
  });

  it('yields empty text and no calls for an empty stream rather than throwing', async () => {
    const r = await consumeLadder({ ...base, open: async () => fake([]) });
    expect(r.response).toEqual({ text: '', functionCalls: [] });
  });

  it('skips empty text fragments without emitting them', async () => {
    const seen: string[] = [];
    const r = await consumeLadder({
      ...base,
      onDelta: (t) => seen.push(t),
      open: async () => fake([{ text: '' }, { text: 'x' }, {}]),
    });
    expect(seen).toEqual(['x']);
    expect(r.response.text).toBe('x');
  });
});
