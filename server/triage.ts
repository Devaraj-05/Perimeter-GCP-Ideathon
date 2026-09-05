import { isHighConfidence, type L1Result, type Match, type Signal } from './detect';
import {
  containmentAt,
  indexContainment,
  syntaxOf,
  type ContainmentKind,
} from './containment';

/**
 * Is this an injection, or a document about injections?
 *
 * The scanner reported 31 findings on this project's own repository and every
 * one was a false positive — the test corpus, the threat model, the README.
 * The same thing happens to any AI-security repo, any LLM paper, any blog post
 * about prompt injection: exactly the audience most likely to try this.
 *
 * L1 answers "does this text look like an injection?". This answers the
 * question a user actually asks: **would anything obey it?** That turns on two
 * things, both syntactic and neither requiring a model:
 *
 *   - the file's ROLE: an agent obeys AGENTS.md by construction, reads a README
 *     as context, and does neither with a test fixture;
 *   - the match's CONTAINMENT: inside a fence, a string literal or a comment,
 *     the text is being demonstrated rather than deployed.
 *
 * Nothing is deleted. Every match L1 found is reported, ranked and labelled.
 * An earlier version of the scanner deleted `offdomain_url` matches outright;
 * the instinct was right and the mechanism was wrong, because a finding the
 * user cannot see is a finding they cannot judge.
 */

export type FileRole =
  /** An agent obeys this file by construction. */
  | 'agent_instructions'
  /** A runner obeys this, and agents increasingly read it. */
  | 'ci_config'
  /** A human reads it; a human may paste it into an agent. */
  | 'documentation'
  /** Asserts on attack strings. */
  | 'test'
  /** Is a corpus of attack strings. */
  | 'fixture'
  | 'source'
  | 'data'
  | 'other';

export type FindingTier = 'live' | 'active' | 'quoted' | 'weak';

export type RepoVerdict = 'injection_found' | 'review' | 'discussion_only' | 'clean';

export interface TriagedMatch extends Match {
  containment: ContainmentKind;
  tier: FindingTier;
}

export interface RepoFinding {
  path: string;
  role: FileRole;
  /** The strongest tier among this file's matches. */
  tier: FindingTier;
  score: number;
  highConfidence: Signal[];
  /** Every match. Nothing filtered, nothing deleted. */
  matches: TriagedMatch[];
  /** The file's markup does not close, so positions were not trusted. */
  structureUnreliable?: boolean;
}

const AGENT_BASENAMES = new Set([
  'agents.md',
  'claude.md',
  'gemini.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  '.aider.conf.yml',
  'copilot-instructions.md',
]);

const AGENT_DIRS = [/(^|\/)\.cursor\/rules\//i, /(^|\/)\.claude\//i, /(^|\/)\.github\/instructions\//i];

const CI_BASENAMES = new Set(['jenkinsfile', '.gitlab-ci.yml', 'azure-pipelines.yml']);

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\//i;
const TEST_BASENAME = /(\.(test|spec)\.[a-z]+$|_test\.[a-z]+$|^test_)/i;

const FIXTURE_SEGMENT =
  /(corpus|fixtures?|payloads?|testdata|samples?|redteam|attacks?|poison|golden|__snapshots__)/i;

const DOC_EXT = new Set(['md', 'markdown', 'mdx', 'rst', 'txt']);
const DATA_EXT = new Set(['json', 'yml', 'yaml', 'csv', 'toml']);
const SOURCE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h',
  'cc', 'cpp', 'cs', 'php', 'swift', 'kt', 'sh', 'bash',
]);

/**
 * Path only. No content inspection, no I/O, no model.
 *
 * Order is load-bearing. `server/corpus.test.ts` is both a test and a corpus,
 * and `test` must win so it is not counted twice; `.github/workflows/test.yml`
 * is both CI and named "test", and `ci_config` must win because a workflow is
 * executed regardless of what it is called.
 */
