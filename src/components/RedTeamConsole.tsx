import React, { useState, useEffect, useCallback } from 'react';
import {
  Swords, X, AlertCircle, Loader2, ShieldCheck, ShieldAlert, Play, Zap, ChevronRight,
} from 'lucide-react';
import {
  CorpusPayload, RunResult, CorpusSummary,
  listPayloads, runPayload, runCorpus,
} from '../lib/agentApi';
import { UntrustedText } from './UntrustedText';

/**
 * The Red Team console — Amendment C, the demo surface.
 *
 * A judge picks a real injection payload, sees exactly what it tries to do,
 * fires it through the real pipeline, and watches each defensive stage report
 * what it did. It is the only place in the app where the evaluator gets to
 * attack it and fail — which is worth more than any explanation.
 *
 * The payload bodies are rendered through UntrustedText (INV-9): these ARE
 * attack strings, so the console that displays them must not itself execute
 * them.
 */

interface RedTeamConsoleProps {
  isOpen: boolean;
  onClose: () => void;
}

const OUTCOME_STYLE: Record<string, { cls: string; Icon: typeof ShieldCheck; label: string }> = {
  blocked: { cls: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: ShieldCheck, label: 'Blocked' },
  leaked: { cls: 'border-rose-300 bg-rose-50 text-rose-900', Icon: ShieldAlert, label: 'LEAKED' },
  error: { cls: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertCircle, label: 'Error' },
};

export const RedTeamConsole: React.FC<RedTeamConsoleProps> = ({ isOpen, onClose }) => {
  const [payloads, setPayloads] = useState<CorpusPayload[]>([]);
  const [results, setResults] = useState<Record<string, RunResult>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [summary, setSummary] = useState<CorpusSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayloads(await listPayloads());
    } catch (err: any) {
      setError(err?.message || 'Could not load the corpus.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const fire = async (id: string) => {
    setRunning(id);
    setError(null);
    try {
      const result = await runPayload(id);
      setResults((prev) => ({ ...prev, [id]: result }));
      setExpanded(id);
    } catch (err: any) {
      setError(err?.message || 'The run failed.');
    } finally {
      setRunning(null);
    }
  };

  const fireAll = async () => {
    setRunningAll(true);
    setError(null);
    try {
      const { summary: s, results: rs } = await runCorpus();
      setSummary(s);
      setResults(Object.fromEntries(rs.map((r) => [r.payloadId, r])));
    } catch (err: any) {
      setError(err?.message || 'The corpus run failed.');
    } finally {
      setRunningAll(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm sm:p-8">
      <div className="w-full max-w-3xl rounded-2xl border border-[#e5e0d3] bg-[#fcfaf7] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#e5e0d3] p-5">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-xl font-semibold text-[#2c2c24]">
              <Swords className="h-5 w-5 text-[#5a5a40]" />
              Red Team
            </h2>
            <p className="mt-1 max-w-lg text-xs text-[#8a8a75]">
              Real injection attacks, fired through the real pipeline. Pick one, see what it tries
              to do, and watch it fail. Nothing here is a simulation.
            </p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-[#8a8a75] transition-colors hover:bg-[#f3efe6] hover:text-[#2c2c24]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-[#e5e0d3] px-5 py-3">
          <button
            onClick={() => void fireAll()}
            disabled={runningAll}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#5a5a40] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[#484833] disabled:opacity-50"
          >
            {runningAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            Fire the whole corpus
          </button>

          {summary && (
            <div className="flex items-center gap-2 text-xs">
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 font-medium text-emerald-800">
                {summary.blocked}/{summary.attempted} blocked
              </span>
              {summary.leaked > 0 && (
                <span className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 font-medium text-rose-800">
                  {summary.leaked} leaked
                </span>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => void load()} className="cursor-pointer font-medium underline">
              Retry
            </button>
          </div>
        )}

        <div className="space-y-2 p-5">
          {loading && payloads.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#8a8a75]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading corpus…
            </div>
          )}

          {payloads.map((p) => {
            const result = results[p.id];
            const isExpanded = expanded === p.id;
            const style = result ? OUTCOME_STYLE[result.outcome] : null;

            return (
              <div key={p.id} className="rounded-xl border border-[#e5e0d3] bg-white">
                <div className="flex items-center gap-3 p-4">
                  <span className="rounded bg-[#f3efe6] px-1.5 py-0.5 font-mono text-[11px] font-medium text-[#5a5a40]">
                    {p.id}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#2c2c24]">{p.title}</span>
                      <span className="rounded border border-[#e5e0d3] px-1.5 py-0.5 text-[10px] text-[#8a8a75]">
                        {p.class.replace(/_/g, ' ')}
                      </span>
                      <span className="rounded bg-[#f3efe6] px-1.5 py-0.5 font-mono text-[10px] text-[#5a5a40]">
                        {p.invariant}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[#8a8a75]">{p.intent}</p>
                  </div>

                  {style && (
                    <span
                      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium ${style.cls}`}
                    >
                      <style.Icon className="h-3.5 w-3.5" />
                      {style.label}
                    </span>
                  )}

                  <button
                    onClick={() => void fire(p.id)}
                    disabled={running === p.id || runningAll}
                    className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#e5e0d3] px-2.5 py-1.5 text-[11px] font-medium text-[#434338] transition-colors hover:bg-[#f3efe6] disabled:opacity-50"
                  >
                    {running === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    Fire
                  </button>

                  <button
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                    className="shrink-0 cursor-pointer rounded p-1 text-[#8a8a75] hover:bg-[#f3efe6]"
                  >
                    <ChevronRight
                      className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    />
                  </button>
                </div>

                {isExpanded && (
                  <div className="border-t border-[#e5e0d3] bg-[#fcfaf7] p-4">
                    <div className="mb-3">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#8a8a75]">
                        The attack (untrusted — rendered inert)
                      </p>
                      <div className="max-h-40 overflow-y-auto rounded-lg border border-[#e5e0d3] bg-white p-2.5">
                        <UntrustedText
                          text={p.body}
                          className="font-mono text-[11px] text-[#434338]"
                        />
                      </div>
                    </div>

                    <p className="mb-2 text-[11px] text-[#434338]">
                      <span className="font-medium">Expected to stop it: </span>
                      {p.expectedBlock}
                    </p>

                    {result && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#8a8a75]">
                          What each stage did
                        </p>
                        {result.stages.map((st, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 rounded border border-[#e5e0d3] bg-white px-2.5 py-1.5 text-[11px]"
                          >
                            <span
                              className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                                st.outcome === 'blocked'
                                  ? 'bg-emerald-500'
                                  : st.outcome === 'flagged'
                                    ? 'bg-amber-500'
                                    : 'bg-[#d8d2c2]'
                              }`}
                            />
                            <span className="font-mono text-[#5a5a40]">{st.stage}</span>
                            <span className="text-[#8a8a75]">{st.detail}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
