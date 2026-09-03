import React, { useState, useEffect, useCallback } from 'react';
import {
  ScrollText, X, AlertCircle, Loader2, ShieldCheck, ShieldAlert, Link2,
  BookOpen, Wrench, Eye, RefreshCw,
} from 'lucide-react';
import {
  PerimeterEvent,
  ChainVerification,
  listPerimeterEvents,
  verifyPerimeterChain,
} from '../lib/agentApi';
import { auth, subscribeToPerimeterLog } from '../lib/firebase';

/**
 * The Perimeter Log — INV-6 and INV-7 made visible.
 *
 * Every decision the system made, in the order it made them, with the reason
 * and the invariant that produced it. The point is not that the log exists —
 * it is that a person who does not know what prompt injection is can read a
 * row and understand what the app refused to do on their behalf.
 *
 * The Verify button walks the hash chain. That turns "we keep an audit log"
 * into "check it yourself", which is a materially different claim.
 */

interface PerimeterLogPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const KIND_META: Record<string, { icon: typeof Eye; label: string }> = {
  ingest: { icon: Link2, label: 'Read external content' },
  reader: { icon: Eye, label: 'Analysed in quarantine' },
  plan: { icon: BookOpen, label: 'Assistant proposed' },
  decision: { icon: ShieldCheck, label: 'Decision' },
  execute: { icon: Wrench, label: 'Action ran' },
  redteam: { icon: ShieldAlert, label: 'Red team' },
  error: { icon: AlertCircle, label: 'Error' },
};

/** Machine reason codes rendered as sentences a non-technical user can act on. */
function explain(reason: string, invariant: string | null): string {
  const code = String(reason).split(':')[0];
  const table: Record<string, string> = {
    no_capability_grant:
      'Refused. The assistant has not been given permission for that action.',
    capability_scope_mismatch:
      'Refused. The permission granted does not cover that specific target.',
    capability_expired: 'Refused. That permission had expired.',
    capability_revoked: 'Refused. You had revoked that permission.',
    capability_already_used: 'Refused. That was a one-time permission, already used.',
    tainted_egress_payload:
      'Held. This would send content derived from an external document out of the app.',
    rate_limited: 'Refused. That action hit its hourly limit.',
    unknown_tool: 'Refused. The assistant asked for a tool that does not exist.',
    invalid_args: 'Refused. The request was incomplete.',
    capability_matched: 'Allowed by a permission you granted.',
    capability_granted: 'You granted a permission.',
    capability_revoked_by_user: 'You revoked a permission.',
    executed: 'Completed.',
    execution_failed: 'The action failed while running.',
    audit_write_failed: 'Refused. The decision could not be recorded, so it did not happen.',
  };

  if (table[code]) return table[code];

  if (code === 'fetched') return `External content read and screened (${reason.split(':')[1]}).`;

  // redteam:<payload>:<outcome> — rendered as a sentence rather than echoing
  // the code, which previously made every row print the same string twice.
  if (code === 'redteam') {
    const [, payload, outcome] = reason.split(':');
    if (payload === 'corpus') {
      return `Ran the full injection corpus. ${String(outcome || '').replace('_blocked', ' blocked')}.`;
    }
    if (outcome === 'blocked') {
      return `Attack ${payload} was fired at the app and refused.`;
    }
    if (outcome === 'leaked') {
      return `Attack ${payload} was fired and REACHED EXECUTION. This is a finding.`;
    }
    return `Attack ${payload} was fired; outcome ${outcome}.`;
  }

  if (invariant === 'INV-11') return `Refused to fetch that link. ${reason}`;
  return reason;
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString();
}

