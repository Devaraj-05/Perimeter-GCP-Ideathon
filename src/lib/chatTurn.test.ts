import { describe, it, expect } from 'vitest';
import { runChatTurn, defaultNewId, type RunTurnDeps, type ChatReply } from './chatTurn';
import type { TurnMessage } from '../types';

/**
 * The two data-loss defects that lived in JournalEditor, pinned.
 *
 * Both were breaches of Directive 6, which is binding. Neither was catchable
 * before this logic came out of the component: JournalEditor has no test file
 * and the project's render tests use renderToStaticMarkup, which cannot drive
 * a form submission.
 */

const REPLY: ChatReply = {
  reply: 'a reply',
  modelUsed: 'gemini-3.6-flash',
  timestamp: '2026-09-05T00:00:00.000Z',
  threatEvents: [],
  turnTaint: false,
};

/** Records every effect so ORDER can be asserted, not just final state. */
function harness(over: Partial<RunTurnDeps> = {}) {
  const log: string[] = [];
  const painted: TurnMessage[][] = [];
  let n = 0;
  const deps: RunTurnDeps = {
    send: async (t) => {
      log.push('send');
      painted.push(t);
      return REPLY;
    },
    save: async () => {
      log.push('save');
    },
    onTurns: (t) => {
      log.push(`paint:${t.length}`);
      painted.push(t);
    },
    clearInput: () => {
      log.push('clearInput');
    },
    restoreInput: (t) => {
      log.push(`restoreInput:${t}`);
    },
    newId: (role) => `id-${role}-${++n}`,
    nowIso: () => '2026-09-05T00:00:00.000Z',
    ...over,
  };
  return { deps, log, painted };
}

describe('Directive 6 via Amendment R.1 — the text is never lost', () => {
  // The guarantee did not change; the way it is met did. The composer clears
  // at the echo so pressing send has an effect in the same frame, and the
  // submitted text is restored verbatim on every path that does not end in a
  // confirmed write. The property under test is RECOVERABILITY: after any
  // outcome, what the user typed is either in the transcript as a delivered
  // message or back in the composer.

  it('clears the composer at the echo, before the model is called', async () => {
    const { deps, log } = harness();
    await runChatTurn('hello', [], deps);
    expect(log.indexOf('clearInput')).toBeLessThan(log.indexOf('send'));
  });

  it('restores the text verbatim when the model call fails', async () => {
    // The original defect: setFollowUpInput('') ran on the line BEFORE the
    // request and nothing put it back. A failed send took the user's words.
    const { deps, log } = harness({
      send: async () => {
        throw new Error('503 UNAVAILABLE');
      },
    });
    const r = await runChatTurn('hello', [], deps);
    expect(log).toContain('restoreInput:hello');
    expect(r.failure!.stage).toBe('send');
  });

  it('restores the text when preparation fails', async () => {
    const { deps, log } = harness({
      prepare: async () => {
        throw new Error('mailbox unreachable');
      },
    });
    const r = await runChatTurn('hello', [], deps);
    expect(log).toContain('restoreInput:hello');
    expect(log).not.toContain('send');
    expect(r.failure!.stage).toBe('send');
  });

  it('does NOT restore when only the write failed - the reply is on screen', async () => {
    // Nothing is lost here: the message and its reply are both in the
    // transcript. Putting the text back would offer to send it a second time.
    const { deps, log } = harness({
      save: async () => {
        throw new Error('permission-denied');
      },
    });
    const r = await runChatTurn('hello', [], deps);
    expect(log.some((l) => l.startsWith('restoreInput'))).toBe(false);
    expect(r.turns.at(-1)!.text).toBe('a reply');
  });

  it('whatever failed, the text is recoverable', async () => {
    for (const broken of ['send', 'save', 'prepare'] as const) {
      const { deps, log, painted } = harness({
        [broken]: async () => {
          throw new Error('boom');
        },
      } as Partial<RunTurnDeps>);
      const r = await runChatTurn('hello', [], deps);
      const restored = log.includes('restoreInput:hello');
      const inTranscript = r.turns.some((t) => t.role === 'user' && t.text === 'hello');
      expect(restored || inTranscript, broken).toBe(true);
      expect(painted.length, broken).toBeGreaterThan(0);
    }
  });

  it('the echo is painted before anything is awaited', async () => {
    const order: string[] = [];
    const { deps } = harness({
      onTurns: () => order.push('paint'),
      prepare: async () => {
        order.push('prepare');
      },
      send: async () => {
        order.push('send');
        return REPLY;
      },
    });
    await runChatTurn('hello', [], deps);
    // This is the whole point of R.1: a slow mailbox read used to sit between
    // the user pressing send and their own message appearing.
    expect(order[0]).toBe('paint');
    expect(order.indexOf('paint')).toBeLessThan(order.indexOf('prepare'));
  });
});

