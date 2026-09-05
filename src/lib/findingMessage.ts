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


/**
 * What Perimeter says about a repository scan. Deterministic, like everything
 * else in this file — the scan runs no model (INV-18) and neither does its
 * description.
 */
export interface RepoSummaryInput {
  repo: string;
  defaultBranch: string;
  coverage: string;
  headline: string;
  findings: { path: string; tier: string; role: string }[];
  warnings?: string[];
}

const TIER_WORD: Record<string, string> = {
  live: 'in a file an agent obeys',
  active: 'reads as an instruction to an AI',
  quoted: 'quoted or demonstrated',
  weak: 'weak signals only',
};

export function repoSummaryText(r: RepoSummaryInput): string {
  const lines: string[] = [];
  lines.push(`**${r.repo}** (${r.defaultBranch}) — ${r.coverage}`);
  lines.push('');
  lines.push(r.headline);

  const byTier: Record<string, string[]> = {};
  for (const f of r.findings) (byTier[f.tier] ??= []).push(f.path);

  for (const tier of ['live', 'active', 'quoted', 'weak']) {
    const paths = byTier[tier];
    if (!paths || paths.length === 0) continue;
    lines.push('');
    lines.push(`**${paths.length} ${TIER_WORD[tier] ?? tier}**`);
    // Named, capped, and the cap is stated rather than silently truncating.
    for (const p of paths.slice(0, 8)) lines.push(`- ${p}`);
    if (paths.length > 8) lines.push(`- ...and ${paths.length - 8} more`);
  }

  for (const w of r.warnings ?? []) {
    lines.push('');
    lines.push(w);
  }

  lines.push('');
  lines.push(
    'Nothing in this scan reached a model. Files were fetched, matched against fixed patterns and discarded — so this reports where the injections are, and cannot tell you what the code does.',
  );
  return lines.join('\n');
}

/** When a bare name matched nothing, or several things. */
export function repoAmbiguousText(name: string, candidates: { ref: string }[]): string {
  if (candidates.length === 0) {
    return `I could not find a repository called **${name}** that I can reach. If it is private and belongs to someone else, I will not be able to see it. Give me the full \`owner/name\` and I will try that.`;
  }
  const list = candidates.map((c) => `- ${c.ref}`).join('\n');
  return `**${name}** matches more than one repository. Which did you mean?\n\n${list}\n\nReply with the full \`owner/name\`.`;
}

/** When we have a repository but no idea what is wanted with it. */
export function repoNoIntentText(ref: string): string {
  return `I can see **${ref}**. How can I help with it? I can scan it for prompt injections — that is the one thing I do without a model, and it reports where injections are rather than what the code does.`;
}
