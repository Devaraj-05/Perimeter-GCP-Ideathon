import React, { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import {
  Plus, ShieldCheck, BarChart3, LogOut, Github, ShieldAlert,
  KeyRound, ScrollText, Swords, Menu, X, Gauge,
  ChevronDown,
} from 'lucide-react';
import { Logo } from './Logo';
import { ProfileMenu } from './ProfileMenu';

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
  /** Amendment E: shown only when the verified token carries role=admin. */
  isAdmin?: boolean;
  onOpenAdmin?: () => void;
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
  isAdmin = false,
  onOpenAdmin,
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
  /**
   * Everything that inspects the running system, in one menu.
   *
   * Ordered by what a first-time reader should open first: what came in, what
   * the agent may do, what it refused. The last three are useful but not on
   * that path, and a divider separates them.
   */
  const inspect: Item[] = [
    { id: 'sources-btn', label: 'What it reads', Icon: Github, onClick: onOpenSources },
    { id: 'permissions-btn', label: 'What it can do', Icon: KeyRound, onClick: onOpenPermissions },
    { id: 'perimeter-log-btn', label: 'What it refused', Icon: ScrollText, onClick: onOpenLog },
    { id: 'insights-btn', label: 'Insights', Icon: BarChart3, onClick: onOpenInsights },
    { id: 'threat-feed-btn', label: 'Activity', Icon: ShieldAlert, onClick: onOpenThreatFeed },
    { id: 'security-btn', label: 'How this is secured', Icon: ShieldCheck, onClick: onOpenSecurity },
    // Hiding this is a convenience, not the control: requireAdmin re-checks the
    // claim on every request, so forcing it visible in a debugger yields a 403.
    ...(isAdmin && onOpenAdmin
      ? [{ id: 'admin-btn', label: 'Fleet security', Icon: Gauge, onClick: onOpenAdmin }]
      : []),
  ];

  const ghost =
    'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-sm font-medium text-[#434338] transition-colors hover:bg-[#f3efe6] hover:text-[#2c2c24]';

  return (
    <header className="chrome-blur sticky top-0 z-30">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand.
            One drawn mark and one word. The tagline and the model badge both
            left this row: a subtitle nobody reads and a build detail beside a
            product name were two things competing with the actions. The badge
            now lives in the account menu, where a session property belongs. */}
        <div className="flex min-w-0 shrink items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5a5a40] text-[#f3efe6]">
            <Logo className="h-[19px] w-[19px]" />
          </span>
          <span className="truncate font-serif text-lg font-semibold tracking-[-0.01em] text-[#2c2c24]">
            Perimeter
          </span>
        </div>

        {user && (
          <>
            {/* ---------- Desktop ---------- */}
            <div className="ml-auto hidden items-center gap-2 md:flex">
              {/* "New Reflection" moved to the sidebar header.
                  It was here AND as a bare + in the sidebar — the same action
                  twice, and the one next to the list it creates into is the
                  one that belongs. */}

              {/* "Attack it" keeps its own colour and stays a sibling.
                  It is the one control a stranger must be able to see without
                  opening anything — a dare is the only label that reliably
                  gets clicked, and burying it in a menu would hide the point
                  of the product. */}
              <button
                id="redteam-btn"
                onClick={onOpenRedTeam}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-800 transition-colors hover:bg-rose-100"
              >
                <Swords className="h-4 w-4" />
                Attack it
              </button>

              {/* Everything else that inspects the system, behind one LABELLED
                  control.
                  Four icon buttons whose text only appeared at xl: meant that
                  at every laptop width this row was anonymous glyphs. One word
                  a reader can act on beats four they have to hover to identify. */}
              <div className="relative shrink-0" ref={moreRef}>
                <button
                  id="inspect-btn"
                  onClick={() => setMoreOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={moreOpen}
                  className={ghost}
                >
                  <ScrollText className="h-4 w-4 text-[#5a5a40]" />
                  Inspect
                  <ChevronDown
                    className={`h-3.5 w-3.5 text-[#8a8a75] transition-transform ${moreOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {moreOpen && (
                  <div
                    role="menu"
                    style={{ transformOrigin: 'top right' }}
                    className="anim-panel absolute right-0 top-full z-40 mt-2 w-64 overflow-hidden rounded-xl border border-[#e5e0d3] bg-white shadow-[0_24px_60px_rgba(58,53,40,0.16)]"
                  >
                    {inspect.map(({ id, label, Icon, onClick }, i) => (
                      <button
                        key={id}
                        id={id}
                        role="menuitem"
                        onClick={run(onClick)}
                        className={`flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-[#434338] transition-colors hover:bg-[#f3efe6] ${
                          i === 3 ? 'border-t border-[#f0ede6]' : ''
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0 text-[#5a5a40]" />
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <ProfileMenu
                user={user}
                entryCount={entryCount}
                modelLabel="Gemini 3.6 Flash"
                onSignOut={onSignOut}
              />
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
              {/* Mobile keeps every action flat and reachable: a sheet has the
                  room a 64px bar does not, so nothing is nested behind a
                  second tap. "Attack it" is prepended so it stays first here
                  too. */}
              {[
                {
                  id: 'redteam-btn-m',
                  label: 'Attack it',
                  Icon: Swords,
                  onClick: onOpenRedTeam,
                  accent: true,
                },
                ...inspect,
              ].map(({ id, label, Icon, onClick, accent }: Item) => (
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
