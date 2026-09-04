import React, { useState, useEffect, useCallback } from 'react';
import { KeyRound, X, AlertCircle, Loader2, Trash2, Check, Clock, ShieldCheck } from 'lucide-react';
import {
  Capability,
  listCapabilities,
  grantCapability,
  revokeCapability,
  Destination,
  Delivery,
  listDestinations,
  createDestination,
  listDeliveries,
} from '../lib/agentApi';
import { UntrustedText } from './UntrustedText';
import { listSources } from '../lib/perimeterApi';

/**
 * The Permissions screen — INV-4, made visible.
 *
 * This is the OAuth consent pattern applied to an agent's own tools. The user
 * sees exactly what the assistant is currently allowed to do, when each
 * permission expires, and can revoke any of it.
 *
 * It is also the ONLY place a capability comes into existence. There is no
 * mint tool in the registry, the model cannot propose one, and Firestore rules
 * deny client writes to the collection. Deny-by-default means something only
 * because the default cannot be changed by the thing it constrains.
 */

interface PermissionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

/** What a user can grant, described in their language rather than the code's. */
const GRANTABLE = [
  {
    tool: 'search_artifacts',
    resource: 'entries:own',
    label: 'Search my saved material',
    detail: 'Look through things you have saved. Read-only.',
    risk: 'low' as const,
  },
  {
    tool: 'summarise_source',
    resource: 'entries:own',
    label: 'Summarise a connected source',
    detail: 'Describe what is in one of your connected sources. Read-only.',
    risk: 'low' as const,
  },
  {
    tool: 'send_digest',
    resource: 'destination:SANDBOX',
    label: 'Send a digest to a destination',
    detail:
      'Send a summary to a destination you created. Every destination here is a sandbox: the delivery is recorded and discarded, and nothing leaves the app.',
    risk: 'egress' as const,
  },
  {
    tool: 'create_note',
    resource: 'entries:own',
    label: 'Write notes into my journal',
    detail: 'Create a new entry on your behalf. This changes your data.',
    risk: 'write' as const,
  },
];

