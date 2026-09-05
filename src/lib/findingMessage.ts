import type { TurnFinding } from '../types';

/**
 * The sentence Perimeter says about a document it screened.
 *
 * Every word here is ours. A model that has just read a poisoned document must
 * never get to write the sentence describing that document — it would be the
 * attacker choosing how their own attack is reported, wearing our interface.
 * That rule used to be enforced by rendering findings in a separate panel with
 * fixed button labels; the panel is gone, the rule is not. The finding is now a
 * message in the conversation, authored here, and labelled as ours.
 *
 * Excerpts are NOT interpolated into this string. They are attacker-controlled
 * and travel as structured data to the renderer, which emits them as plain
 * children. This function produces only the framing.
 */

const SIGNAL_COPY: Record<string, string> = {
  instruction_override: 'an instruction to disregard earlier instructions',
  fake_system_role: 'text impersonating a system or developer message',
  concealment_request: 'a request to hide something from you',
  exfiltration_request: 'a request to send data somewhere',
  tool_invocation: 'an attempt to invoke a tool',
  credential_request: 'a request for keys, passwords or secrets',
  urgency_pressure: 'manufactured urgency',
  hidden_unicode: 'characters that are invisible when rendered',
  bidi_override: 'text-direction characters that can disguise content',
  html_comment: 'content hidden in an HTML comment',
  offdomain_url: 'a link pointing off-domain',
  imperative_to_agent: 'an instruction addressed to an AI reader',
  oversized_base64: 'a large encoded blob',
};

export function describeSignal(signal: string): string {
  return SIGNAL_COPY[signal] ?? signal.replace(/_/g, ' ');
}

/** Plural-safe, and never claims a count it cannot show. */
export function findingHeadline(finding: TurnFinding): string {
  const n = finding.matches.length;
  const name = finding.title;

  if (n === 0) {
    // Deliberately not "this document is safe". Nothing was matched; that is a
    // statement about our patterns, not about the document.
    return `I screened ${name} and none of my patterns matched. It is in the conversation as data — I read it with a model that holds no tools, so an instruction hidden in it has nothing to call.`;
  }

  const attempt = n === 1 ? 'one attempt' : `${n} attempts`;
  const verb = finding.verdict === 'hostile' ? 'found' : 'flagged';
  return `I ${verb} ${attempt} in ${name} to give me instructions. Here is each one, quoted exactly as it appears:`;
}

/**
 * The closing line, which is the part that matters and the part a model would
 * get wrong: what we did about it.
 */
export function findingFooter(finding: TurnFinding): string {
  if (finding.matches.length === 0) return '';
  return 'None of it reached anything that can act. The model that read this document holds no tools, and any tool call arising from this turn needs your explicit confirmation.';
}

/** True when there is nothing worth putting in the conversation at all. */
export function isSilentFinding(finding: TurnFinding): boolean {
  return finding.matches.length === 0 && finding.verdict === 'clean';
}
