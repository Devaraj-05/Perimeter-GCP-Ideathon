import React, { useMemo } from 'react';
import { CheckCircle2, PenLine, Sparkles } from 'lucide-react';
import type { JournalEntry } from '../types';
import { summarise, abbreviate, humanise, type Slice } from '../lib/insightsStats';
import { navigate } from '../lib/router';
import { PageShell, Band, Empty, Skeleton } from './PageShell';

/**
 * Insights — what this journal actually contains.
 *
 * Was a dialog holding three numbers, one bar and a "Done" button. One of the
 * three numbers was wrong: it counted words in `entry.content`, which nobody
 * fills in because the product is a chat, so a real account read **0 words
 * written**. The maths now lives in src/lib/insightsStats.ts, where it is
 * tested.
 *
 * Everything here comes from entries the client already holds. Opening this
 * page issues no request.
 */

/** A number that leads, with its label beneath. No box — a rule does the work. */
const Metric: React.FC<{ value: string; label: string; lead?: boolean }> = ({
  value,
  label,
  lead = false,
}) => (
  <div className="min-w-0">
    <p
      className={`font-serif font-normal tabular-nums leading-none tracking-[-0.03em] text-[#1a1a1a] ${
        lead ? 'text-6xl sm:text-7xl' : 'text-3xl sm:text-4xl'
      }`}
    >
      {value}
    </p>
    <p className="mt-2.5 text-xs font-medium uppercase tracking-[0.1em] text-[#6b6b6b]">{label}</p>
  </div>
);

