import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, ShieldCheck, Clock, AlertCircle, Loader2, Check, Ban, ScrollText, RefreshCw,
} from 'lucide-react';
import { ToolCall, AuditEvent, listToolCalls, listAudit, approveCall, rejectCall } from '../lib/agentApi';
import { PageShell, Empty, Skeleton } from './PageShell';

/**
 * Agent Activity — every action the assistant proposed, and what the broker did
 * about it.
 *
 * Was a dialog. This is the surface a reviewer spends the longest on, and it is
 * a queue plus a log: two things that want width and vertical room, and neither
 * of which wants to be dismissed by a stray click on the backdrop.
 *
 * The fetch used to be triggered by `isOpen`. It is now a mount-time load, so
 * arriving by URL works the same as arriving by menu.
 */

/**
 * Plain-language explanations. A user who cannot reason about a risk they
 * cannot see is the problem this panel exists to solve, so the reason codes
 * are translated rather than displayed raw.
 */
const REASON_TEXT: Record<string, string> = {
  write_from_tainted_turn:
    'Refused. This write was proposed while untrusted content was in context — the classic shape of an injection trying to make the assistant act.',
  write_requires_confirmation:
    'Held for your approval. Every write needs an explicit click, no exceptions.',
  not_in_allowlist: 'Refused. That tool is not enabled for your account.',
  not_in_registry: 'Refused. The assistant asked for a tool that does not exist.',
  rate_limited: 'Refused. That tool has hit its hourly limit.',
  invalid_arguments: 'Refused. The request was malformed.',
  permitted: 'Allowed. Read-only, so nothing was changed.',
  human_approved: 'You approved this. It ran.',
  human_rejected: 'You rejected this. Nothing ran.',
  executed: 'Completed.',
  execution_failed: 'Failed while running.',
};

