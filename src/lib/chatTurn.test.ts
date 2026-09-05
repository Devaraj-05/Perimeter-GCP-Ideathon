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
    newId: (role) => `id-${role}-${++n}`,
    nowIso: () => '2026-09-05T00:00:00.000Z',
    ...over,
  };
  return { deps, log, painted };
}

describe('Directive 6 — the composer is never cleared before a confirmed write', () => {
  it('clears the input only after save resolves', async () => {
    const { deps, log } = harness();
    await runChatTurn('hello', [], deps);
    expect(log.indexOf('clearInput')).toBeGreaterThan(log.indexOf('save'));
  });

  it('keeps the text when the model call fails', async () => {
    // The original defect: setFollowUpInput('') ran on the line BEFORE the
    // request. A failed send took the user's words with it.
    const { deps, log } = harness({
      send: async () => {
        throw new Error('503 UNAVAILABLE');
      },
    });
    const r = await runChatTurn('hello', [], deps);
    expect(log).not.toContain('clearInput');
    expect(r.failure!.stage).toBe('send');
  });

  it('keeps the text when the write fails', async () => {
    const { deps, log } = harness({
      save: async () => {
        throw new Error('permission-denied');
      },
    });
    await runChatTurn('hello', [], deps);
    expect(log).not.toContain('clearInput');
  });

  it('never clears when nothing was saved, whichever half failed', async () => {
    for (const broken of ['send', 'save'] as const) {
      const { deps, log } = harness({
        [broken]: async () => {
          throw new Error('boom');
        },
      } as Partial<RunTurnDeps>);
      await runChatTurn('hello', [], deps);
      expect(log, broken).not.toContain('clearInput');
    }
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

  it('rolls the optimistic user turn back when the send failed', async () => {
    // It never happened. Leaving it would show a message the model never saw,
    // and a retry would then send it twice.
    const prior: TurnMessage[] = [
      { id: 'a', role: 'user', text: 'earlier', timestamp: 'T' },
    ];
    const { deps } = harness({
      send: async () => {
        throw new Error('x');
      },
    });
    const r = await runChatTurn('hello', prior, deps);
    expect(r.turns).toEqual(prior);
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
