/**
 * Turning a bare repository name into one repository, or into a question.
 *
 * The user may type `owner/name`, a URL, or just `name`. The first two are
 * unambiguous and never come here. This resolves the third, and its job is as
 * much to REFUSE as to answer: a name that matches four repositories is a
 * question for the user, not a coin flip, and scanning the wrong repository is
 * worse than scanning none.
 *
 * Access follows the token, not this code. A private repository the user can
 * reach appears because their own credential can see it; a private repository
 * belonging to somebody else is invisible to that credential and therefore
 * invisible here. There is no separate visibility rule to get wrong, which is
 * the point — GitHub decides, and we do not second-guess it.
 */

export interface RepoCandidate {
  ref: string;
  description: string | null;
  private: boolean;
  stars: number;
  /** True when the signed-in user owns it. Owned repositories win ties. */
  owned: boolean;
}

export type Resolution =
  | { kind: 'one'; candidate: RepoCandidate }
  | { kind: 'many'; candidates: RepoCandidate[] }
  | { kind: 'none' };

/** GitHub allows these characters in a repository name. */
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

export function isResolvableName(name: string): boolean {
  return typeof name === 'string' && NAME.test(name);
}

/**
 * Ranks candidates and decides whether we are confident enough to act.
 *
 * Confident means exactly one of:
 *   - a single candidate, or
 *   - exactly one candidate the user OWNS, whatever else matched.
 *
 * "My repo called api" means theirs. Anything else is ambiguous and is put
 * back to the user, because a wrong repository is a wasted scan and a
 * confusing answer about code they have never seen.
 */
export function decide(candidates: RepoCandidate[]): Resolution {
  if (candidates.length === 0) return { kind: 'none' };
  if (candidates.length === 1) return { kind: 'one', candidate: candidates[0] };

  const owned = candidates.filter((c) => c.owned);
  if (owned.length === 1) return { kind: 'one', candidate: owned[0] };

  // Most-starred first, so the list the user is asked to choose from leads
  // with the one they most likely meant.
  const ranked = [...candidates].sort((a, b) => {
    if (a.owned !== b.owned) return a.owned ? -1 : 1;
    return b.stars - a.stars;
  });
  return { kind: 'many', candidates: ranked.slice(0, 5) };
}

/** Shapes one GitHub search or listing row. Tolerant: fields may be absent. */
export function toCandidate(row: unknown, login: string | null): RepoCandidate | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  const ref = typeof r.full_name === 'string' ? r.full_name : null;
  if (!ref || ref.split('/').length !== 2) return null;

  const owner = ref.split('/')[0];
  return {
    ref,
    description: typeof r.description === 'string' ? r.description.slice(0, 200) : null,
    private: r.private === true,
    stars: typeof r.stargazers_count === 'number' ? r.stargazers_count : 0,
    owned: login !== null && owner.toLowerCase() === login.toLowerCase(),
  };
}