function remaining(expiresAt: string): string {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

function isLive(cap: Capability): boolean {
  if (cap.revokedAt) return false;
  if (cap.oneShot && cap.usedAt) return false;
  const expiry = Date.parse(cap.expiresAt);
  return Number.isFinite(expiry) && expiry > Date.now();
}

export const PermissionsPanel: React.FC<PermissionsPanelProps> = ({ isOpen, onClose }) => {
  const [caps, setCaps] = useState<Capability[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, d] = await Promise.all([listCapabilities(), listDestinations()]);
      setCaps(c);
      setDestinations(d);

      // Pull the evidence for each destination. A failure here must not blank
      // the permissions list, which is the panel's primary job.
      const byDest: Record<string, Delivery[]> = {};
      await Promise.all(
        d.map(async (dest) => {
          try {
            byDest[dest.id] = await listDeliveries(dest.id);
          } catch {
            byDest[dest.id] = [];
          }
        }),
      );
      setDeliveries(byDest);
    } catch (err: any) {
      setError(err?.message || 'Could not load permissions.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  const grant = async (tool: string, resource: string) => {
    setBusy(tool);
    setError(null);
    try {
      // A grant must carry the SAME resource string the broker computes at
      // decision time (broker.ts resourceOf). Anything else produces a
      // capability that looks active in this list and is denied on every use
      // for capability_scope_mismatch — worse than refusing outright, because
      // the failure surfaces as a broken security model rather than a missing
      // permission.
      //
      // Two tools are scoped per-object and must be resolved here:
      if (tool === 'send_digest') {
        const existing = destinations[0] ?? (await createDestination('Sandbox destination'));
        await grantCapability({ tool, resource: `destination:${existing.id}`, hours: 24 });
      } else if (tool === 'summarise_source') {
        // resourceOf returns `source:<sourceId>`, so one grant per connected
        // source. That is least privilege rather than a shortcut: a grant for
        // one source does not silently cover a source added later.
        const sources = await listSources();
        if (sources.length === 0) {
          setError('Connect a source under "What it reads" first — there is nothing to allow yet.');
          return;
        }
        for (const src of sources) {
          await grantCapability({ tool, resource: `source:${src.id}`, hours: 24 });
        }
      } else {
        await grantCapability({ tool, resource, hours: 24 });
      }

      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not grant that permission.');
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (capId: string) => {
    setBusy(capId);
    setError(null);
    try {
      await revokeCapability(capId);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not revoke that permission.');
    } finally {
      setBusy(null);
    }
  };

  if (!isOpen) return null;

  const live = caps.filter(isLive);
  const past = caps.filter((c) => !isLive(c));
  const liveFor = (tool: string) => live.find((c) => c.tool === tool);

  /** How many distinct objects the live grants for a tool actually cover. */
  const scopeCount = (tool: string) =>
    new Set(live.filter((c) => c.tool === tool).map((c) => c.resource)).size;

  return (
    <div className="fixed inset-0 z-40 anim-backdrop flex items-start justify-center overflow-y-auto bg-black/30 p-4 backdrop-blur-sm sm:p-8">
      <div className="w-full max-w-2xl anim-panel rounded-2xl border border-[#e5e0d3] bg-[#fcfaf7] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[#e5e0d3] p-5">
          <div>
            <h2 className="font-serif text-xl font-semibold text-[#2c2c24]">What it can do</h2>
            <p className="mt-1 max-w-lg text-xs text-[#8a8a75]">
              What the assistant is allowed to do on your behalf. Nothing runs without a
              permission you granted here — not even when the assistant asks for it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="cursor-pointer rounded-lg p-2 text-[#8a8a75] transition-colors hover:bg-[#f3efe6] hover:text-[#2c2c24]"
          >
            <X className="h-4 w-4" />
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

        <div className="space-y-3 p-5">
          {loading && caps.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#8a8a75]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {GRANTABLE.map((g) => {
            const active = liveFor(g.tool);
            return (
              <div
                key={g.tool}
                className={`rounded-xl border p-4 ${
                  active ? 'border-emerald-200 bg-emerald-50/40' : 'border-[#e5e0d3] bg-white'
                }`}
              >
                <div className="flex items-start gap-3">
                  <KeyRound
                    className={`mt-0.5 h-4 w-4 shrink-0 ${
                      active ? 'text-emerald-700' : 'text-[#8a8a75]'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-[#2c2c24]">{g.label}</span>
                      {g.risk === 'egress' && (
                        <span className="rounded border border-rose-300 bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-rose-900">
                          leaves the app
                        </span>
                      )}
                      {g.risk === 'write' && (
                        <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-900">
                          changes data
                        </span>
                      )}
                      {active && (
                        <span className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-900">
                          <Clock className="h-3 w-3" />
                          {remaining(active.expiresAt)}
                        </span>
                      )}
                      {/* Per-object grants cover the objects that existed when
                          you granted them, because the broker matches on the
                          exact resource string. Saying only "Active" would be a
                          softer claim than the broker will honour — a source
                          connected later is NOT covered, and the user should
                          learn that here rather than from a refusal. */}
                      {active && g.tool === 'summarise_source' && (
                        <span className="rounded border border-[#e5e0d3] bg-[#f3efe6] px-1.5 py-0.5 text-[10px] text-[#5a5a40]">
                          {scopeCount(g.tool)} source{scopeCount(g.tool) === 1 ? '' : 's'} · re-allow
                          after adding one
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-[#8a8a75]">{g.detail}</p>
                    <p className="mt-1 font-mono text-[10px] text-[#b5b0a0]">{g.tool}</p>
                  </div>

                  {active ? (
                    <button
                      onClick={() => void revoke(active.id)}
                      disabled={busy === active.id}
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[#e5e0d3] bg-white px-3 py-1.5 text-xs font-medium text-[#434338] transition-colors hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50"
                    >
                      {busy === active.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Revoke
                    </button>
                  ) : (
                    <button
                      onClick={() => void grant(g.tool, g.resource)}
                      disabled={busy === g.tool}
                      className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[#5a5a40] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#484833] disabled:opacity-50"
                    >
                      {busy === g.tool ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Allow for 24h
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {live.length === 0 && !loading && (
            <div className="rounded-xl border border-dashed border-[#e5e0d3] bg-white/60 p-6 text-center">
              <ShieldCheck className="mx-auto h-7 w-7 text-emerald-600" />
              <p className="mt-2 font-serif text-sm text-[#2c2c24]">
                The assistant currently has no permissions
              </p>
              <p className="mx-auto mt-1 max-w-md text-xs text-[#8a8a75]">
                It can still talk with you. It just cannot take any action until you allow one
                above — and it will tell you what it could not do.
              </p>
            </div>
          )}

          {/* Egress evidence.
              The whole point of INV-5 is that a send can be refused — but a
              refusal that leaves no trace on screen is indistinguishable from
              nothing having happened, which made the strongest security moment
              in the product read as a dead button. These rows show what a
              digest actually contained: its size, its fingerprint, and the
              first 200 characters. Nothing here is a second copy of the body;
              the server stored exactly this much and no more.

              The preview goes through UntrustedText because it originates from
              model output (INV-9). It is never rendered as markup. */}
          {destinations.length > 0 && (
            <div className="pt-2">
              <h3 className="mb-2 text-xs font-medium text-[#434338]">
                Destinations and what was sent to them
              </h3>
              <div className="space-y-2">
                {destinations.map((d) => {
                  const rows = deliveries[d.id] ?? [];
                  return (
                    <div
                      key={d.id}
                      className="rounded-xl border border-[#e5e0d3] bg-white p-3.5"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-[#2c2c24]">{d.label}</span>
                        <span className="rounded border border-[#d8cfae] bg-[#fbf6e6] px-1.5 py-0.5 text-[10px] font-medium uppercase text-[#5a5a40]">
                          sandbox
                        </span>
                        <span className="ml-auto text-[11px] text-[#8a8a75]">
                          {rows.length === 0
                            ? 'nothing sent'
                            : `${rows.length} delivery${rows.length === 1 ? '' : 's'}`}
                        </span>
                      </div>

                      <p className="mt-1 text-[11px] text-[#8a8a75]">
                        Recorded against a sandbox. Nothing left the application.
                      </p>

                      {rows.length > 0 && (
                        <div className="mt-2.5 space-y-2">
                          {rows.map((r) => (
                            <div
                              key={r.id}
                              className="rounded-lg border border-[#e5e0d3] bg-[#fcfaf7] p-2.5"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8a8a75]">
                                <span className="font-medium text-[#434338]">
                                  {r.bodyLength} bytes
                                </span>
                                <span className="font-mono">
                                  sha256 {String(r.bodySha256).slice(0, 12)}…
                                </span>
                                <span className="ml-auto">
                                  {new Date(r.at).toLocaleString()}
                                </span>
                              </div>
                              <div className="mt-1.5 border-t border-[#e5e0d3] pt-1.5">
                                <UntrustedText
                                  text={r.preview}
                                  className="text-[11px] text-[#434338]"
                                  placeholder="Empty body."
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div className="pt-2">
              <h3 className="mb-2 text-xs font-medium text-[#434338]">
                Expired and revoked ({past.length})
              </h3>
              <div className="space-y-1.5">
                {past.slice(0, 8).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center gap-2 rounded-lg border border-[#e5e0d3] bg-white/60 px-3 py-2 text-[11px] text-[#8a8a75]"
                  >
                    <span className="font-mono text-[#434338]">{c.tool}</span>
                    <span className="ml-auto">
                      {c.revokedAt ? 'revoked' : c.usedAt ? 'used' : 'expired'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
