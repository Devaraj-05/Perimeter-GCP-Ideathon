import type { JournalEntry } from '../types';

/**
 * The numbers behind the Insights page.
 *
 * Pure functions, in a file of their own, for two reasons. They were computed
 * inline in a render body — recomputed on every keystroke of a parent, and
 * untestable. And one of them was wrong in a way nobody could see without a
 * test: "Words Written" read **0** on a real account.
 *
 * Everything here derives from entries the client already holds. No API, no
 * new Firestore read.
 */

/** Words in a blob of prose, counting an empty or blank string as none. */
export function countWords(text: unknown): number {
  if (typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Words the USER wrote in one entry.
 *
 * The bug this fixes: the old count read `entry.content` alone. Almost nobody
 * types into `content` — the product is a chat, and what a person writes goes
 * into their turns. So a journal with months of conversation in it reported
 * zero words written, which is both wrong and demoralising.
 *
 * Model replies are excluded on purpose. This is a measure of what the person
 * put in, not of how much the assistant said back; counting Gemini's output as
 * the user's writing would flatter the number and mean nothing.
 */
export function wordsInEntry(entry: JournalEntry): number {
  const fromContent = countWords(entry?.content);
  const fromTurns = (entry?.turns ?? []).reduce(
    (sum, turn) => sum + (turn?.role === 'user' ? countWords(turn.text) : 0),
    0,
  );
  return fromContent + fromTurns;
}

/** One row of a distribution, already sorted and with its share worked out. */
export interface Slice {
  label: string;
  count: number;
  /** Whole-number percent of the total. */
  pct: number;
}

/**
 * Counts values into sorted slices.
 *
 * Percentages are rounded for display and therefore need not total 100. That is
 * a real property of rounding, not a defect to paper over by fudging the last
 * row — the bars are a shape, and the counts beside them are the truth.
 */
export function distribution(values: readonly (string | undefined | null)[]): Slice[] {
  const counts = new Map<string, number>();
  let total = 0;

  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const label = raw.trim();
    if (!label) continue;
    counts.set(label, (counts.get(label) ?? 0) + 1);
    total++;
  }

  if (total === 0) return [];

  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 100) }))
    // Count descending, then alphabetically, so equal counts have a stable
    // order instead of shuffling between renders.
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** One week in the activity strip. */
export interface WeekBucket {
  /** ISO date of the Monday that starts this week. */
  weekStart: string;
  count: number;
}

const DAY_MS = 86_400_000;

/** Midnight UTC on the Monday of the week containing `at`. */
function mondayOf(at: number): number {
  const d = new Date(at);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day.
  const dayIndex = (new Date(utcMidnight).getUTCDay() + 6) % 7;
  return utcMidnight - dayIndex * DAY_MS;
}

/**
 * Entries per week over a trailing window, oldest first.
 *
 * Empty weeks are present with `count: 0` — a gap is the most informative part
 * of an activity chart, and omitting them would silently compress time and draw
 * a busy-looking streak over a month of silence.
 */
export function weeklyActivity(
  entries: readonly JournalEntry[],
  weeks = 12,
  now: number = Date.now(),
): WeekBucket[] {
  const span = Math.max(1, Math.floor(weeks));
  const thisMonday = mondayOf(now);
  const firstMonday = thisMonday - (span - 1) * 7 * DAY_MS;

  const buckets = new Map<number, number>();
  for (let i = 0; i < span; i++) buckets.set(firstMonday + i * 7 * DAY_MS, 0);

  for (const entry of entries) {
    const at = Date.parse(entry?.createdAt ?? '');
    if (!Number.isFinite(at)) continue;
    const key = mondayOf(at);
    if (!buckets.has(key)) continue; // outside the window
    buckets.set(key, buckets.get(key)! + 1);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([weekStart, count]) => ({
      weekStart: new Date(weekStart).toISOString().slice(0, 10),
      count,
    }));
}

export interface InsightsSummary {
  entryCount: number;
  wordCount: number;
  /** Every message in every conversation, user and model alike. */
  exchangeCount: number;
  /** Exchanges per entry, one decimal place. 0 when there are no entries. */
  exchangesPerEntry: number;
  categories: Slice[];
  modes: Slice[];
  sentiments: Slice[];
  /** Most-used tags first, capped. */
  tags: Slice[];
  /** Most recent first. */
  takeaways: string[];
  activity: WeekBucket[];
  /** The busiest week in the window, for labelling the chart. */
  busiestWeek: WeekBucket | null;
}

/** Everything the Insights page renders, from the entries the client holds. */
export function summarise(
  entries: readonly JournalEntry[],
  now: number = Date.now(),
): InsightsSummary {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];

  const entryCount = list.length;
  const wordCount = list.reduce((sum, e) => sum + wordsInEntry(e), 0);
  const exchangeCount = list.reduce((sum, e) => sum + (e.turns?.length ?? 0), 0);

  // Newest first, so "recent takeaways" is actually recent. The entries array
  // arrives ordered by updatedAt, but this must not depend on that.
  const byNewest = [...list].sort(
    (a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''),
  );

  const takeaways: string[] = [];
  for (const entry of byNewest) {
    for (const insight of entry.insights ?? []) {
      if (typeof insight === 'string' && insight.trim()) takeaways.push(insight.trim());
    }
  }

  const activity = weeklyActivity(list, 12, now);
  const busiest = activity.reduce<WeekBucket | null>(
    (best, week) => (week.count > 0 && (!best || week.count > best.count) ? week : best),
    null,
  );

  return {
    entryCount,
    wordCount,
    exchangeCount,
    exchangesPerEntry: entryCount === 0 ? 0 : Math.round((exchangeCount / entryCount) * 10) / 10,
    categories: distribution(list.map((e) => e.category)),
    modes: distribution(list.map((e) => e.mode)),
    sentiments: distribution(list.map((e) => e.sentiment)),
    tags: distribution(list.flatMap((e) => e.tags ?? [])).slice(0, 12),
    takeaways,
    activity,
    busiestWeek: busiest,
  };
}

/** Turns `companion` / `gratitude_wellness` into something readable. */
export function humanise(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Compact display for large counts: 1200 becomes "1.2k". */
export function abbreviate(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) < 1000) return String(n);
  if (Math.abs(n) < 1_000_000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}k`;
  }
  const m = n / 1_000_000;
  return `${m % 1 === 0 ? m : m.toFixed(1)}m`;
}
