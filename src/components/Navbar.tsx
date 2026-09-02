import React from 'react';
import { User } from 'firebase/auth';
import { BookOpen, Plus, ShieldCheck, BarChart3, LogOut, Sparkles, Github, ShieldAlert, KeyRound, ScrollText } from 'lucide-react';

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
  onSignOut: () => void;
}

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
  onSignOut,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-[#e5e0d3] bg-[#fcfaf7]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#5a5a40] text-amber-50 shadow-xs">
            <Sparkles className="h-5 w-5 text-amber-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-serif text-lg font-semibold tracking-tight text-[#2c2c24]">
                ReflectAI
              </span>
              <span className="rounded-md bg-[#f3efe6] px-1.5 py-0.5 text-[11px] font-medium text-[#5a5a40] border border-[#e5e0d3]">
                Gemini 3.6 Flash
              </span>
            </div>
            <p className="text-xs text-[#8a8a75]">Private Reflection & Journal Companion</p>
          </div>
        </div>

        {/* Action Controls */}
        {user && (
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              id="new-reflection-btn"
              onClick={onNewEntry}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#5a5a40] px-3.5 py-2 text-xs sm:text-sm font-medium text-white transition-colors hover:bg-[#484833] shadow-xs cursor-pointer"
              title="Start a fresh reflection"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Reflection</span>
            </button>

            <button
              id="insights-btn"
              onClick={onOpenInsights}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs sm:text-sm font-medium text-[#434338] hover:bg-[#f3efe6] hover:text-[#2c2c24] transition-colors cursor-pointer"
              title="View your reflection insights & trends"
            >
              <BarChart3 className="h-4 w-4 text-[#5a5a40]" />
              <span className="hidden md:inline">Insights</span>
            </button>

            <button
              id="sources-btn"
              onClick={onOpenSources}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs sm:text-sm font-medium text-[#434338] hover:bg-[#f3efe6] hover:text-[#2c2c24] transition-colors cursor-pointer"
              title="Connect external context, screened before Gemini reads it"
            >
              <Github className="h-4 w-4 text-[#5a5a40]" />
              <span className="hidden md:inline">Sources</span>
            </button>

            <button
              id="permissions-btn"
              onClick={onOpenPermissions}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs sm:text-sm font-medium text-[#434338] hover:bg-[#f3efe6] hover:text-[#2c2c24] transition-colors cursor-pointer"
              title="What the assistant is allowed to do"
            >
              <KeyRound className="h-4 w-4 text-[#5a5a40]" />
              <span className="hidden lg:inline">Permissions</span>
            </button>

            <button
              id="perimeter-log-btn"
              onClick={onOpenLog}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs sm:text-sm font-medium text-[#434338] hover:bg-[#f3efe6] hover:text-[#2c2c24] transition-colors cursor-pointer"
              title="Every decision, with reasons"
            >
              <ScrollText className="h-4 w-4 text-[#5a5a40]" />
              <span className="hidden xl:inline">Log</span>
            </button>

            <button
              id="threat-feed-btn"
              onClick={onOpenThreatFeed}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs sm:text-sm font-medium text-[#434338] hover:bg-[#f3efe6] hover:text-[#2c2c24] transition-colors cursor-pointer"
              title="Approvals and every policy decision the agent triggered"
            >
              <ShieldAlert className="h-4 w-4 text-[#5a5a40]" />
              <span className="hidden lg:inline">Activity</span>
            </button>

            <button
              id="security-btn"
              onClick={onOpenSecurity}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-2 text-xs sm:text-sm font-medium text-[#5a5a40] hover:bg-[#f3efe6] transition-colors cursor-pointer"
              title="Security & isolation architecture"
            >
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              <span className="hidden lg:inline">Vault Protected</span>
            </button>

            <div className="h-5 w-px bg-[#e5e0d3] hidden sm:block" />

            {/* User Profile */}
            <div className="flex items-center gap-2.5">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="h-8 w-8 rounded-full border border-[#d8d2c2] object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3efe6] border border-[#e5e0d3] text-xs font-medium text-[#5a5a40]">
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="hidden xl:block text-left text-xs">
                <div className="font-medium text-[#2c2c24] truncate max-w-[140px]">
                  {user.displayName || user.email?.split('@')[0]}
                </div>
                <div className="text-[11px] text-[#8a8a75]">
                  {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                </div>
              </div>

              <button
                id="sign-out-btn"
                onClick={onSignOut}
                className="rounded-lg p-2 text-[#8a8a75] hover:bg-[#f3efe6] hover:text-[#2c2c24] transition-colors cursor-pointer"
                title="Sign out of ReflectAI"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};
