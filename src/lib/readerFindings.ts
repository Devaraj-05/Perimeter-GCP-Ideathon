import type { TurnFinding } from '../types';

/**
 * One Perimeter message for everything the Reader flagged in a turn.
 *
 * The Reader reports per observation, and a turn that reads a repository plus
 * two attachments legitimately produces six of them — four naming the same
 * repository. Rendered one message each, that was six near-identical blocks,
 * every one repeating the same two paragraphs of explanation, with the answer
 * the user actually asked for pushed off the bottom of the screen.
 *
 * Nothing is dropped except exact duplicates. Every distinct excerpt is still
 * quoted, still attributed to its source, and still shown in the conversation
 * rather than only written to the log — the disclosure is the product. What
 * changes is that it is disclosed once, legibly, instead of six times.
 */
export function groupReaderFindings(
  findings: readonly { sourceRef: string; excerpt: string }[],
): TurnFinding | null {
  if (!Array.isArray(findings) || findings.length === 0) return null;

  // Exact (source, excerpt) repeats collapse. Two different sources quoting the
  // same sentence are two findings and both are kept: which document said it is
  // the part the user needs.
  const seen = new Set<string>();
  const matches: TurnFinding['matches'] = [];

  for (const f of findings) {
    const source = typeof f?.sourceRef === 'string' ? f.sourceRef : '';
    const excerpt = typeof f?.excerpt === 'string' ? f.excerpt : '';
    if (!source && !excerpt) continue;

    // A NUL separator, written as an escape rather than a raw byte: a space
    // would let ('a b', 'c') and ('a', 'b c') collide into one key.
    const key = source + '\u0000' + excerpt;
    if (seen.has(key)) continue;
    seen.add(key);

    matches.push({
      signal: 'reader_instruction_attempt',
      excerpt,
      source,
    });
  }

  if (matches.length === 0) return null;

  const sources = Array.from(new Set(matches.map((m) => m.source)));

  return {
    // A single source names itself; several are counted, and the headline in
    // findingMessage.ts switches on the same fact.
    title: sources.length === 1 ? sources[0]! : `${sources.length} documents`,
    verdict: 'hostile',
    detectedBy: 'reader',
    matches,
  };
}
