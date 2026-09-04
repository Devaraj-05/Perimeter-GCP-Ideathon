import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Github, Plus, RefreshCw, Trash2, ShieldAlert, ShieldCheck, ShieldQuestion,
  AlertCircle, X, ExternalLink, Loader2,
} from 'lucide-react';
import { Source, Artifact, Verdict } from '../types';
import { listSources, addSource, removeSource, listArtifacts, runIngest } from '../lib/perimeterApi';

interface SourcesPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onArtifactsChanged?: (artifacts: Artifact[]) => void;
}

const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  clean: {
    label: 'Clean',
    cls: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    Icon: ShieldCheck,
  },
  suspicious: {
    label: 'Suspicious',
    cls: 'bg-amber-50 text-amber-900 border-amber-200',
    Icon: ShieldQuestion,
  },
  hostile: {
    label: 'Hostile',
    cls: 'bg-rose-50 text-rose-800 border-rose-200',
    Icon: ShieldAlert,
  },
};

function relativeTime(iso: string | null): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export const SourcesPanel: React.FC<SourcesPanelProps> = ({
  isOpen,
  onClose,
  onArtifactsChanged,
}) => {
  const [sources, setSources] = useState<Source[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newRef, setNewRef] = useState('');
  const [adding, setAdding] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  /**
   * Held in a ref rather than closed over.
   *
   * A parent passing an inline arrow gives this prop a new identity on every
   * render. With the callback in load()'s dependency array that made load()
   * unstable, which re-fired the mount effect, which set state, which
   * re-rendered - an infinite loop that presented as a spinner that never
   * stopped and quietly hammered the API behind it.
   *
   * A ref keeps the newest callback available without making load() depend on
   * it, so the panel is correct regardless of how the parent passes the prop.
   */
  const onArtifactsChangedRef = useRef(onArtifactsChanged);
  useEffect(() => {
    onArtifactsChangedRef.current = onArtifactsChanged;
  }, [onArtifactsChanged]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, a] = await Promise.all([listSources(), listArtifacts()]);
      setSources(s);
      setArtifacts(a);
      onArtifactsChangedRef.current?.(a);
    } catch (err: any) {
      setError(err?.message || 'Could not load your sources.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const ref = newRef.trim();
    if (!ref || adding) return;

    setAdding(true);
    setError(null);
    try {
      const created = await addSource(ref);
      setSources((prev) => [created, ...prev]);
      // Only clear the input once the write is confirmed (Directive 6).
      setNewRef('');
    } catch (err: any) {
      setError(err?.message || 'Could not add that repository.');
    } finally {
      setAdding(false);
    }
  };

  const handleRun = async (sourceId: string) => {
    setRunningId(sourceId);
    setError(null);
    try {
      await runIngest(sourceId);
    } catch (err: any) {
      setError(err?.message || 'Ingest failed.');
    } finally {
      setRunningId(null);
      // Reload either way: a failed run still records lastRunError, and hiding
      // that would make a silent failure look like nothing happened.
      await load();
    }
  };

  const handleRemove = async (sourceId: string) => {
    setError(null);
    try {
      await removeSource(sourceId);
      setSources((prev) => prev.filter((s) => s.id !== sourceId));
      setArtifacts((prev) => prev.filter((a) => a.sourceId !== sourceId));
    } catch (err: any) {
      setError(err?.message || 'Could not remove that repository.');
    }
  };

  if (!isOpen) return null;

  const counts = artifacts.reduce<Record<string, number>>((acc, a) => {
    acc[a.verdict] = (acc[a.verdict] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="fixed inset-0 z-40 anim-backdrop flex items-start justify-center bg-black/30 backdrop-blur-sm p-4 sm:p-8 overflow-y-auto">
      <div className="w-full max-w-3xl anim-panel rounded-2xl border border-[#e5e0d3] bg-[#fcfaf7] shadow-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[#e5e0d3] p-5">
          <div>
            <h2 className="font-serif text-xl font-semibold text-[#2c2c24]">What it reads</h2>
            <p className="mt-1 text-xs text-[#8a8a75] max-w-lg">
              Connect public repositories so your reflections can draw on real project context.
              Everything fetched here is treated as <strong>untrusted</strong> and screened before
              Gemini is allowed to read it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#8a8a75] hover:bg-[#f3efe6] hover:text-[#2c2c24] transition-colors cursor-pointer"
            title="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>


        {/* Add form */}
        <form onSubmit={handleAdd} className="flex gap-2 border-b border-[#e5e0d3] p-5">
          <div className="relative flex-1">
            <Github className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a75]" />
            <input
              value={newRef}
              onChange={(e) => setNewRef(e.target.value)}
              placeholder="owner/repository — e.g. facebook/react"
              className="w-full rounded-lg border border-[#e5e0d3] bg-white py-2.5 pl-9 pr-3 text-sm text-[#2c2c24] placeholder:text-[#b5b0a0] focus:border-[#5a5a40] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={adding || !newRef.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#5a5a40] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#484833] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </button>
        </form>

        {error && (
          <div className="mx-5 mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              onClick={() => void load()}
              className="shrink-0 font-medium underline hover:no-underline cursor-pointer"
            >
              Retry
            </button>
          </div>
        )}

        {/* Detection summary */}
        {artifacts.length > 0 && (
          <div className="flex flex-wrap gap-2 px-5 pt-4">
            {(['clean', 'suspicious', 'hostile'] as Verdict[]).map((v) => {
              const { label, cls, Icon } = VERDICT_STYLE[v];
              return (
                <span
                  key={v}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium ${cls}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {counts[v] || 0} {label}
                </span>
              );
            })}
          </div>
        )}

        {/* Sources */}
        <div className="space-y-3 p-5">
          {loading && sources.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-[#8a8a75]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading sources…
            </div>
          )}

          {!loading && sources.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#e5e0d3] bg-white/60 p-8 text-center">
              <Github className="mx-auto h-8 w-8 text-[#b5b0a0]" />
              <p className="mt-3 font-serif text-base text-[#2c2c24]">No sources connected</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[#8a8a75]">
                Add a public repository above. Its open issues become context your journal can
                reason about — screened first, so a poisoned issue cannot hijack the assistant.
              </p>
            </div>
          )}

          {sources.map((source) => {
            const own = artifacts.filter((a) => a.sourceId === source.id);
            const hostileCount = own.filter((a) => a.verdict === 'hostile').length;
            const isExpanded = expanded === source.id;

            return (
              <div
                key={source.id}
                className="rounded-xl border border-[#e5e0d3] bg-white overflow-hidden"
              >
                <div className="flex items-center gap-3 p-4">
                  <Github className="h-5 w-5 shrink-0 text-[#5a5a40]" />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-[#2c2c24]">
                        {source.ref}
                      </span>
                      <span className="shrink-0 rounded border border-[#e5e0d3] bg-[#f3efe6] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#5a5a40]">
                        untrusted
                      </span>
                      {hostileCount > 0 && (
                        <span className="shrink-0 rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-800">
                          {hostileCount} hostile
                        </span>
                      )}
                    </div>

                    {/* A.5: last-run state is always visible. A background job
                        that fails silently is a defect. */}
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-[#8a8a75]">
                      <span>
                        {own.length} artifact{own.length === 1 ? '' : 's'}
                      </span>
                      <span>·</span>
                      <span>
                        {source.lastRunStatus === 'error' ? (
                          <span className="text-rose-700">failed {relativeTime(source.lastRunAt)}</span>
                        ) : source.lastRunStatus === 'ok' ? (
                          <span>ran {relativeTime(source.lastRunAt)}</span>
                        ) : (
                          <span>never run</span>
                        )}
                      </span>
                    </div>

                    {source.lastRunError && (
                      <p className="mt-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">
                        {source.lastRunError}
                      </p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {own.length > 0 && (
                      <button
                        onClick={() => setExpanded(isExpanded ? null : source.id)}
                        className="rounded-lg border border-[#e5e0d3] px-2.5 py-1.5 text-[11px] font-medium text-[#434338] hover:bg-[#f3efe6] transition-colors cursor-pointer"
                      >
                        {isExpanded ? 'Hide' : 'Inspect'}
                      </button>
                    )}
                    <button
                      onClick={() => void handleRun(source.id)}
                      disabled={runningId === source.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e0d3] px-2.5 py-1.5 text-[11px] font-medium text-[#434338] hover:bg-[#f3efe6] disabled:opacity-50 transition-colors cursor-pointer"
                      title="Fetch open issues now"
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${runningId === source.id ? 'animate-spin' : ''}`}
                      />
                      {runningId === source.id ? 'Running…' : 'Run ingest'}
                    </button>
                    <button
                      onClick={() => void handleRemove(source.id)}
                      className="rounded-lg p-1.5 text-[#8a8a75] hover:bg-rose-50 hover:text-rose-700 transition-colors cursor-pointer"
                      title="Remove source and its artifacts"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Artifact detail */}
                {isExpanded && (
                  <div className="divide-y divide-[#f0ede6] border-t border-[#e5e0d3] bg-[#fcfaf7]">
                    {own.map((a) => {
                      const { label, cls, Icon } = VERDICT_STYLE[a.verdict];
                      return (
                        <div key={a.id} className="p-4">
                          <div className="flex items-start gap-2">
                            <span
                              className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}
                            >
                              <Icon className="h-3 w-3" />
                              {label}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-xs font-medium text-[#2c2c24]">
                                  #{a.externalId} {a.title}
                                </span>
                                {a.url && (
                                  <a
                                    href={a.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="shrink-0 text-[#8a8a75] hover:text-[#5a5a40]"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                )}
                              </div>
                              <div className="mt-0.5 text-[11px] text-[#8a8a75]">
                                by {a.author} · threat {(a.threatScore * 100).toFixed(0)}%
                                {a.classifierError && ' · classifier abstained'}
                              </div>

                              {a.signals.length > 0 && (
                                <div className="mt-1.5 flex flex-wrap gap-1">
                                  {a.signals.map((s) => (
                                    <span
                                      key={s}
                                      className="rounded bg-[#f3efe6] px-1.5 py-0.5 font-mono text-[10px] text-[#5a5a40]"
                                    >
                                      {s}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
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
