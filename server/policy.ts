import { getToolSpec, SideEffect } from './tools';

/**
 * Policy Engine - Amendment B.1 and B.3.
 *
 * A pure, deterministic function. No I/O, no clock, no randomness, and above
 * all no language model: the model is precisely the component an attacker
 * controls the input to, so it cannot be part of the control that restrains it.
 *
 * Everything this function needs is passed in, which is what makes every branch
 * directly testable - including the branches an attacker would need.
 */

export type Decision = 'ALLOW' | 'CONFIRM' | 'DENY';

export type Reason =
  | 'not_in_registry'
  | 'not_in_allowlist'
  | 'write_from_tainted_turn'
  | 'write_requires_confirmation'
  | 'rate_limited'
  | 'invalid_arguments'
  | 'permitted';

export interface ToolProposal {
  tool: string;
  args: Record<string, unknown>;
}

export interface UserPolicy {
  allowedTools: string[];
  /** Invocations already used this window, per tool name. */
  usage?: Record<string, number>;
}

export interface PolicyDecision {
  decision: Decision;
  reason: Reason;
  sideEffect: SideEffect | null;
}

function deny(reason: Reason, sideEffect: SideEffect | null = null): PolicyDecision {
  return { decision: 'DENY', reason, sideEffect };
}

/**
 * B.3, evaluated in the stated order. The ordering is load-bearing: the taint
 * check must precede the confirmation branch, so that a write from a tainted
 * turn is refused outright rather than offered to the user to approve. Asking a
 * human to confirm an action an injection asked for is not a control - it is a
 * phishing prompt rendered by our own UI.
 */
export function decide(
  proposal: ToolProposal | null | undefined,
  policy: UserPolicy | null | undefined,
  turnTaint: boolean,
): PolicyDecision {
  // B.6: any ambiguity in the decision path denies.
  if (!proposal || typeof proposal !== 'object') return deny('invalid_arguments');

  const spec = getToolSpec(proposal.tool);
  if (!spec) return deny('not_in_registry');

  const allowed = Array.isArray(policy?.allowedTools) ? policy!.allowedTools : [];
  if (!allowed.includes(spec.name)) return deny('not_in_allowlist', spec.sideEffect);

  // Arguments must satisfy the manifest before anything else is considered.
  const args = proposal.args && typeof proposal.args === 'object' ? proposal.args : {};
  for (const required of spec.parameters.required) {
    const value = (args as Record<string, unknown>)[required];
    if (typeof value !== 'string' || value.trim() === '') {
      return deny('invalid_arguments', spec.sideEffect);
    }
  }

  if (spec.sideEffect === 'write') {
    // Rule 2. An injection's objective is a side effect; denying the write
    // removes the objective rather than merely detecting the attempt.
    if (turnTaint === true) {
      return deny('write_from_tainted_turn', 'write');
    }

    // Rule 4 is checked before returning CONFIRM so a rate-limited write is
    // never queued for a human to approve.
    if (isRateLimited(spec.name, spec.rateLimitPerHour, policy)) {
      return deny('rate_limited', 'write');
    }

    // Rule 3. Unconditional. There is deliberately no flag, environment
    // variable or demo mode that reaches past this return.
    return { decision: 'CONFIRM', reason: 'write_requires_confirmation', sideEffect: 'write' };
  }

  if (isRateLimited(spec.name, spec.rateLimitPerHour, policy)) {
    return deny('rate_limited', spec.sideEffect);
  }

  return { decision: 'ALLOW', reason: 'permitted', sideEffect: spec.sideEffect };
}

function isRateLimited(
  tool: string,
  limit: number,
  policy: UserPolicy | null | undefined,
): boolean {
  const used = Number(policy?.usage?.[tool] ?? 0);
  if (!Number.isFinite(used)) return true; // B.6: unreadable usage denies.
  return used >= limit;
}

/**
 * A.3 / B.3: a turn is tainted when any artifact in its assembled context is
 * not clean. Bookkeeping over data already computed, not inference - it cannot
 * be argued with by the text being assessed.
 */
export function computeTurnTaint(
  artifacts: Array<{ trust?: string; verdict?: string }> | null | undefined,
): boolean {
  if (!Array.isArray(artifacts)) return false;
  return artifacts.some(
    (a) =>
      a &&
      a.trust !== 'first_party' &&
      (a.verdict === 'suspicious' || a.verdict === 'hostile'),
  );
}
