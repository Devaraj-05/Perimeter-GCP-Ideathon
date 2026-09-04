import { getToolSpec, SideEffect } from './tools';
import { Capability, isLive } from './capabilities';

/**
 * The capability broker — INV-4 and INV-5.
 *
 * Model output is a proposal. This decides whether it becomes an action.
 *
 * decideProposal is pure: no I/O, no clock it does not receive, no database,
 * and above all no language model. The model is the component an attacker
 * controls the input to, so it cannot participate in the control that
 * restrains it. Every input arrives as an argument, which is exactly what
 * makes each branch testable — including the branches an attacker would need.
 */

export type Decision =
  | { allow: true; capabilityId: string; reason: string; invariant: null }
  | {
      allow: false;
      reason: string;
      invariant: string;
      /** True when a fresh one-shot confirmation would unblock this. */
      needsConfirmation?: boolean;
    };

export interface Proposal {
  tool: string;
  args: Record<string, unknown>;
}

export interface BrokerInput {
  proposal: Proposal | null | undefined;
  /** The live grant found for (uid, tool, resource), or null. */
  capability: Capability | null;
  /** True when any external document contributed to this turn. */
  turnTaint: boolean;
  /** Invocations already used this window, per tool. */
  usage?: Record<string, number>;
  now?: number;
  /**
   * True only on the /approve path, where a human has already been shown this
   * exact proposal and clicked.
   *
   * It suppresses the two branches that ASK for a confirmation, and nothing
   * else. Every deny check still runs, which is the whole point of re-deciding
   * at execution time instead of trusting the verdict recorded at enqueue.
   *
   * This replaces passing turnTaint: false from the approval route to mean
   * "already confirmed". Overloading the taint flag to suppress a check made
   * the audit record of that call claim the turn was clean when it was not.
   */
  confirmed?: boolean;
}

/** Tools whose effect leaves the system. Subject to INV-5. */
export const EGRESS_TOOLS = new Set(['send_digest']);

function deny(
  reason: string,
  invariant: string,
  needsConfirmation = false,
): Decision {
  return needsConfirmation
    ? { allow: false, reason, invariant, needsConfirmation }
    : { allow: false, reason, invariant };
}

/**
 * Maps a proposal to the resource its grant must be scoped to.
 *
 * Note what this never does: read a destination out of the model's arguments
 * as a URL or an address. The model names an opaque id and the server resolves
 * it against that user's own records, which is what makes "send to
 * attacker@example.com" structurally inexpressible rather than merely detected.
 */
export function resourceOf(proposal: Proposal): string {
  switch (proposal.tool) {
    case 'send_digest':
      return `destination:${String(proposal.args?.destinationId ?? '')}`;
    case 'summarise_source':
      return `source:${String(proposal.args?.sourceId ?? '')}`;
    default:
      return 'entries:own';
  }
}

/**
 * Validates arguments against the tool manifest.
 *
 * Returns the first missing or blank required field so the refusal can say
 * which one, rather than a generic "invalid arguments" that tells the user
 * nothing actionable.
 */
export function missingArgument(proposal: Proposal): string | null {
  const spec = getToolSpec(proposal.tool);
  if (!spec) return null;

  for (const required of spec.parameters.required) {
    const value = proposal.args?.[required];
    if (typeof value !== 'string' || value.trim() === '') return required;
  }
  return null;
}

/**
 * The decision, evaluated in this order. The ordering is load-bearing.
 *
 * INV-5 is checked before the grant is honoured, so a standing permission
 * cannot authorise sending tainted data outward. That is the specific defence
 * against exfiltration-by-summary, where the attacker does not need the model
 * to read the journal aloud — only to place it in an outbound payload.
 */