export function classifyFileRole(path: string): FileRole {
  const p = String(path ?? '');
  const base = p.slice(p.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1) : '';

  if (AGENT_BASENAMES.has(base) || AGENT_DIRS.some((r) => r.test(p))) return 'agent_instructions';
  if (/(^|\/)\.github\/(workflows|actions)\//i.test(p) || CI_BASENAMES.has(base)) return 'ci_config';
  if (TEST_BASENAME.test(base) || TEST_PATH.test(p)) return 'test';
  if (FIXTURE_SEGMENT.test(p)) return 'fixture';
  if (DOC_EXT.has(ext) || /(^|\/)docs?\//i.test(p)) return 'documentation';
  if (SOURCE_EXT.has(ext)) return 'source';
  if (DATA_EXT.has(ext)) return 'data';
  return 'other';
}

/** Signals whose matched characters are invisible when rendered. */
const INVISIBLE_SIGNALS = new Set<Signal>(['hidden_unicode', 'bidi_override']);

/**
 * Containment that is presentational rather than structural.
 *
 * A markdown fence changes how bytes are DISPLAYED. A model reading AGENTS.md
 * whole sees the bytes regardless, so a zero-width payload inside a fence is
 * not quoted in any meaningful sense — the fence is a rendering instruction,
 * not a barrier. Invisible signals are therefore immune to these.
 *
 * A string literal in source code is not presentational. It is a language
 * construct in a file that is code, and code is not read as instructions. The
 * self-scan found this: detect.ts defines BIDI_OVERRIDE as a character class
 * containing the very characters it detects, and blanket immunity reported our
 * own detector as an unquoted finding. Immunity stops at the presentational
 * boundary.
 */
const PRESENTATIONAL = new Set<ContainmentKind>([
  'fenced_code',
  'inline_code',
  'blockquote',
  'quoted_span',
]);

/**
 * Where one match lands.
 *
 * Order matters and each rule earns its place:
 *
 *   1. A signal that cannot stand alone is weak, wherever it sits. This is the
 *      rule the scanner was missing entirely — it treated one html_comment
 *      (weight 0.25) exactly like an instruction_override (0.9).
 *   2. Quoted text is demonstrated, not deployed.
 *   3. A test or a fixture is a file of examples by definition.
 *   4. An agent-instruction file is obeyed by construction. This is the answer.
 *   5. Everything else an agent might read but is not built to follow.
 */
export function tierOfMatch(input: {
  signal: Signal;
  role: FileRole;
  containment: ContainmentKind;
}): FindingTier {
  const { signal, role, containment } = input;

  if (!isHighConfidence(signal)) return 'weak';
  if (containment !== 'none') {
    const immune = INVISIBLE_SIGNALS.has(signal) && PRESENTATIONAL.has(containment);
    if (!immune) return 'quoted';
  }
  if (role === 'test' || role === 'fixture') return 'quoted';
  if (role === 'agent_instructions' || role === 'ci_config') return 'live';
  return 'active';
}

const TIER_RANK: Record<FindingTier, number> = { live: 0, active: 1, quoted: 2, weak: 3 };

/** Strongest tier wins. */
function strongest(tiers: FindingTier[]): FindingTier {
  return tiers.reduce((best, t) => (TIER_RANK[t] < TIER_RANK[best] ? t : best), 'weak');
}

/**
 * Triages one file.
 *
 * Takes the text and the L1Result together, deliberately. `Match.start` is an
 * offset into the exact string `detectL1` was given; re-reading or re-deriving
 * the text here would shift every offset and make every containment answer
 * garbage.
 *
 * Returns null only when L1 found nothing at all — never because a tier came
 * out low. Suppression happens nowhere in this module.
 */
export function triageFile(path: string, text: string, l1: L1Result): RepoFinding | null {
  if (!l1 || !Array.isArray(l1.matches) || l1.matches.length === 0) return null;

  const role = classifyFileRole(path);
  const index = indexContainment(text, syntaxOf(path));

  const matches: TriagedMatch[] = l1.matches.map((m) => {
    const containment = containmentAt(index, m.start, m.end);
    return { ...m, containment, tier: tierOfMatch({ signal: m.signal, role, containment }) };
  });

  return {
    path,
    role,
    tier: strongest(matches.map((m) => m.tier)),
    score: l1.score,
    highConfidence: l1.highConfidence,
    matches,
    ...(index.unterminated ? { structureUnreliable: true } : {}),
  };
}

/**
 * The headline.
 *
 * Composed from fixed literals and counts, the same way summariseCoverage is,
 * and safe for the same reason: no model wrote any of it. It must never be
 * merged with the coverage line — a scan stopped by a cap and finding nothing
 * is "nothing in what was read", never "clean".
 */
export function summariseFindings(findings: RepoFinding[]): {
  verdict: RepoVerdict;
  headline: string;
  tierCounts: Record<FindingTier, number>;
} {
  const list = Array.isArray(findings) ? findings : [];
  const tierCounts: Record<FindingTier, number> = { live: 0, active: 0, quoted: 0, weak: 0 };
  for (const f of list) tierCounts[f.tier]++;

  const n = (v: number) => v.toLocaleString('en-US');
  const files = (v: number) => `${n(v)} file${v === 1 ? '' : 's'}`;

  if (tierCounts.live > 0) {
    return {
      verdict: 'injection_found',
      headline: `${files(tierCounts.live)} an agent is built to obey contain${
        tierCounts.live === 1 ? 's' : ''
      } a prompt injection.`,
      tierCounts,
    };
  }

  if (tierCounts.active > 0) {
    return {
      verdict: 'review',
      headline: `No injection in a file an agent obeys. ${files(
        tierCounts.active,
      )} contain${tierCounts.active === 1 ? 's' : ''} a passage that reads as an instruction to an AI — each is quoted below.`,
      tierCounts,
    };
  }

  if (tierCounts.quoted > 0) {
    return {
      verdict: 'discussion_only',
      headline: `No live prompt injection. ${files(
        tierCounts.quoted,
      )} quote or demonstrate injection text — tests, fixtures and documentation.`,
      tierCounts,
    };
  }

  if (tierCounts.weak > 0) {
    return {
      verdict: 'clean',
      headline: `No prompt injection found. ${files(tierCounts.weak)} carry weak signals only.`,
      tierCounts,
    };
  }

  return {
    verdict: 'clean',
    headline: 'No prompt injection found in the files that were read.',
    tierCounts,
  };
}

/** Sort key for the report: strongest tier first, original order within a tier. */
export function tierRank(tier: FindingTier): number {
  return TIER_RANK[tier];
}
