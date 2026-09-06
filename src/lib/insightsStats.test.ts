import { describe, it, expect } from 'vitest';
import {
  countWords,
  wordsInEntry,
  distribution,
  weeklyActivity,
  summarise,
  abbreviate,
  humanise,
} from './insightsStats';
import type { JournalEntry, TurnMessage } from '../types';

const turn = (role: TurnMessage['role'], text: string): TurnMessage => ({
  id: `${role}-${text.slice(0, 6)}`,
  role,
  text,
  timestamp: '2026-09-01T00:00:00.000Z',
});

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  id: 'e1',
  userId: 'u1',
  title: 'Untitled',
  content: '',
  category: 'Personal',
  mode: 'companion',
  turns: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('countWords', () => {
  it('counts words, not characters', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('an empty or blank string is zero words, not one', () => {
    // The old inline version split "" on whitespace and got [""] — length 1.
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('\n\t ')).toBe(0);
  });

  it('collapses runs of whitespace', () => {
    expect(countWords('one    two\n\nthree')).toBe(3);
  });

  it('is total on non-strings', () => {
    for (const bad of [undefined, null, 42, {}, []] as unknown[]) {
      expect(countWords(bad)).toBe(0);
    }
  });
});

describe('wordsInEntry — the defect this page existed with', () => {
  it('counts what the user typed in the CHAT, not just the content field', () => {
    // The bug, exactly: this product is a chat. Almost nobody writes into
    // `content`, so a real account with months of conversation reported
    // "Words Written: 0".
    const e = entry({
      content: '',
      turns: [turn('user', 'is there any mail about the deadline'), turn('model', 'Yes — two.')],
    });
    expect(wordsInEntry(e)).toBe(7);
  });

  it('excludes the model’s replies', () => {
    // A measure of what the person wrote. Counting Gemini's output would
    // flatter the number into meaninglessness.
    const e = entry({
      turns: [turn('user', 'one two'), turn('model', 'a b c d e f g h i j')],
    });
    expect(wordsInEntry(e)).toBe(2);
  });

  it('excludes Perimeter’s own finding messages', () => {
    const e = entry({
      turns: [turn('user', 'one two'), turn('perimeter', 'three four five six')],
    });
    expect(wordsInEntry(e)).toBe(2);
  });

  it('adds the content field when there is one', () => {
    const e = entry({ content: 'a b c', turns: [turn('user', 'd e')] });
    expect(wordsInEntry(e)).toBe(5);
  });

  it('handles an entry with no turns at all', () => {
    expect(wordsInEntry(entry({ content: 'just prose here' }))).toBe(3);
    expect(wordsInEntry(entry())).toBe(0);
  });
});

describe('distribution', () => {
  it('counts and ranks, highest first', () => {
    const d = distribution(['a', 'b', 'a', 'c', 'a', 'b']);
    expect(d.map((s) => s.label)).toEqual(['a', 'b', 'c']);
    expect(d.map((s) => s.count)).toEqual([3, 2, 1]);
  });

  it('breaks count ties alphabetically so the order does not shuffle', () => {
    const d = distribution(['zebra', 'apple']);
    expect(d.map((s) => s.label)).toEqual(['apple', 'zebra']);
  });

  it('percentages are whole numbers of the total', () => {
    const d = distribution(['a', 'a', 'b', 'b']);
    expect(d.every((s) => s.pct === 50)).toBe(true);
  });

  it('rounded percentages need not total 100, and that is correct', () => {
    // Three equal slices are 33% each. Fudging one to 34 to reach 100 would be
    // a lie told to a rounding artefact.
    const d = distribution(['a', 'b', 'c']);
    expect(d.map((s) => s.pct)).toEqual([33, 33, 33]);
  });

  it('ignores blanks and non-strings rather than counting an empty category', () => {
    const d = distribution(['a', '', '   ', undefined, null, 'a']);
    expect(d).toEqual([{ label: 'a', count: 2, pct: 100 }]);
  });

  it('is empty for no input', () => {
    expect(distribution([])).toEqual([]);
  });
});

