import { useState } from 'react';
import { ShieldAlert, ShieldCheck, ShieldQuestion, X, Github, AlertTriangle } from 'lucide-react';
import { InjectionReport } from './InjectionReport';
import type { RepoScanResult, RepoFinding, RepoVerdict } from '../lib/perimeterApi';
import type { FindingTier } from '../types';

/**
 * A repository injection scan — INV-18 (Amendment I).
 *
 * Answers one question and refuses the others. This can tell you a repository
 * contains a prompt injection and quote it; it cannot tell you what the
 * repository does, because nothing in the path that produced this ever ran a
 * model.
 *
 * The grouping is the point. An earlier version rendered every finding as
 * `hostile`, so scanning this project's own repo showed 31 red results — a
 * test corpus, a threat model and a README, all reported as attacks. What
 * matters is not whether text LOOKS like an injection but whether anything
 * would obey it, so findings are grouped by that and the strongest group is
 * the only one open by default.
 *
 * Nothing is hidden. Quoted and weak collapse behind a count that is always
 * visible.
 */

const VERDICT_STYLE: Record<RepoVerdict, { icon: typeof ShieldAlert; className: string }> = {
  injection_found: { icon: ShieldAlert, className: 'text-rose-600' },
  review: { icon: ShieldQuestion, className: 'text-amber-600' },
  discussion_only: { icon: ShieldCheck, className: 'text-[#5a5a40]' },
  clean: { icon: ShieldCheck, className: 'text-emerald-600' },
};

const TIER_COPY: Record<FindingTier, { label: string; hint: string }> = {
  live: {
    label: 'In a file an agent obeys',
    hint: 'AGENTS.md, CLAUDE.md, .cursorrules and CI config are read as instructions by construction. An injection here is executed, not quoted.',
  },
  active: {
    label: 'Reads as an instruction to an AI',
    hint: 'Unquoted, in a file an agent would read as context but is not built to follow. Worth a human look.',
  },
  quoted: {
    label: 'Quoted or demonstrated',
    hint: 'Inside a code fence, a string literal or a comment — or in a test or fixture. Demonstrated, not deployed. A fence is a rendering instruction, not a barrier, so this is a ranking rather than a guarantee.',
  },
  weak: {
    label: 'Weak signals only',
    hint: 'Patterns that cannot justify a verdict on their own — an outbound link, an HTML comment.',
  },
};

const ROLE_LABEL: Record<string, string> = {
  agent_instructions: 'agent instructions',
  ci_config: 'CI config',
  documentation: 'documentation',
  test: 'test',
  fixture: 'fixture',
  source: 'source',
  data: 'data',
  other: 'file',
};

const TIER_ORDER: FindingTier[] = ['live', 'active', 'quoted', 'weak'];

function TierGroup({
  tier,
  findings,
  defaultOpen,
}: {
  tier: FindingTier;
  findings: RepoFinding[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (findings.length === 0) return null;

  const copy = TIER_COPY[tier];

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-lg border border-[#e5e0d3] bg-[#fbf9f2] px-3 py-2 text-left hover:bg-[#f3efe6]"
      >
        <span className="text-xs font-medium text-[#2c2c24]">
          {copy.label}
          <span className="ml-1.5 font-normal text-[#8a8a75]">
            {findings.length} file{findings.length === 1 ? '' : 's'}
          </span>
        </span>
        <span className="shrink-0 text-[10px] text-[#8a8a75]">{open ? 'hide' : 'show'}</span>
      </button>

      {open && (
        <>
          <p className="mt-1.5 px-1 text-[10px] leading-relaxed text-[#8a8a75]">{copy.hint}</p>
          <div className="mt-2 space-y-2">
            {findings.map((f) => (
              <div key={f.path}>
                <p className="mb-1 px-1 font-mono text-[10px] text-[#8a8a75]">
                  {f.path} &middot; {ROLE_LABEL[f.role] ?? f.role}
                  {f.structureUnreliable && (
                    <span className="ml-1.5 text-amber-700">
                      markup does not close — positions not trusted
                    </span>
                  )}
                </p>
                <InjectionReport
                  title={f.path}
                  verdict={tier === 'live' || tier === 'active' ? 'hostile' : 'suspicious'}
                  matches={f.matches}
                  onClose={() => undefined}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function RepoScanReport({
  result,
  onClose,
}: {
  result: RepoScanResult;
  onClose: () => void;
}) {
  const style = VERDICT_STYLE[result.verdict] ?? VERDICT_STYLE.clean;
  const Icon = style.icon;

  const byTier = (tier: FindingTier) => result.findings.filter((f) => f.tier === tier);

  return (
    <div className="mt-3 rounded-xl border border-[#e5e0d3] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Github className="mt-0.5 h-4 w-4 shrink-0 text-[#5a5a40]" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-[#2c2c24]">
              {result.repo}
              <span className="ml-1.5 text-[11px] font-normal text-[#8a8a75]">
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

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-[#e5e0d3] bg-[#fbf9f2] px-3 py-2.5">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.className}`} />
        <p className="text-xs text-[#2c2c24]">{result.headline}</p>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-[#5a5a40]">
        Nothing in this scan reached a model. Files were fetched, matched against fixed patterns,
        and discarded &mdash; so a repository full of instructions had nothing here to instruct. It
        also means this cannot tell you what the code does, only where the injections are.
      </p>

      {/* Strongest group open, the rest collapsed behind a visible count.
          Nothing is hidden: a finding the user cannot see is one they cannot
          judge, which is why the earlier deletion of weak matches was wrong. */}
      {TIER_ORDER.map((tier, i) => (
        <div key={tier}>
          <TierGroup
            tier={tier}
            findings={byTier(tier)}
            defaultOpen={i === TIER_ORDER.findIndex((t) => byTier(t).length > 0)}
          />
        </div>
      ))}
    </div>
  );
}