describe('Directive 6 — a failure says which half failed', () => {
  it('reports a save failure as a save failure, not as a send failure', async () => {
    // The original defect: one try/catch covered both calls, so a failed write
    // surfaced as "Failed to send message to Gemini." The message had sent.
    const { deps } = harness({
      save: async () => {
        throw new Error('permission-denied');
      },
    });
    const r = await runChatTurn('hello', [], deps);
    expect(r.failure!.stage).toBe('save');
    expect(r.failure!.message).not.toMatch(/send/i);
  });

  it('a save failure flags the reply as at risk; a send failure does not', async () => {
    const saveBroken = harness({
      save: async () => {
        throw new Error('x');
      },
    });
    expect((await runChatTurn('h', [], saveBroken.deps)).failure!.replyAtRisk).toBe(true);

    const sendBroken = harness({
      send: async () => {
        throw new Error('x');
      },
    });
    expect((await runChatTurn('h', [], sendBroken.deps)).failure!.replyAtRisk).toBe(false);
  });

  it('keeps the reply visible when only the write failed', async () => {
    // Discarding it would destroy the thing the user waited for.
    const { deps } = harness({
      save: async () => {
        throw new Error('x');
      },
    });
    const r = await runChatTurn('hello', [], deps);
    expect(r.turns.at(-1)!.role).toBe('model');
    expect(r.turns.at(-1)!.text).toBe('a reply');
    expect(r.reply).toBeDefined();
  });

  it('keeps the user turn when the send failed, marked undelivered', async () => {
    // Amendment R.2. This used to roll back to `prior`, which deleted what the
    // user had just written. Watching your own question vanish reads as data
    // loss; the message stays and says it was not delivered.
    const prior: TurnMessage[] = [
      { id: 'a', role: 'user', text: 'earlier', timestamp: 'T' },
    ];
    const { deps } = harness({
      send: async () => {
        throw new Error('x');
      },
    });
    const r = await runChatTurn('hello', prior, deps);
    expect(r.turns).toHaveLength(2);
    expect(r.turns[0]).toEqual(prior[0]);
    expect(r.turns[1]).toMatchObject({ role: 'user', text: 'hello', undelivered: true });
    expect(r.turns.some((t) => t.role === 'model')).toBe(false);
  });

  it('carries the underlying message rather than a generic one', async () => {
    const { deps } = harness({
      send: async () => {
        throw new Error('The Gemini free-tier daily quota for this project is spent.');
      },
    });
    const r = await runChatTurn('h', [], deps);
    expect(r.failure!.message).toContain('daily quota');
  });

  it('falls back to a specific sentence when the error carries none', async () => {
    const { deps } = harness({
      send: async () => {
        throw new Error('');
      },
    });
    const r = await runChatTurn('h', [], deps);
    expect(r.failure!.message).toMatch(/not sent/i);
  });
});