export function decideProposal(input: BrokerInput): Decision {
  const { proposal, capability, turnTaint } = input;
  const confirmed = input.confirmed === true;
  const now = input.now ?? Date.now();

  // Fail closed on anything unreadable (Constitution §8).
  if (!proposal || typeof proposal !== 'object' || typeof proposal.tool !== 'string') {
    return deny('malformed_proposal', 'INV-4');
  }

  const spec = getToolSpec(proposal.tool);
  if (!spec) {
    // A tool the model invented does not exist, so this is a dead end rather
    // than an error path that leaks what tools do exist.
    return deny(`unknown_tool:${proposal.tool}`, 'INV-4');
  }

  const missing = missingArgument(proposal);
  if (missing) {
    return deny(`invalid_args:${missing}`, 'INV-4');
  }

  const resource = resourceOf(proposal);

  if (!capability) {
    return deny(`no_capability_grant:${proposal.tool}:${resource}`, 'INV-4');
  }
  if (capability.tool !== proposal.tool || capability.resource !== resource) {
    // A grant for a different tool or resource is not a grant for this one.
    return deny(`capability_scope_mismatch:${proposal.tool}:${resource}`, 'INV-4');
  }
  if (!isLive(capability, now)) {
    const why = capability.revokedAt
      ? 'capability_revoked'
      : capability.oneShot && capability.usedAt
        ? 'capability_already_used'
        : 'capability_expired';
    return deny(`${why}:${proposal.tool}`, 'INV-4');
  }

  // INV-5. Tainted data heading outward always needs a fresh yes, regardless
  // of what standing grant exists.
  if (EGRESS_TOOLS.has(proposal.tool) && turnTaint === true && !confirmed) {
    return deny(`tainted_egress_payload:${proposal.tool}`, 'INV-5', true);
  }

  if (isRateLimited(spec.name, spec.rateLimitPerHour, input.usage)) {
    return deny(`rate_limited:${proposal.tool}`, 'INV-4');
  }

  // S2 — every write-class invocation needs a fresh human click, whatever
  // standing grant exists. A grant says the user is willing to let this tool
  // run at all; it is not the user agreeing to THIS note, with THIS text, now.
  //
  // This gate lived in server/policy.ts and was tested there. When the broker
  // replaced that engine it kept the tainted-egress confirmation and dropped
  // this one, and policy.ts became unreachable — so create_note executed
  // silently on a standing grant while problem-statement.md S2, the README
  // diagram and AUDIT.md all said writes awaited a click.
  //
  // Deliberately last: a missing grant, a scope mismatch, an expired grant, a
  // tainted egress payload and a rate limit are all more specific reasons and
  // are reported instead. Confirmation is what is left when nothing refuses.
  if (spec.sideEffect === 'write' && !confirmed) {
    return deny(`write_requires_confirmation:${proposal.tool}`, 'INV-4', true);
  }

  return { allow: true, capabilityId: capability.id, reason: 'capability_matched', invariant: null };
}

function isRateLimited(
  tool: string,
  limit: number,
  usage: Record<string, number> | undefined,
): boolean {
  const used = Number(usage?.[tool] ?? 0);
  // Unreadable usage denies rather than assuming zero.
  if (!Number.isFinite(used)) return true;
  return used >= limit;
}

/** Side effect class, for the log and the UI. */
export function sideEffectOf(tool: string): SideEffect | null {
  return getToolSpec(tool)?.sideEffect ?? null;
}

/**
 * Plain-English rendering of a machine reason code.
 *
 * A user who cannot understand why something was refused cannot reason about
 * the risk it protected them from, which is most of the point of showing them
 * the decision at all.
 */
export function explainReason(reason: string): string {
  const code = reason.split(':')[0];
  switch (code) {
    case 'no_capability_grant':
      return 'Blocked: the assistant has not been given permission for that action.';
    case 'capability_scope_mismatch':
      return 'Blocked: the permission granted does not cover that specific target.';
    case 'capability_expired':
      return 'Blocked: that permission has expired. Grant it again to continue.';
    case 'capability_revoked':
      return 'Blocked: you revoked that permission.';
    case 'capability_already_used':
      return 'Blocked: that was a one-time permission and it has already been used.';
    case 'write_requires_confirmation':
      return 'Held: this would write to your journal. Confirm it first.';
    case 'tainted_egress_payload':
      return 'Held: this would send content derived from an external document out of the app. Confirm exactly what is being sent first.';
    case 'rate_limited':
      return 'Blocked: that action has hit its hourly limit.';
    case 'unknown_tool':
      return 'Blocked: the assistant asked for a tool that does not exist.';
    case 'invalid_args':
      return 'Blocked: the request was incomplete.';
    case 'malformed_proposal':
      return 'Blocked: the request could not be read.';
    case 'capability_matched':
      return 'Allowed by a permission you granted.';
    case 'instruction_attempt_detected':
      return 'Noted: this source tried to issue instructions to the assistant. It was read as data and nothing was run.';
    default:
      return reason;
  }
}
