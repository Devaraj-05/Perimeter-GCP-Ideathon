import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HistorySidebar } from './HistorySidebar';
import { Logo } from './Logo';
import type { JournalEntry } from '../types';

/**
 * The history rail, after the redesign.
 *
 * The panel used to render every entry as a bordered white card with its own
 * date badge. Stacked in a narrow column that reads as a grid of objects, not
 * as a history you scan — and because autoTitle only runs on a completed
 * exchange, most rows said "Untitled Reflection", so it was a column of
 * identical cards.
 *
 * These assert the properties that make it a rail: no per-row border, no
 * per-row date, and a label derived from what the user actually said.
 */

const entry = (over: Partial<JournalEntry> = {}): JournalEntry =>
  ({
    id: 'e1',
    userId: 'u1',
    title: '',
    content: '',
    category: 'Personal',
    mode: 'companion',
    turns: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }) as JournalEntry;

const render = (entries: JournalEntry[], activeId: string | null = null) =>
  renderToStaticMarkup(
    <HistorySidebar
      entries={entries}
      activeEntryId={activeId}
      onSelectEntry={() => {}}
      onNewEntry={() => {}}
      onDeleteEntry={() => {}}
      onRenameEntry={() => {}}
      isOpen
      onToggle={() => {}}
    />,
  );

describe('a row is a rail item, not a card', () => {
  it('renders the entry', () => {
    expect(render([entry({ title: 'Security audit' })])).toContain('Security audit');
  });

  it('carries no per-row border or white card fill', () => {
    // The two properties that made a list of entries read as a grid.
    const html = render([entry({ title: 'One' }), entry({ id: 'e2', title: 'Two' })]);
    const rows = html.match(/class="group [^"]*"/g) ?? [];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row).not.toMatch(/\bborder\b/);
      expect(row).not.toMatch(/bg-\[#fff|bg-white/);
    }
  });

  it('shows no date on the row', () => {
    // The group header above already says Today or Yesterday. Repeating it on
    // every row was the noise that made the panel feel heavy.
    const html = render([entry({ title: 'Only a title' })]);
    const today = new Date().toLocaleDateString([], { month: 'short', day: 'numeric' });
    const body = html.slice(html.indexOf('Only a title') - 400, html.indexOf('Only a title') + 400);
    expect(body).not.toContain(today);
  });

  it('marks the active row with a fill, not an inverted block', () => {
    const html = render([entry({ id: 'e1', title: 'Active one' })], 'e1');
    expect(html).toContain('bg-[var(--row-active)]');
    // The old treatment painted the whole row olive with white text, which
    // shouted louder than the conversation beside it.
    expect(html).not.toContain('bg-[#5a5a40] text-white rounded-br');
  });

  it('a row is reachable and operable by keyboard', () => {
    const html = render([entry({ title: 'Reachable' })]);
    expect(html).toMatch(/role="button"/);
    expect(html).toMatch(/tabindex="0"/i);
  });
});

describe('an entry without a title still says something useful', () => {
  it('falls back to what the user actually said', () => {
    const html = render([
      entry({
        turns: [
          { id: 't1', role: 'user', text: 'will you look into my repo', timestamp: 'T' },
          { id: 't2', role: 'model', text: 'Certainly.', timestamp: 'T' },
        ],
      }),
    ]);
    expect(html).toContain('will you look into my repo');
    expect(html).not.toContain('Untitled');
  });

  it('treats the stored placeholder as no title at all', () => {
    // JournalEditor.tsx:541 WRITES 'Untitled Reflection' when an entry has no
    // name, so the sidebar sees a real title and the fallback never fired —
    // which is why the rail was a column of identical rows on screen even
    // after the fallback was added. That file already treats the same string
    // as "not yet titled" when deciding whether to auto-name; this agrees.
    const html = render([
      entry({
        title: 'Untitled Reflection',
        turns: [{ id: 't', role: 'user', text: 'what does this repo do', timestamp: 'T' }],
      }),
    ]);
    expect(html).toContain('what does this repo do');
    expect(html).not.toContain('Untitled Reflection');
  });

  it('prefers a real title over the fallback', () => {
    const html = render([
      entry({
        title: 'Security audit',
        turns: [{ id: 't1', role: 'user', text: 'something else entirely', timestamp: 'T' }],
      }),
    ]);
    expect(html).toContain('Security audit');
    expect(html).not.toContain('something else entirely');
  });

  it('never uses a model turn as the label', () => {
    // The user's own words are what they will remember it by; the assistant's
    // opening line is the same on every entry.
    const html = render([
      entry({
        turns: [
          { id: 't1', role: 'model', text: 'How can I help you today?', timestamp: 'T' },
          { id: 't2', role: 'user', text: 'my actual question', timestamp: 'T' },
        ],
      }),
    ]);
    expect(html).toContain('my actual question');
    expect(html).not.toContain('How can I help you today?');
  });

  it('truncates a long first message rather than stretching the rail', () => {
    const long = 'x'.repeat(200);
    const html = render([entry({ turns: [{ id: 't', role: 'user', text: long, timestamp: 'T' }] })]);
    expect(html).not.toContain(long);
    expect(html).toContain('…');
  });

  it('collapses newlines so a pasted block stays one line', () => {
    const html = render([
      entry({ turns: [{ id: 't', role: 'user', text: 'line one\n\nline two', timestamp: 'T' }] }),
    ]);
    expect(html).toContain('line one line two');
  });

  it('falls back to the entry body when there are no turns', () => {
    expect(render([entry({ content: 'a written note' })])).toContain('a written note');
  });

  it('says something rather than nothing when the entry is empty', () => {
    expect(render([entry({})])).toContain('New reflection');
  });

  it('escapes a title rather than rendering it', () => {
    // A title is user-controlled and, after a rename, arbitrary.
    const html = render([entry({ title: '<img src="https://attacker.example/x.png">' })]);
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;img');
  });
});

describe('the primary action lives with the list it creates into', () => {
  it('is labelled, not a bare plus', () => {
    // It used to be a bare + here and a labelled button in the navbar: the
    // same action twice, one of them unlabelled.
    const html = render([]);
    expect(html).toContain('New Reflection');
    expect(html).toContain('id="sidebar-new-entry-btn"');
  });
});

describe('the mark', () => {
  it('is drawn, not an icon-set glyph', () => {
    const html = renderToStaticMarkup(<Logo />);
    expect(html).toContain('<svg');
    expect(html).toContain('aria-label="Perimeter"');
    // The shield, and the gap in the ring that is the whole idea.
    expect(html).toContain('circle');
    expect(html).toContain('stroke-dasharray');
  });

  it('inherits colour rather than hardcoding it', () => {
    expect(renderToStaticMarkup(<Logo />)).toContain('currentColor');
  });
});