describe('weeklyActivity', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z'); // a Sunday

  it('returns one bucket per week, oldest first', () => {
    const weeks = weeklyActivity([], 12, now);
    expect(weeks).toHaveLength(12);
    const dates = weeks.map((w) => Date.parse(w.weekStart));
    expect([...dates].sort((a, b) => a - b)).toEqual(dates);
  });

  it('keeps empty weeks instead of compressing time', () => {
    // A gap is the most informative part of an activity chart. Dropping empty
    // weeks would draw a busy streak over a month of silence.
    const weeks = weeklyActivity([entry({ createdAt: '2026-09-02T00:00:00.000Z' })], 12, now);
    expect(weeks).toHaveLength(12);
    expect(weeks.filter((w) => w.count === 0)).toHaveLength(11);
  });

  it('puts an entry in the week it was created', () => {
    const weeks = weeklyActivity([entry({ createdAt: '2026-09-02T00:00:00.000Z' })], 12, now);
    expect(weeks.at(-1)).toEqual({ weekStart: '2026-08-31', count: 1 });
  });

  it('drops entries older than the window rather than piling them on week one', () => {
    const weeks = weeklyActivity([entry({ createdAt: '2020-01-01T00:00:00.000Z' })], 12, now);
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });

  it('ignores an unparseable date', () => {
    const weeks = weeklyActivity([entry({ createdAt: 'not a date' })], 12, now);
    expect(weeks.every((w) => w.count === 0)).toBe(true);
  });
});

describe('summarise', () => {
  const now = Date.parse('2026-09-06T12:00:00.000Z');

  it('reports a chat-only journal as having words', () => {
    // The end-to-end version of the bug: this is what the screenshot showed
    // as "Words Written: 0".
    const s = summarise(
      [entry({ content: '', turns: [turn('user', 'fetch today emails please')] })],
      now,
    );
    expect(s.wordCount).toBe(4);
    expect(s.entryCount).toBe(1);
  });

  it('counts every message as an exchange, both sides', () => {
    const s = summarise([entry({ turns: [turn('user', 'a'), turn('model', 'b')] })], now);
    expect(s.exchangeCount).toBe(2);
    expect(s.exchangesPerEntry).toBe(2);
  });

  it('exchanges per entry keeps one decimal', () => {
    const s = summarise(
      [entry({ id: 'a', turns: [turn('user', 'x')] }), entry({ id: 'b', turns: [] })],
      now,
    );
    expect(s.exchangesPerEntry).toBe(0.5);
  });

  it('never divides by zero on a new account', () => {
    const s = summarise([], now);
    expect(s.exchangesPerEntry).toBe(0);
    expect(s.entryCount).toBe(0);
    expect(s.wordCount).toBe(0);
    expect(s.categories).toEqual([]);
    expect(s.takeaways).toEqual([]);
    expect(s.busiestWeek).toBeNull();
    expect(s.activity).toHaveLength(12);
  });

  it('orders takeaways newest entry first', () => {
    const s = summarise(
      [
        entry({ id: 'old', updatedAt: '2026-08-01T00:00:00.000Z', insights: ['older'] }),
        entry({ id: 'new', updatedAt: '2026-09-05T00:00:00.000Z', insights: ['newer'] }),
      ],
      now,
    );
    expect(s.takeaways).toEqual(['newer', 'older']);
  });

  it('caps tags so a tag-happy account cannot flood the page', () => {
    const tags = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    const s = summarise([entry({ tags })], now);
    expect(s.tags).toHaveLength(12);
  });

  it('finds the busiest week', () => {
    const s = summarise(
      [
        entry({ id: '1', createdAt: '2026-09-02T00:00:00.000Z' }),
        entry({ id: '2', createdAt: '2026-09-03T00:00:00.000Z' }),
        entry({ id: '3', createdAt: '2026-08-25T00:00:00.000Z' }),
      ],
      now,
    );
    expect(s.busiestWeek).toEqual({ weekStart: '2026-08-31', count: 2 });
  });

  it('is total on rubbish input', () => {
    expect(() => summarise(undefined as never, now)).not.toThrow();
    expect(summarise(undefined as never, now).entryCount).toBe(0);
  });
});

describe('display helpers', () => {
  it('humanise turns a mode id into prose', () => {
    expect(humanise('companion')).toBe('Companion');
    expect(humanise('gratitude_wellness')).toBe('Gratitude wellness');
  });

  it('abbreviate keeps small numbers exact', () => {
    expect(abbreviate(0)).toBe('0');
    expect(abbreviate(999)).toBe('999');
  });

  it('abbreviate shortens large ones', () => {
    expect(abbreviate(1000)).toBe('1k');
    expect(abbreviate(1200)).toBe('1.2k');
    expect(abbreviate(1_000_000)).toBe('1m');
  });
});
