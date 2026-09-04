import { ShieldAlert, ShieldCheck, X, Github, AlertTriangle } from 'lucide-react';
import { InjectionReport } from './InjectionReport';
import type { RepoScanResult } from '../lib/perimeterApi';

/**
 * A repository injection scan — INV-18 (Amendment I).
 *
 * Answers one question and refuses the others. This can tell you a repository
 * contains a prompt injection and quote it; it cannot tell you what the
 * repository does, because nothing in the path that produced this ever ran a
 * model. That is the feature's boundary, not a gap to fill later.
 *
 * The coverage line is load-bearing. A scan stopped by a cap says which cap
 * and how many files went unread, because a partial scan that reads as a clean
 * bill of health is worse than no scan at all.
 */
export function RepoScanReport({
  result,
  onClose,
}: {
  result: RepoScanResult;
  onClose: () => void;
}) {
  const files = result.findings.length;
  const attempts = result.findings.reduce((n, f) => n + f.matches.length, 0);

  return (
    <div className="mt-3 rounded-xl border border-[#e5e0d3] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Github className="mt-0.5 h-4 w-4 shrink-0 text-[#5a5a40]" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#2c2c24]">
              {result.repo}
              <span className="ml-1.5 font-normal text-[11px] text-[#8a8a75]">
                {result.defaultBranch}
              </span>
            </p>
            <p className="mt-0.5 text-[11px] text-[#5a5a40]">{result.coverage}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close"
          className="shrink-0 cursor-pointer opacity-60 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {(result.warnings ?? []).map((w) => (
        <div
          key={w}
          className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{w}</span>
        </div>
      ))}

      <div className="mt-3 flex items-center gap-2 rounded-lg border border-[#e5e0d3] bg-[#fbf9f2] px-3 py-2">
        {attempts > 0 ? (
          <ShieldAlert className="h-4 w-4 shrink-0 text-rose-600" />
        ) : (
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
        )}
        <p className="text-xs text-[#2c2c24]">
          {attempts > 0
            ? `${attempts} injection attempt${attempts === 1 ? '' : 's'} across ${files} file${
                files === 1 ? '' : 's'
              }.`
            : 'No injection attempts found in the files that were read.'}
        </p>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#5a5a40]">
        Nothing in this scan reached a model. The files were fetched, matched against fixed
        patterns, and discarded &mdash; so a repository full of instructions had nothing here to
        instruct. It also means this cannot tell you what the code does, only where the
        injections are.
      </p>

      <div className="mt-3 space-y-2">
        {result.findings.map((f) => (
          // Reuses the same panel a single attachment gets, so a finding in a
          // repository and a finding in a pasted note read identically.
          <div key={f.path}>
            <InjectionReport
              title={f.path}
              verdict="hostile"
              matches={f.matches}
              onClose={() => undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
