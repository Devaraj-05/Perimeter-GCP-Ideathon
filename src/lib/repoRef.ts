/**
 * Finding a repository reference in what the USER typed.
 *
 * Applied to the user's own message and to nothing else — never to a turn, an
 * artifact, an attachment or a scan result. The rule is the one extractUrls
 * follows for the same reason: a repository name inside untrusted content is
 * an attacker choosing what our server fetches, and honouring one would hand
 * them a fetch primitive pointed wherever they like.
 *
 * Three shapes, in descending confidence:
 *
 *   https://github.com/owner/name   unambiguous
 *   owner/name                      unambiguous
 *   name                            ambiguous — needs a search, and may fail
 *
 * The third is where this has to be careful. "notes" is a plausible repository
 * name and also an ordinary English word, so a bare token is only ever a
 * CANDIDATE. Nothing is fetched on the strength of one without either a single
 * confident match or the user saying which they meant.
 */

export type RepoReference =
  | { kind: 'explicit'; ref: string }
  | { kind: 'bare'; name: string };

const HOST_PREFIXES = ['https://github.com/', 'http://github.com/', 'github.com/'];

/** owner and name as GitHub actually allows them. */
const SEGMENT = /^[A-Za-z0-9._-]+$/;

function tidy(raw: string): string {
  let ref = raw.trim();
  for (const prefix of HOST_PREFIXES) {
    if (ref.toLowerCase().startsWith(prefix)) {
      ref = ref.slice(prefix.length);
      break;
    }
  }
  // Trailing punctuation from ordinary prose: "look at owner/name."
  ref = ref.replace(/[.,;:!?)\]]+$/, '');
  if (ref.toLowerCase().endsWith('.git')) ref = ref.slice(0, -4);
  while (ref.endsWith('/')) ref = ref.slice(0, -1);
  return ref;
}

/** True for `owner/name` once tidied. */
export function isExplicitRef(candidate: string): boolean {
  const parts = candidate.split('/');
  return parts.length === 2 && parts.every((p) => SEGMENT.test(p) && p.length <= 100);
}

/**
 * Words that are repository-shaped but are almost certainly English.
 *
 * Deliberately short. The cost of a wrong entry here is that a real repository
 * named "notes" cannot be found by bare name, which the user can always fix by
 * typing owner/name — whereas the cost of omitting one is searching GitHub
 * because somebody wrote "check my code".
 */
const NOT_A_REPO = new Set([
  'it', 'this', 'that', 'my', 'the', 'a', 'an', 'repo', 'repository', 'code',
  'project', 'github', 'branch', 'main', 'master', 'file', 'files', 'please',
  'scan', 'check', 'look', 'help', 'me', 'you', 'and', 'or', 'for', 'with',
  'what', 'why', 'how', 'when', 'where', 'who', 'is', 'are', 'was', 'were',
  'can', 'could', 'would', 'should', 'about', 'from', 'into', 'prompt',
  'injection', 'injections', 'security', 'find', 'show', 'tell', 'explain',
]);

/**
 * Words that make a bare token a repository request rather than a noun.
 *
 * Without this, "what is a prompt injection?" resolved to the repository
 * "what" — a question about the product became a GitHub search. A bare name
 * needs either an explicit intent word or a message that is nothing but the
 * name.
 */
const REPO_INTENT = /(scan|repo|repos|repository|repositories|github|codebase)/i;

/**
 * The first repository reference in a message, or null.
 *
 * Explicit references win wherever they appear. A bare name is returned only
 * when the message contains no explicit one, because "scan owner/name" should
 * never be second-guessed by the word "scan".
 */
export function findRepoReference(text: string): RepoReference | null {
  if (typeof text !== 'string' || !text.trim()) return null;

  const tokens = text.split(/\s+/).filter(Boolean);

  for (const token of tokens) {
    const candidate = tidy(token);
    if (isExplicitRef(candidate)) return { kind: 'explicit', ref: candidate };
  }

  // A bare name counts only when the message is the name alone, or when it
  // says plainly that a repository is meant. Anything else is prose that
  // happens to contain a repository-shaped word, and searching GitHub on the
  // strength of it is worse than doing nothing.
  if (tokens.length > 8) return null;
  if (tokens.length > 1 && !REPO_INTENT.test(text)) return null;

  for (const token of tokens) {
    const candidate = tidy(token);
    if (candidate.includes('/')) continue;
    if (!SEGMENT.test(candidate) || candidate.length > 100) continue;
    if (NOT_A_REPO.has(candidate.toLowerCase())) continue;
    // A single word with no separator and no digits is usually just a word.
    // Requiring a repo-ish shape keeps "hello" from triggering a search.
    if (!/[-_.\d]/.test(candidate) && candidate.length < 4) continue;
    return { kind: 'bare', name: candidate };
  }

  return null;
}