function explain(reason: string | null): string {
  if (!reason) return '';
  if (REASON_TEXT[reason]) return REASON_TEXT[reason];
  if (reason.startsWith('revalidation_failed:')) {
    return 'Refused at execution time. Conditions changed while this sat in the queue, so the earlier decision was not reused.';
  }
  return reason;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

export const ActivityPage: React.FC = () => {
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [tab, setTab] = useState<'queue' | 'activity'>('queue');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, a] = await Promise.all([listToolCalls(), listAudit()]);
      setCalls(c);
      setAudit(a);
    } catch (err: any) {
      setError(err?.message || 'Could not load activity.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Mount, not open. Reaching this by URL has to work exactly like reaching it
  // from the Inspect menu.
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (callId: string, approve: boolean) => {
    setBusyId(callId);
    setError(null);
    try {
      if (approve) await approveCall(callId);
      else await rejectCall(callId);
    } catch (err: any) {
      setError(err?.message || 'Action failed.');
    } finally {
      setBusyId(null);
      await load();
    }
  };

  const pending = calls.filter((c) => c.status === 'pending');
  const blocked = calls.filter((c) => c.decision === 'DENY');

  const tabs = [
    { id: 'queue' as const, label: 'Awaiting approval', count: pending.length },
    { id: 'activity' as const, label: 'All decisions', count: audit.length },
  ];

  return (
    <PageShell
      title="Agent Activity"
      subtitle="Every action the assistant proposed, and what the policy engine decided. A write proposed while untrusted content was in context is refused outright; every other write waits for you."
      action={
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#e5e5e5] px-3 py-2 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f7f7f8] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      }
    >
      <div className="flex gap-6 border-b border-[#e5e5e5]">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id}
            className={`-mb-px cursor-pointer border-b-2 px-0.5 pb-3 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'border-[#1a1a1a] text-[#1a1a1a]'
                : 'border-transparent text-[#6b6b6b] hover:text-[#1a1a1a]'
            }`}
          >
            {t.label}
            <span className="ml-2 tabular-nums text-xs text-[#6b6b6b]">{t.count}</span>
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p>{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-1 cursor-pointer font-medium underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        </div>
      )}

      {loading && calls.length === 0 && audit.length === 0 && (
        <div className="mt-8 space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-2/3" />
        </div>
      )}

      {tab === 'queue' && !loading && (
        <div className="mt-8">
          {pending.length === 0 ? (
            <Empty
              icon={<ShieldCheck className="h-6 w-6 text-emerald-600" />}
              title="Nothing awaiting approval"
              body="When the assistant proposes an action that writes or sends, it stops here and waits for you. An empty queue means nothing is currently asking for permission."
            />
          ) : (
            <ul className="space-y-4">
              {pending.map((c) => (
                <li
                  key={c.id}
                  className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Clock className="h-4 w-4 shrink-0 text-amber-700" />
                    <span className="font-mono text-sm font-medium text-[#1a1a1a]">{c.tool}</span>
                    {c.sideEffect && (
                      <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                        {c.sideEffect}
                      </span>
                    )}
                    {c.turnTaint && (
                      <span className="rounded-full border border-rose-300 bg-white px-2 py-0.5 text-[10px] font-medium text-rose-700">
                        tainted turn
                      </span>
                    )}
                    <span className="ml-auto text-[11px] tabular-nums text-[#6b6b6b]">
                      {timeOf(c.createdAt)}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-amber-900/90">{explain(c.reason)}</p>

                  {/* The exact proposal, unedited. A reviewer has to be able to
                      see what was actually asked for, not a summary of it. */}
                  <pre className="mt-3 overflow-x-auto rounded-lg border border-amber-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-[#3f3f3f]">
                    {JSON.stringify(c.args, null, 2)}
                  </pre>

                  {c.originSourceIds.length > 0 && (
                    <p className="mt-2 text-[11px] text-[#6b6b6b]">
                      Untrusted sources in this turn: {c.originSourceIds.join(', ')}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      onClick={() => void act(c.id, true)}
                      disabled={busyId === c.id}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#1a1a1a] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-black disabled:opacity-50"
                    >
                      {busyId === c.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Approve and run
                    </button>
                    <button
                      onClick={() => void act(c.id, false)}
                      disabled={busyId === c.id}
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-xs font-medium text-[#1a1a1a] transition-colors hover:bg-[#f7f7f8] disabled:opacity-50"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {blocked.length > 0 && (
            <section className="mt-14">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">
                Refused outright
                <span className="ml-2 tabular-nums font-normal text-[#6b6b6b]">
                  {blocked.length}
                </span>
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#525252]">
                These never reached you, because they never needed to. The broker denied them before
                anything could run.
              </p>
              <ul className="mt-5 divide-y divide-[#f0f0f0] border-y border-[#e5e5e5]">
                {blocked.slice(0, 10).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3.5">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0 self-center text-rose-600" />
                    <span className="font-mono text-sm text-[#1a1a1a]">{c.tool}</span>
                    <span className="font-mono text-[11px] text-rose-700">{c.reason}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-[#6b6b6b]">
                      {timeOf(c.createdAt)}
                    </span>
                    <p className="w-full text-sm leading-relaxed text-[#525252]">
                      {explain(c.reason)}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === 'activity' && !loading && (
        <div className="mt-8">
          {audit.length === 0 ? (
            <Empty
              icon={<ScrollText className="h-6 w-6" />}
              title="No decisions recorded yet"
              body="Every proposal the assistant makes is written here with the decision that was taken and why. Ask it to do something that writes or sends, and the first entry appears."
            />
          ) : (
            <ul className="divide-y divide-[#f0f0f0] border-y border-[#e5e5e5]">
              {audit.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 py-3.5">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      e.decision === 'DENY'
                        ? 'bg-rose-100 text-rose-800'
                        : e.decision === 'CONFIRM'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-[#f0f0f0] text-[#3f3f3f]'
                    }`}
                  >
                    {e.decision ?? e.type}
                  </span>
                  {e.tool && <span className="font-mono text-sm text-[#1a1a1a]">{e.tool}</span>}
                  {e.turnTaint && (
                    <span className="rounded-full border border-rose-200 px-2 py-0.5 text-[10px] text-rose-700">
                      tainted turn
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[#6b6b6b]">
                    {timeOf(e.at)}
                  </span>
                  {explain(e.reason) && (
                    <p className="w-full text-sm leading-relaxed text-[#525252]">
                      {explain(e.reason)}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </PageShell>
  );
};
