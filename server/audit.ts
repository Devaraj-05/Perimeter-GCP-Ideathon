import { adminDb } from './auth';
// Type-only: policy.ts is superseded and must not be reachable at runtime.
import type { Decision, Reason } from './policy';
import { SideEffect } from './tools';

/**
 * Audit log - Amendment B.5.
 *
 * Every decision is recorded BEFORE the executor runs. Writing afterwards would
 * mean a crash mid-execution leaves no trace of what was attempted, which is
 * exactly the case the log exists for.
 *
 * Append-only is enforced in firestore.rules (create permitted, update and
 * delete denied), not here. Application-level convention is insufficient: the
 * guarantee has to survive this file being wrong.
 */

export interface AuditEvent {
  type: 'tool_decision' | 'tool_execution' | 'ingest_run' | 'approval';
  tool?: string;
  args?: Record<string, unknown>;
  decision?: Decision;
  reason?: Reason | string;
  sideEffect?: SideEffect | null;
  turnTaint?: boolean;
  originSourceIds?: string[];
  detail?: string;
}

/** Keeps a hostile payload from bloating the audit document. */
function truncateArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    out[k] = typeof v === 'string' && v.length > 1000 ? `${v.slice(0, 1000)}…[truncated]` : v;
  }
  return out;
}

/**
 * Records one decision. Never throws: an audit failure must not become a path
 * to skipping the decision it was recording. Callers treat a false return as a
 * reason to deny, per B.6.
 */
export async function writeAudit(uid: string, event: AuditEvent): Promise<boolean> {
  try {
    const doc = adminDb().collection('users').doc(uid).collection('audit').doc();
    await doc.set({
      id: doc.id,
      type: event.type,
      tool: event.tool ?? null,
      args: truncateArgs(event.args),
      decision: event.decision ?? null,
      reason: event.reason ?? null,
      sideEffect: event.sideEffect ?? null,
      turnTaint: event.turnTaint ?? false,
      originSourceIds: event.originSourceIds ?? [],
      detail: event.detail ?? null,
      at: new Date().toISOString(),
    });
    return true;
  } catch (err: any) {
    console.error('[audit] write failed:', err?.message);
    return false;
  }
}
