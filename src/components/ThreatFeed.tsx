import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert, ShieldCheck, Clock, X, AlertCircle, Loader2, Check, Ban, ScrollText,
} from 'lucide-react';
import { ToolCall, AuditEvent, listToolCalls, listAudit, approveCall, rejectCall } from '../lib/agentApi';

interface ThreatFeedProps {
  isOpen: boolean;
  onClose: () => void;
}

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

export const ThreatFeed: React.FC<ThreatFeedProps> = ({ isOpen, onClose }) => {
  const [calls, setCalls] = useState<ToolCall[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [tab, setTab] = useState<'queue' | 'activity'>('queue');
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

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

  if (!isOpen) return null;

  const pending = calls.filter((c) => c.status === 'pending');
  const blocked = calls.filter((c) => c.decision === 'DENY');

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 backdrop-blur-sm p-4 sm:p-8 overflow-y-auto">
      <div className="w-full max-w-3xl rounded-2xl border border-[#e5e0d3] bg-[#fcfaf7] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#e5e0d3] p-5">
          <div>
            <h2 className="font-serif text-xl font-semibold text-[#2c2c24]">Agent Activity</h2>
            <p className="mt-1 max-w-lg text-xs text-[#8a8a75]">
              The assistant can propose actions, but it cannot perform them. Every proposal is
              decided by a policy engine that never consults a language model, and every decision
              is recorded here.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#8a8a75] hover:bg-[#f3efe6] hover:text-[#2c2c24] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-[#e5e0d3] px-5 pt-3">
          {(['queue', 'activity'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
                tab === t
                  ? 'border-b-2 border-[#5a5a40] text-[#2c2c24]'
                  : 'text-[#8a8a75] hover:text-[#434338]'
              }`}
            >
              {t === 'queue' ? `Awaiting approval (${pending.length})` : `All decisions (${audit.length})`}
            </button>
          ))}
        </div>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => void load()} className="font-medium underline cursor-pointer">
              Retry
            </button>
          </div>
        )}

        <div className="space-y-3 p-5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#8a8a75]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {tab === 'queue' && !loading && (
            <>
              {pending.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#e5e0d3] bg-white/60 p-8 text-center">
                  <ShieldCheck className="mx-auto h-8 w-8 text-emerald-600" />
                  <p className="mt-3 font-serif text-base text-[#2c2c24]">Nothing awaiting approval</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-[#8a8a75]">
                    Write actions appear here for an explicit click before they run.
                  </p>
                </div>
              )}

              {pending.map((c) => (
                <div key={c.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-700" />
                    <span className="font-mono text-xs font-medium text-[#2c2c24]">{c.tool}</span>
                    <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-900">
                      write
                    </span>
                  </div>

                  {/* B.4: the exact arguments, not a summary of them. */}
                  <pre className="mt-2 overflow-x-auto rounded-lg border border-[#e5e0d3] bg-white p-2.5 font-mono text-[11px] text-[#434338]">
{JSON.stringify(c.args, null, 2)}
                  </pre>

                  {c.originSourceIds.length > 0 && (
                    <p className="mt-2 text-[11px] text-[#8a8a75]">
                      Context included: {c.originSourceIds.join(', ')}
                    </p>
                  )}

                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => void act(c.id, true)}
                      disabled={busyId === c.id}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[#5a5a40] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#484833] disabled:opacity-50 cursor-pointer"
                    >
                      {busyId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Approve and run
                    </button>
                    <button
                      onClick={() => void act(c.id, false)}
                      disabled={busyId === c.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-1.5 text-xs font-medium text-[#434338] hover:bg-[#f3efe6] disabled:opacity-50 cursor-pointer"
                    >
                      <Ban className="h-3.5 w-3.5" /> Reject
                    </button>
                  </div>
                </div>
              ))}

              {blocked.length > 0 && (
                <div className="mt-6">
                  <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#434338]">
                    <ShieldAlert className="h-4 w-4 text-rose-700" />
                    Refused ({blocked.length})
                  </h3>
                  {blocked.slice(0, 10).map((c) => (
                    <div key={c.id} className="mb-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium text-[#2c2c24]">{c.tool}</span>
                        <span className="font-mono text-[10px] text-rose-700">{c.reason}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#434338]">{explain(c.reason)}</p>
                      {c.originSourceIds.length > 0 && (
                        <p className="mt-1 text-[11px] text-[#8a8a75]">
                          Originating source: {c.originSourceIds.join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {tab === 'activity' && !loading && (
            <>
              {audit.length === 0 && (
                <div className="rounded-xl border border-dashed border-[#e5e0d3] bg-white/60 p-8 text-center">
                  <ScrollText className="mx-auto h-8 w-8 text-[#b5b0a0]" />
                  <p className="mt-3 font-serif text-base text-[#2c2c24]">No activity yet</p>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-[#8a8a75]">
                    Ask the assistant something that would need a tool, and every decision lands here.
                  </p>
                </div>
              )}

              {audit.map((e) => (
                <div key={e.id} className="rounded-lg border border-[#e5e0d3] bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        e.decision === 'DENY'
                          ? 'bg-rose-100 text-rose-800'
                          : e.decision === 'CONFIRM'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {e.decision || e.type}
                    </span>
                    {e.tool && (
                      <span className="font-mono text-xs text-[#2c2c24]">{e.tool}</span>
                    )}
                    {e.turnTaint && (
                      <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                        tainted turn
                      </span>
                    )}
                    <span className="ml-auto text-[10px] text-[#8a8a75]">{timeOf(e.at)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#434338]">{explain(e.reason)}</p>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
