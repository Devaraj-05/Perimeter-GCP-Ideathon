import { describe, it, expect } from 'vitest';
import { buildConversationContents, buildSystemInstruction } from './conversation';

/**
 * G4 regression guard — multi-turn conversation is a graded Phase 2
 * requirement ("multi-turn AI interaction for brainstorming/journaling").
 *
 * It works today. The airlock rework in M3 touches the same code path, and the
 * failure mode that worries me is not a crash but a silent reduction to
 * single-shot: the app still replies, so nothing looks broken, and a scored
 * requirement is quietly gone.
 *
 * These tests exist so that would show up red instead.
 */

const base = { mode: 'companion', mood: 'Reflective', category: 'Personal' };

describe('multi-turn conversation (G4)', () => {
  it('a first message becomes a single user turn', () => {
    const contents = buildConversationContents({ ...base, content: 'Rough day today.', turns: [] });
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe('user');
    expect(contents[0].parts[0].text).toContain('Rough day today.');
  });

  it('REPLAYS prior turns as alternating roles, not one flattened string', () => {
    // This is the assertion that would fail if the conversation were reduced
    // to a single prompt containing a transcript.
    const contents = buildConversationContents({
      ...base,
      content: 'Rough day.',
      turns: [
        { role: 'user', text: 'Rough day.' },
        { role: 'model', text: 'What made it hard?' },
        { role: 'user', text: 'The deploy kept failing.' },
      ],
    });

    expect(contents).toHaveLength(3);
    expect(contents.map((c) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('carries the earlier turns into a later request, so context is preserved', () => {
    const contents = buildConversationContents({
      ...base,
      content: 'Rough day.',
      turns: [
        { role: 'user', text: 'Rough day.' },
        { role: 'model', text: 'What made it hard?' },
        { role: 'user', text: 'The deploy kept failing.' },
      ],
    });

    const all = contents.map((c) => c.parts[0].text).join('\n');
    expect(all).toContain('What made it hard?');
    expect(all).toContain('The deploy kept failing.');
  });

  it('attaches the context header to the first turn only', () => {
    const contents = buildConversationContents({
      ...base,
      content: 'Rough day.',
      turns: [
        { role: 'user', text: 'Rough day.' },
        { role: 'model', text: 'Tell me more.' },
      ],
    });

    expect(contents[0].parts[0].text).toContain('[User Context:');
    expect(contents[1].parts[0].text).not.toContain('[User Context:');
  });

  it('includes mood, category and mode in the context header', () => {
    const contents = buildConversationContents({
      content: 'x',
      mode: 'socratic',
      mood: 'Curious',
      category: 'Learning',
      turns: [],
    });
    const text = contents[0].parts[0].text;
    expect(text).toContain('Curious');
    expect(text).toContain('Learning');
    expect(text).toContain('socratic');
  });

  it('treats any non-user role as model, never dropping the turn', () => {
    const contents = buildConversationContents({
      ...base,
      content: '',
      turns: [{ role: 'assistant', text: 'reply' }],
    });
    expect(contents).toHaveLength(1);
    expect(contents[0].role).toBe('model');
  });

  it('skips malformed turns without discarding the rest of the conversation', () => {
    const contents = buildConversationContents({
      ...base,
      content: '',
      turns: [
        { role: 'user', text: 'kept' },
        { role: 'user' },
        { text: 'no role' },
        null as any,
        { role: 'model', text: 'also kept' },
      ],
    });
    expect(contents).toHaveLength(2);
    expect(contents.map((c) => c.parts[0].text)).toEqual(['kept', 'also kept']);
  });

  it('handles a malformed turns value without throwing', () => {
    expect(() =>
      buildConversationContents({ ...base, content: 'x', turns: null as any }),
    ).not.toThrow();
  });
});

describe('reflection modes', () => {
  it('every mode produces a distinct system instruction', () => {
    const modes = ['companion', 'brainstorm', 'socratic', 'gratitude_wellness', 'executive_summary'];
    const instructions = modes.map(buildSystemInstruction);
    expect(new Set(instructions).size).toBe(modes.length);
  });

  it('an unknown mode falls back to the base instruction rather than failing', () => {
    expect(buildSystemInstruction('nonsense')).toBe(buildSystemInstruction('companion'));
  });
});