/** A distribution as labelled bars. */
const Bars: React.FC<{ slices: Slice[]; format?: (label: string) => string }> = ({
  slices,
  format = (l) => l,
}) => (
  <div className="divide-y divide-[#f0f0f0]">
    {slices.map((slice) => (
      <div key={slice.label} className="py-3">
        <div className="flex items-baseline justify-between gap-4 text-sm">
          <span className="min-w-0 truncate text-[#1a1a1a]">{format(slice.label)}</span>
          <span className="shrink-0 tabular-nums text-xs text-[#6b6b6b]">
            {slice.count} · {slice.pct}%
          </span>
        </div>
        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[#f0f0f0]">
          <div
            className="h-full rounded-full bg-[#1a1a1a] transition-[width] duration-500 ease-out"
            style={{ width: `${Math.max(slice.pct, 2)}%` }}
          />
        </div>
      </div>
    ))}
  </div>
);

/** Twelve weeks of activity. Empty weeks are drawn, because a gap is data. */
const Activity: React.FC<{
  weeks: { weekStart: string; count: number }[];
  busiest: { weekStart: string; count: number } | null;
}> = ({ weeks, busiest }) => {
  const peak = Math.max(1, ...weeks.map((w) => w.count));
  return (
    <div>
      <div className="flex h-28 items-end gap-1.5">
        {weeks.map((week) => {
          const label = new Date(week.weekStart).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          });
          return (
            <div key={week.weekStart} className="group relative flex h-full flex-1 items-end">
              <div
                className={`w-full rounded-t-sm transition-colors ${
                  week.count === 0 ? 'bg-[#f0f0f0]' : 'bg-[#1a1a1a] group-hover:bg-[#000000]'
                }`}
                // A zero week still gets a visible sliver: a column of nothing
                // is indistinguishable from a rendering failure.
                style={{ height: week.count === 0 ? '3px' : `${(week.count / peak) * 100}%` }}
              />
              <span className="pointer-events-none absolute -top-1 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-[#1a1a1a] px-2 py-1 text-[10px] text-white group-hover:block">
                {week.count} in week of {label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-[#6b6b6b]">
        <span>12 weeks ago</span>
        {busiest && (
          <span className="tabular-nums">
            busiest week: {busiest.count} on{' '}
            {new Date(busiest.weekStart).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}
        <span>this week</span>
      </div>
    </div>
  );
};

export const InsightsPage: React.FC<{
  entries: JournalEntry[];
  loading?: boolean;
  /** True when more entries exist than were fetched — the numbers are a floor. */
  truncated?: boolean;
}> = ({ entries, loading = false, truncated = false }) => {
  const s = useMemo(() => summarise(entries), [entries]);

  if (loading) {
    return (
      <PageShell title="Insights" subtitle="What your journal actually contains.">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i}>
              <Skeleton className="h-12 w-24" />
              <Skeleton className="mt-3 h-3 w-16" />
            </div>
          ))}
        </div>
        <div className="mt-14 space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </PageShell>
    );
  }

  if (s.entryCount === 0) {
    return (
      <PageShell title="Insights" subtitle="What your journal actually contains.">
        <Empty
          icon={<PenLine className="h-6 w-6" />}
          title="Nothing to measure yet"
          body="Once you have written a few reflections, this page shows how much you have written, what you write about, when you write, and what came out of it. It is computed from your entries in your browser — opening it sends no request."
          action={
            <button
              type="button"
              onClick={() => navigate('/')}
              className="mt-1 cursor-pointer rounded-lg bg-[#1a1a1a] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-black"
            >
              Start a reflection
            </button>
          }
        />
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Insights"
      subtitle="What your journal actually contains — computed from your own entries, in your browser."
    >
      {/* Asymmetric on purpose: one number leads and the rest support it.
          Four equal tiles would say all four matter the same, which is not
          true — the count of reflections is the spine of every other figure. */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-10 border-b border-[#e5e5e5] pb-12 sm:grid-cols-4 sm:items-end">
        <div className="col-span-2 sm:col-span-1">
          <Metric lead value={abbreviate(s.entryCount)} label="Reflections" />
        </div>
        <Metric value={abbreviate(s.wordCount)} label="Words written" />
        <Metric value={abbreviate(s.exchangeCount)} label="Messages" />
        <Metric value={String(s.exchangesPerEntry)} label="Per reflection" />
      </div>

      {truncated && (
        <p className="mt-4 text-xs text-[#6b6b6b]">
          You have more entries than were loaded, so these are a floor rather than a total.
        </p>
      )}

      <Band
        title="When you write"
        hint="Entries per week for the last twelve weeks. Quiet weeks are drawn rather than skipped — the gaps are the shape."
      >
        <Activity weeks={s.activity} busiest={s.busiestWeek} />
      </Band>

      {/* Two distributions side by side, and neither is a card. */}
      <div className="mt-14 grid gap-x-12 gap-y-14 md:grid-cols-2">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b6b]">
            What you write about
          </h2>
          <div className="mt-5">
            <Bars slices={s.categories} />
          </div>
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b6b]">
            How you write
          </h2>
          <div className="mt-5">
            {s.modes.length > 0 ? (
              <Bars slices={s.modes} format={humanise} />
            ) : (
              <p className="text-sm text-[#6b6b6b]">No modes recorded yet.</p>
            )}
          </div>
        </section>
      </div>

      {s.tags.length > 0 && (
        <Band title="Recurring themes" hint="Tags Gemini drew out of your entries, most used first.">
          <div className="flex flex-wrap gap-2">
            {s.tags.map((tag) => (
              <span
                key={tag.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#e5e5e5] px-3 py-1.5 text-xs text-[#1a1a1a]"
              >
                {tag.label}
                <span className="tabular-nums text-[#6b6b6b]">{tag.count}</span>
              </span>
            ))}
          </div>
        </Band>
      )}

      {s.sentiments.length > 0 && (
        <Band title="Tone across your entries">
          <Bars slices={s.sentiments} format={humanise} />
        </Band>
      )}

      {s.takeaways.length > 0 && (
        <Band
          title="Takeaways"
          hint="Actionable points Gemini surfaced, newest first."
          action={
            <span className="text-xs tabular-nums text-[#6b6b6b]">
              {s.takeaways.length} in total
            </span>
          }
        >
          <ul className="divide-y divide-[#f0f0f0]">
            {s.takeaways.slice(0, 12).map((takeaway, i) => (
              <li key={`${i}-${takeaway.slice(0, 24)}`} className="flex gap-3 py-3.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                {/* Model-derived text, rendered as a plain child (INV-9). */}
                <p className="text-sm leading-relaxed text-[#3f3f3f]">{takeaway}</p>
              </li>
            ))}
          </ul>
        </Band>
      )}

      <p className="mt-16 flex items-start gap-2 border-t border-[#e5e5e5] pt-6 text-xs leading-relaxed text-[#6b6b6b]">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Words written counts what <em>you</em> typed &mdash; your own messages and any prose in the
        entry &mdash; and never the model&rsquo;s replies. Every figure here is computed in your
        browser from entries already loaded: nothing is sent anywhere, and opening this page makes
        no network request.
      </p>
    </PageShell>
  );
};