describe('the transcript is painted optimistically', () => {
  it('shows the user turn before the model is called', async () => {
    const { deps, log } = harness();
    await runChatTurn('hello', [], deps);
    expect(log.indexOf('paint:1')).toBeLessThan(log.indexOf('send'));
  });

  it('appends rather than replacing prior turns', async () => {
    const prior: TurnMessage[] = [{ id: 'a', role: 'user', text: 'earlier', timestamp: 'T' }];
    const r = await runChatTurn('hello', prior, harness().deps);
    expect(r.turns.map((t) => t.text)).toEqual(['earlier', 'hello', 'a reply']);
  });
});

describe('message ids do not collide', () => {
  it('two ids generated in the same millisecond differ', () => {
    // `msg-${Date.now()}-u` collided, and colliding React keys render the
    // wrong message under the wrong node.
    const ids = new Set(Array.from({ length: 500 }, () => defaultNewId('user')));
    expect(ids.size).toBe(500);
  });

  it('user and model ids are distinguishable', () => {
    expect(defaultNewId('user')).toContain('-user-');
    expect(defaultNewId('model')).toContain('-model-');
  });
});

describe('streaming and stopping — Amendment L', () => {
  it('reports text as it arrives, cumulatively', async () => {
    const seen: string[] = [];
    const { deps } = harness({
      send: async (_t, onDelta) => {
        onDelta('Hel');
        onDelta('lo ');
        onDelta('world');
        return REPLY;
      },
      onStreamingText: (t) => seen.push(t),
    });
    await runChatTurn('hi', [], deps);
    expect(seen).toEqual(['Hel', 'Hello ', 'Hello world']);
  });

  it('a non-streaming send simply never reports partial text', async () => {
    const seen: string[] = [];
    const { deps } = harness({ onStreamingText: (t) => seen.push(t) });
    const r = await runChatTurn('hi', [], deps);
    expect(seen).toEqual([]);
    expect(r.turns.at(-1)!.text).toBe('a reply');
  });

  it('the saved turn is the final reply, not the accumulated deltas', async () => {
    // The 'final' record is authoritative. A client that stitched deltas and
    // saved those would persist something the server never agreed to.
    const { deps } = harness({
      send: async (_t, onDelta) => {
        onDelta('partial');
        return { ...REPLY, reply: 'the whole answer' };
      },
    });
    const r = await runChatTurn('hi', [], deps);
    expect(r.turns.at(-1)!.text).toBe('the whole answer');
  });

  it('stopping is not failing', async () => {
    class Aborted extends Error {}
    const { deps, log } = harness({
      send: async (_t, onDelta) => {
        onDelta('half an ans');
        throw new Aborted();
      },
      isAbort: (e) => e instanceof Aborted,
    });
    const r = await runChatTurn('hi', [], deps);
    expect(r.failure!.stage).toBe('aborted');
    expect(log).not.toContain('save');
    // Cleared at the echo, then put straight back - nothing to retype.
    expect(log).toContain('restoreInput:hi');
  });

  it('an abort keeps the question and discards only the half-answer', async () => {
    class Aborted extends Error {}
    const prior: TurnMessage[] = [{ id: 'a', role: 'user', text: 'earlier', timestamp: 'T' }];
    const { deps } = harness({
      send: async (_t, onDelta) => {
        onDelta('discard me');
        throw new Aborted();
      },
      isAbort: (e) => e instanceof Aborted,
    });
    const r = await runChatTurn('hi', prior, deps);
    expect(r.turns[0]).toEqual(prior[0]);
    expect(r.turns[1]).toMatchObject({ role: 'user', text: 'hi', undelivered: true });
    // INV-20: the partial reply is not in the transcript and was never saved.
    expect(r.turns.some((t) => t.text === 'discard me')).toBe(false);
    expect(r.reply).toBeUndefined();
  });

  it('a partial reply is never persisted', async () => {
    // INV-20. Whatever streamed, nothing reaches save unless the turn finished.
    class Aborted extends Error {}
    const saved: TurnMessage[][] = [];
    const { deps } = harness({
      send: async (_t, onDelta) => {
        onDelta('leaked?');
        throw new Aborted();
      },
      isAbort: (e) => e instanceof Aborted,
      save: async (t) => {
        saved.push(t);
      },
    });
    await runChatTurn('hi', [], deps);
    expect(saved).toEqual([]);
  });

  it('an error that is not an abort is still a send failure', async () => {
    class Aborted extends Error {}
    const { deps } = harness({
      send: async () => {
        throw new Error('503');
      },
      isAbort: (e) => e instanceof Aborted,
    });
    expect((await runChatTurn('hi', [], deps)).failure!.stage).toBe('send');
  });
});

