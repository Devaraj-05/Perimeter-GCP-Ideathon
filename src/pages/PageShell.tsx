import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { navigate } from '../lib/router';

/**
 * The frame every full page sits in.
 *
 * It exists to delete duplication rather than to add a layer: the nine overlays
 * this replaces each carried their own copy-pasted `fixed inset-0` backdrop,
 * panel div, header row and close button, and the copies had already drifted —
 * two were missing `anim-panel`, and the widths and z-indexes disagreed.
 *
 * A page is not a dialog, so nothing here traps focus or locks the body. The
 * back control is a real navigation, and the browser's own back button does the
 * same thing.
 */
export const PageShell: React.FC<{
  /** Shown large, in the display face. */
  title: string;
  /** One line under the title. Say what the page is for, not what it is called. */
  subtitle?: string;
  /** Sits opposite the title — a refresh control, a tab bar, a count. */
  action?: React.ReactNode;
  /** Where the back arrow goes. The workspace, unless a page says otherwise. */
  backTo?: '/' | '/security';
  backLabel?: string;
  /** Wider for dense, tabular pages; narrower for prose. */
  width?: 'prose' | 'wide';
  children: React.ReactNode;
}> = ({
  title,
  subtitle,
  action,
  backTo = '/',
  backLabel = 'Back to your journal',
  width = 'wide',
  children,
}) => (
  // min-h-dvh, not vh: on iOS Safari the address bar makes vh a promise the
  // browser does not keep, and the footer of a long page ends up under it.
  <div className="min-h-dvh bg-white">
    <div
      className={`mx-auto w-full px-4 pb-24 pt-8 sm:px-6 sm:pt-10 lg:px-8 ${
        width === 'prose' ? 'max-w-3xl' : 'max-w-5xl'
      }`}
    >
      <button
        type="button"
        onClick={() => navigate(backTo)}
        className="anim-rise group inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-[#6b6b6b] transition-colors hover:text-[#1a1a1a]"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
        {backLabel}
      </button>

      {/* The title block is deliberately not a card. A page announces itself
          with type and space; boxing the heading would make it look like a
          dialog that forgot to close. */}
      <header className="anim-rise anim-rise-1 mt-6 flex flex-col gap-4 border-b border-[#e5e5e5] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-serif text-[2rem] font-normal leading-[1.1] tracking-[-0.02em] text-[#1a1a1a] sm:text-[2.5rem]">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#525252]">{subtitle}</p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>

      <main className="anim-rise anim-rise-2 mt-10">{children}</main>
    </div>
  </div>
);

/**
 * A labelled band of a page.
 *
 * Grouped by a rule and a heading rather than a card, per the density rule: a
 * dashboard that boxes every group reads as a pile of tiles, and the boxes stop
 * meaning "this is elevated" once everything has one.
 */
export const Band: React.FC<{
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, hint, action, children }) => (
  <section className="mt-14 first:mt-0">
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[#6b6b6b]">{title}</h2>
      {action}
    </div>
    {hint && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#525252]">{hint}</p>}
    <div className="mt-5">{children}</div>
  </section>
);

/**
 * What a page shows when it has nothing to show.
 *
 * Every one of these surfaces could be empty on a new account, and an empty
 * page that says nothing reads as a broken page. Rule 5: an empty state names
 * the thing that is missing and how to get one.
 */
export const Empty: React.FC<{
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}> = ({ icon, title, body, action }) => (
  <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed border-[#e5e5e5] px-6 py-10">
    <span className="text-[#6b6b6b]">{icon}</span>
    <p className="font-serif text-lg text-[#1a1a1a]">{title}</p>
    <p className="max-w-md text-sm leading-relaxed text-[#6b6b6b]">{body}</p>
    {action}
  </div>
);

/** A loading placeholder shaped like the thing it is standing in for. */
export const Skeleton: React.FC<{ className?: string }> = ({ className = 'h-4 w-full' }) => (
  <div className={`animate-pulse rounded-md bg-[#f0f0f0] ${className}`} />
);
