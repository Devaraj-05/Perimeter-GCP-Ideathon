import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import {
  Plus, ShieldCheck, BarChart3, LogOut, Sparkles, Github, ShieldAlert,
  KeyRound, ScrollText, Swords, MoreHorizontal, Menu, X,
} from 'lucide-react';

/**
 * Application chrome.
 *
 * Two rules drove this layout. The navigation must render on a single line at
 * desktop and stay under 80px tall, and every destination must be reachable on
 * a phone. Nine controls do not fit on one line with labels, so the four the
 * demo path actually uses stay visible and the rest move into an overflow menu.
 * Below `md` everything collapses into a sheet where each row is a full-width,
 * comfortably tappable target rather than a shrunken icon.
 */

interface NavbarProps {
  user: User | null;
  entryCount: number;
  onNewEntry: () => void;
  onOpenInsights: () => void;
  onOpenSecurity: () => void;
  onOpenSources: () => void;
  onOpenThreatFeed: () => void;
  onOpenPermissions: () => void;
  onOpenLog: () => void;
  onOpenRedTeam: () => void;
  onSignOut: () => void;
}

type Item = {
  id: string;
  label: string;
  Icon: typeof ShieldCheck;
  onClick: () => void;
  /** Red Team is the demo centrepiece and is tinted to be findable. */
  accent?: boolean;
};

