import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, X, AlertCircle, Loader2 } from 'lucide-react';
import { GlobalMetrics, fetchMetrics } from '../lib/agentApi';

/**
 * Fleet security — Amendment E.
 *
 * Deliberately the least interesting panel in the application, and that is the
 * design. An administrator sees counters: how many attacks were fired, how many
 * the perimeter held, the spread by class. They do not see who fired them, what
 * anyone wrote, or a single line of anyone's journal — and no code path exists
 * that would let them. INV-3 is unweakened.
 *
 * A security dashboard that reads private journals would contradict the product
 * it reports on.
 */

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  const [metrics, setMetrics] = useState<GlobalMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMetrics(await fetchMetrics());
    } catch (err: any) {
      setError(err?.message || 'Could not load metrics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  const held =
    metrics && metrics.totalRuns > 0
      ? Math.round((metrics.blocked / metrics.totalRuns) * 100)
      : null;

  // Explicitly typed: the ternary's empty-array branch otherwise widens the
  // tuple element to never and the comparator stops type-checking.
  const classes: [string, number][] = metrics
    ? (Object.entries(metrics.byClass) as [string, number][]).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="fixed inset-0 z-40 anim-backdrop flex items-start justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm sm:p-8">
      <div className="w-full max-w-2xl anim-panel rounded-2xl border border-[#e5e5e5] bg-[#ffffff] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#e5e5e5] p-5">
          <div>
            <h2 className="flex items-center gap-2 font-serif text-xl font-semibold text-[#1a1a1a]">
              <ShieldCheck className="h-5 w-5 text-[#1a1a1a]" />
              Fleet security
            </h2>
            <p className="mt-1 max-w-lg text-xs text-[#6b6b6b]">
              Counters across every account. No names, no entries, no attack text — an
              administrator can see how the perimeter is performing and nothing about anyone.
            </p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-1.5 text-[#6b6b6b] hover:bg-[#f7f7f8] hover:text-[#1a1a1a]"
          >
            <X className="h-5 w-5" />
          </button>
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

        <div className="space-y-4 p-5">
          {loading && !metrics && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#6b6b6b]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {metrics && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([
                  { label: 'Attacks fired', value: metrics.totalRuns, tone: 'text-[#1a1a1a]' },
                  { label: 'Held', value: metrics.blocked, tone: 'text-emerald-800' },
                  {
                    label: 'Reached execution',
                    value: metrics.leaked,
                    tone: metrics.leaked > 0 ? 'text-rose-800' : 'text-[#1a1a1a]',
                  },
                  { label: 'Held rate', value: held === null ? '—' : `${held}%`, tone: 'text-emerald-800' },
                ] as { label: string; value: string | number; tone: string }[]).map(({ label, value, tone }) => (
                  <div
                    key={label}
                    className="rounded-xl border border-[#e5e5e5] bg-white p-3.5"
                  >
                    <p className="text-[11px] text-[#6b6b6b]">{label}</p>
                    <p className={`mt-1 font-serif text-2xl font-semibold ${tone}`}>{value}</p>
                  </div>
                ))}
              </div>

              {classes.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-medium text-[#3f3f3f]">By attack class</h3>
                  <div className="space-y-1.5">
                    {classes.map(([name, count]) => (
                      <div
                        key={name}
                        className="flex items-center gap-2 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-[11px]"
                      >
                        <span className="font-mono text-[#1a1a1a]">{name.replace(/_/g, ' ')}</span>
                        <span className="ml-auto font-medium text-[#1a1a1a]">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {metrics.updatedAt && (
                <p className="text-[11px] text-[#6b6b6b]">
                  Last attack recorded {new Date(metrics.updatedAt).toLocaleString()}.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