describe('attachments and findings ride with the turn', () => {
  it('puts attachments on the user message', async () => {
    const { deps } = harness();
    const r = await runChatTurn('explain this', [], deps, {
      attachments: [{ id: 'a1', title: 'document.pdf', kind: 'file' }],
    });
    expect(r.turns[0].role).toBe('user');
    expect(r.turns[0].attachments).toEqual([{ id: 'a1', title: 'document.pdf', kind: 'file' }]);
  });

  it('omits the field entirely when there are none', async () => {
    // So an old saved turn and a new one with no attachments are identical.
    const r = await runChatTurn('hi', [], harness().deps);
    expect(r.turns[0]).not.toHaveProperty('attachments');
  });

  it('inserts a perimeter message per finding, right after the user turn', async () => {
    const { deps } = harness();
    const r = await runChatTurn('explain', [], deps, {
      findings: [
        { title: 'a.pdf', verdict: 'hostile', matches: [{ signal: 's', line: 1, excerpt: 'x' }] },
        { title: 'b.pdf', verdict: 'suspicious', matches: [] },
      ],
    });
    expect(r.turns.map((t) => t.role)).toEqual(['user', 'perimeter', 'perimeter', 'model']);
    expect(r.turns[1].finding!.title).toBe('a.pdf');
  });

  it('shows the finding before the model has been called', async () => {
    // It needs no model. Making the user wait for one to be told what is in
    // their own document would be gratuitous.
    const { deps, log } = harness();
    await runChatTurn('x', [], deps, {
      findings: [{ title: 'a.pdf', verdict: 'hostile', matches: [] }],
    });
    expect(log.indexOf('paint:2')).toBeLessThan(log.indexOf('send'));
  });

  it('never sends a perimeter message to the model', async () => {
    // Our own text about the conversation, not part of it. Feeding it back
    // would let the Planner reason about — or contradict — the scan.
    let sawRoles: string[] = [];
    const { deps } = harness({
      send: async (turns) => {
        sawRoles = turns.map((t) => t.role);
        return REPLY;
      },
    });
    await runChatTurn('x', [], deps, {
      findings: [{ title: 'a.pdf', verdict: 'hostile', matches: [] }],
    });
    expect(sawRoles).toEqual(['user']);
  });

  it('still persists the perimeter messages', async () => {
    // They are part of the transcript the user reads back.
    let saved: string[] = [];
    const { deps } = harness({
      save: async (turns) => {
        saved = turns.map((t) => t.role);
      },
    });
    await runChatTurn('x', [], deps, {
      findings: [{ title: 'a.pdf', verdict: 'hostile', matches: [] }],
    });
    expect(saved).toEqual(['user', 'perimeter', 'model']);
  });

  it('keeps perimeter messages when the send fails', async () => {
    // Amendment R.2. These were rolled back with the user turn, so a failed
    // turn erased the findings the scanner had already proved - the evidence
    // this product exists to show, deleted because a model call failed.
    const { deps } = harness({
      send: async () => {
        throw new Error('503');
      },
    });
    const r = await runChatTurn('x', [], deps, {
      findings: [{ title: 'a.pdf', verdict: 'hostile', matches: [] }],
    });
    expect(r.turns.map((t) => t.role)).toEqual(['user', 'perimeter']);
    expect(r.turns[0].undelivered).toBe(true);
  });
});