export const Navbar: React.FC<NavbarProps> = ({
  user,
  entryCount,
  onNewEntry,
  onOpenInsights,
  onOpenSecurity,
  onOpenSources,
  onOpenThreatFeed,
  onOpenPermissions,
  onOpenLog,
  onOpenRedTeam,
  onSignOut,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Dismiss the overflow menu on an outside click or Escape. A menu with no
  // escape route is a trap (Apple HIG), and Escape is the keyboard equivalent
  // of clicking away.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const run = (fn: () => void) => () => {
    setMoreOpen(false);
    setMobileOpen(false);
    fn();
  };

  // Visible at desktop: the four surfaces the demo walks through.
  //
  // These labels are deliberately plain English rather than the subsystem names
  // they had ("Sources", "Red Team", "Permissions", "Log"). Those were OUR
  // vocabulary — they name the parts of the architecture, which is exactly what
  // a first-time visitor has no model of. Someone who has never heard of prompt
  // injection cannot infer that "Red Team" is the most interesting thing here,
  // so they never click it, and the entire point of the product stays invisible.
  //
  // "Attack it" is the one that matters. It is a dare rather than a noun, and a
  // dare is the only label a stranger reliably clicks.
  const primary: Item[] = [
    { id: 'sources-btn', label: 'What it reads', Icon: Github, onClick: onOpenSources },
    { id: 'redteam-btn', label: 'Attack it', Icon: Swords, onClick: onOpenRedTeam, accent: true },
    { id: 'permissions-btn', label: 'What it can do', Icon: KeyRound, onClick: onOpenPermissions },
    { id: 'perimeter-log-btn', label: 'What it refused', Icon: ScrollText, onClick: onOpenLog },
  ];

  // Behind the overflow: useful, but not on the critical path.
  const overflow: Item[] = [
    { id: 'insights-btn', label: 'Insights', Icon: BarChart3, onClick: onOpenInsights },
    { id: 'threat-feed-btn', label: 'Activity', Icon: ShieldAlert, onClick: onOpenThreatFeed },
    { id: 'security-btn', label: 'How this is secured', Icon: ShieldCheck, onClick: onOpenSecurity },
  ];

  const ghost =
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-sm font-medium text-[#434338] transition-colors hover:bg-[#f3efe6] hover:text-[#2c2c24]';

  return (
    <header className="sticky top-0 z-30 border-b border-[#e5e0d3] bg-[#fcfaf7]/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand. The subtitle is decorative and is the first thing to go. */}
        <div className="flex min-w-0 shrink items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5a5a40]">
            <Sparkles className="h-[18px] w-[18px] text-amber-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-serif text-lg font-semibold tracking-tight text-[#2c2c24]">
                Perimeter
              </span>
              <span className="hidden shrink-0 rounded-md border border-[#e5e0d3] bg-[#f3efe6] px-1.5 py-0.5 text-[11px] font-medium text-[#5a5a40] xl:inline">
                Gemini 3.6 Flash
              </span>
            </div>
            <p className="hidden truncate text-xs text-[#8a8a75] lg:block">
              Secure journal &amp; agent workspace
            </p>
          </div>
        </div>

        {user && (
          <>
            {/* ---------- Desktop ---------- */}
            <div className="ml-auto hidden items-center gap-2 md:flex">
              <button
                id="new-reflection-btn"
                onClick={onNewEntry}
                title="Start a fresh reflection"
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#5a5a40] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#484833]"
              >
                <Plus className="h-4 w-4" />
                <span className="hidden lg:inline">New Reflection</span>
                <span className="lg:hidden">New</span>
              </button>

              {primary.map(({ id, label, Icon, onClick, accent }) => (
                <button
                  key={id}
                  id={id}
                  onClick={onClick}
                  title={label}
                  className={
                    accent
                      ? 'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 transition-colors hover:bg-rose-100'
                      : ghost
                  }
                >
                  <Icon className={`h-4 w-4 ${accent ? '' : 'text-[#5a5a40]'}`} />
                  <span className="hidden xl:inline">{label}</span>
                </button>
              ))}

              {/* Overflow */}
              <div className="relative shrink-0" ref={moreRef}>
                <button
                  onClick={() => setMoreOpen((v) => !v)}
                  title="More"
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  className={ghost}
                >
                  <MoreHorizontal className="h-4 w-4 text-[#5a5a40]" />
                </button>
                {moreOpen && (
                  <div
                    role="menu"
                    className="anim-panel absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-[#e5e0d3] bg-white shadow-[0_24px_60px_rgba(58,53,40,0.16)]"
                  >
                    {overflow.map(({ id, label, Icon, onClick }) => (
                      <button
                        key={id}
                        id={id}
                        role="menuitem"
                        onClick={run(onClick)}
                        className="flex w-full items-center gap-2.5 px-3.5 py-3 text-left text-sm text-[#434338] transition-colors hover:bg-[#f3efe6]"
                      >
                        <Icon className="h-4 w-4 shrink-0 text-[#5a5a40]" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mx-1 h-6 w-px shrink-0 bg-[#e5e0d3]" />

              <div className="flex shrink-0 items-center gap-2.5">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="h-8 w-8 rounded-full border border-[#d8d2c2] object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-[#e5e0d3] bg-[#f3efe6] text-xs font-medium text-[#5a5a40]">
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div className="hidden text-left text-xs 2xl:block">
                  <div className="max-w-[130px] truncate font-medium text-[#2c2c24]">
                    {user.displayName || user.email?.split('@')[0]}
                  </div>
                  <div className="text-[11px] text-[#8a8a75]">
                    {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                  </div>
                </div>
                <button
                  id="sign-out-btn"
                  onClick={onSignOut}
                  title="Sign out"
                  aria-label="Sign out"
                  className="shrink-0 rounded-lg p-2 text-[#8a8a75] transition-colors hover:bg-[#f3efe6] hover:text-[#2c2c24]"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* ---------- Mobile trigger ---------- */}
            <div className="ml-auto flex items-center gap-2 md:hidden">
              <button
                onClick={onNewEntry}
                aria-label="New reflection"
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#5a5a40] text-white"
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                aria-expanded={mobileOpen}
                className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#e5e0d3] bg-white text-[#434338]"
              >
                <Menu className="h-5 w-5" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* ---------- Mobile sheet ---------- */}
      {user && mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
            className="anim-backdrop absolute inset-0 h-full w-full bg-black/30 backdrop-blur-sm"
          />
          <div className="anim-panel absolute inset-x-0 top-0 max-h-[100dvh] overflow-y-auto border-b border-[#e5e0d3] bg-[#fcfaf7] p-4 shadow-[0_24px_60px_rgba(58,53,40,0.16)]">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt=""
                    className="h-9 w-9 rounded-full border border-[#d8d2c2] object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[#e5e0d3] bg-[#f3efe6] text-xs font-medium text-[#5a5a40]">
                    {(user.displayName || user.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div className="text-left text-sm">
                  <div className="max-w-[180px] truncate font-medium text-[#2c2c24]">
                    {user.displayName || user.email?.split('@')[0]}
                  </div>
                  <div className="text-xs text-[#8a8a75]">
                    {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[#8a8a75] hover:bg-[#f3efe6]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              {[...primary, ...overflow].map(({ id, label, Icon, onClick, accent }) => (
                <button
                  key={id}
                  onClick={run(onClick)}
                  className={`flex min-h-[48px] w-full items-center gap-3 rounded-xl border px-4 text-left text-sm font-medium transition-colors ${
                    accent
                      ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : 'border-[#e5e0d3] bg-white text-[#434338]'
                  }`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${accent ? '' : 'text-[#5a5a40]'}`} />
                  {label}
                </button>
              ))}

              {/* Destructive-adjacent action, separated from ordinary navigation. */}
              <button
                onClick={run(onSignOut)}
                className="mt-3 flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-[#e5e0d3] bg-white px-4 text-left text-sm font-medium text-[#8a8a75]"
              >
                <LogOut className="h-5 w-5 shrink-0" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