export const PerimeterLogPanel: React.FC<PerimeterLogPanelProps> = ({ isOpen, onClose }) => {
  const [events, setEvents] = useState<PerimeterEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [isLive, setIsLive] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await listPerimeterEvents());
    } catch (err: any) {
      setError(err?.message || 'Could not load the log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    // Read directly from Firestore so rows appear as the server writes them.
    // firestore.rules permits the owner to READ this collection; writes stay
    // denied, so watching the log cannot compromise it.
    const uid = auth.currentUser?.uid;
    if (!uid) {
      void load();
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToPerimeterLog(
      uid,
      (rows) => {
        setEvents(rows as PerimeterEvent[]);
        setIsLive(true);
        setLoading(false);
        setError(null);
      },
      (message) => {
        // Degrade to the API fetch rather than showing an empty panel.
        setIsLive(false);
        setError(message);
        void load();
      },
    );

    // Without this the listener outlives the panel and leaks.
    return () => unsubscribe();
  }, [isOpen, load]);

  const verify = async () => {
    setVerifying(true);
    setError(null);
    try {
      setChain(await verifyPerimeterChain());
    } catch (err: any) {
      setError(err?.message || 'Could not verify the chain.');
    } finally {
      setVerifying(false);
    }
  };

  if (!isOpen) return null;

  const denied = events.filter((e) => e.decision === 'deny').length;

  return (
    <div className="fixed inset-0 z-40 anim-backdrop flex items-start justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm sm:p-8">
      <div className="w-full max-w-3xl anim-panel rounded-2xl border border-[#e5e0d3] bg-[#fcfaf7] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#e5e0d3] p-5">
          <div>
            <h2 className="font-serif text-xl font-semibold text-[#2c2c24]">Perimeter Log</h2>
            <p className="mt-1 max-w-lg text-xs text-[#8a8a75]">
              Everything the assistant read, proposed, and was allowed or refused. Written by the
              server only — this app cannot edit its own record, and neither can you.
            </p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-[#8a8a75] transition-colors hover:bg-[#f3efe6] hover:text-[#2c2c24]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e0d3] px-5 py-3">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e0d3] bg-white px-2 py-1 text-[11px] text-[#434338]">
            {isLive && (
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 rounded-full bg-emerald-500"
                title="Streaming"
              />
            )}
            {events.length} events{isLive ? ' · live' : ''}
          </span>
          {denied > 0 && (
            <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-800">
              {denied} refused
            </span>
          )}

          <button
            onClick={() => void load()}
            className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#434338] transition-colors hover:bg-[#f3efe6]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            onClick={() => void verify()}
            disabled={verifying}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#5a5a40] px-2.5 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-[#484833] disabled:opacity-50"
            title="Recompute the hash chain and check nothing was altered"
          >
            {verifying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Verify chain
          </button>
        </div>

        {chain && (
          <div
            className={`mx-5 mt-4 rounded-lg border p-3 text-xs ${
              !chain.intact
                ? 'border-rose-200 bg-rose-50 text-rose-900'
                : chain.partial
                  ? 'border-amber-200 bg-amber-50 text-amber-900'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            {chain.intact ? (
              chain.partial ? (
                <>
                  {/*
                    Saying "chain intact" for a log longer than one pass would
                    claim more than was checked. Amber, and say what was read.
                  */}
                  <strong>First {chain.verified} events verified.</strong> This log is longer than
                  one verification pass, so the rest has not been checked yet. The part that was
                  read is intact.
                </>
              ) : (
                <>
                  <strong>Chain intact.</strong> All {chain.count} events verified. Each record
                  carries a hash of the one before it, so removing or editing any entry would break
                  every link after it.
                </>
              )
            ) : (
              <>
                <strong>Chain broken at event {chain.brokenAt}.</strong> {chain.reason}
              </>
            )}
          </div>
        )}

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
          {loading && events.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#8a8a75]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {!loading && events.length === 0 && (
            <div className="rounded-xl border border-dashed border-[#e5e0d3] bg-white/60 p-8 text-center">
              <ScrollText className="mx-auto h-8 w-8 text-[#b5b0a0]" />
              <p className="mt-3 font-serif text-base text-[#2c2c24]">Nothing recorded yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-[#8a8a75]">
                Save a link or ask the assistant to do something. Every decision lands here.
              </p>
            </div>
          )}

          {events.map((e) => {
            const meta = KIND_META[e.kind] ?? KIND_META.decision;
            const Icon = meta.icon;
            const isDeny = e.decision === 'deny';
            const isHold = e.decision === 'confirm';

            return (
              <div
                key={e.id}
                className={`rounded-lg border p-3 ${
                  isDeny
                    ? 'border-rose-200 bg-rose-50/60'
                    : isHold
                      ? 'border-amber-200 bg-amber-50/60'
                      : 'border-[#e5e0d3] bg-white'
                }`}
              >
                <div className="flex items-start gap-2">
                  <Icon
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      isDeny ? 'text-rose-700' : isHold ? 'text-amber-700' : 'text-[#5a5a40]'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-[#2c2c24]">{meta.label}</span>
                      {e.tool && (
                        <span className="font-mono text-[11px] text-[#434338]">{e.tool}</span>
                      )}
                      {e.invariant && (
                        <span className="rounded bg-[#f3efe6] px-1.5 py-0.5 font-mono text-[10px] text-[#5a5a40]">
                          {e.invariant}
                        </span>
                      )}
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-[#b5b0a0]">
                        #{e.seq} · {timeOf(e.ts)}
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] text-[#434338]">
                      {explain(e.reason, e.invariant)}
                    </p>

                    {/* The raw code stays visible under the sentence: the plain
                        language is for the user, the code is for the writeup. */}
                    <p className="mt-0.5 font-mono text-[10px] text-[#b5b0a0]">{e.reason}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
