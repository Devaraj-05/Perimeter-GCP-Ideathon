import { detectL1, Match } from './detect';
import { fetchDefaultBranch, fetchTree, fetchBlobText, IngestError } from './github';

/**
 * Repository scanning — INV-18 (Amendment I).
 *
 * Answers exactly one question about a public repository: is there a prompt
 * injection in it, and where.
 *
 * The load-bearing property is what this file does NOT import. There is no
 * Gemini client here, no Reader, no Planner, and nothing that writes an
 * artifact. Repository text is fetched, matched against the deterministic L1
 * patterns, and discarded when the request ends. §9.2 says untrusted input
 * routes through the Reader; that clause exists so a model can read hostile
 * text safely by holding no tools. Here no model reads it at all, so there is
 * nothing to quarantine — which is a stronger position, not a weaker one.
 *
 * The consequence is the feature's boundary and is not a limitation to be
 * fixed later: this can tell you a repository contains an injection and quote
 * it. It cannot tell you what the repository does.
 */

export const MAX_FILES = 500;
export const MAX_BLOB_BYTES = 256_000;
export const MAX_TOTAL_BYTES = 5_000_000;
export const WALL_CLOCK_MS = 60_000;

/**
 * Files an agent is built to obey.
 *
 * A poisoned one of these is the highest-value target in any repository:
 * the instructions are followed by construction rather than merely read. They
 * are scanned and reported first so a real finding is never buried under
 * pattern hits from a test fixture.
 */
export const PRIORITY_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  'README.md',
  'README',
] as const;

const PRIORITY_PREFIXES = ['.github/'];

/** Extensions with no readable text, or none worth reading. */
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|bmp|ico|svgz|pdf|zip|gz|tar|bz2|7z|rar|woff2?|ttf|otf|eot|mp[34]|mov|avi|wav|so|dylib|dll|exe|bin|class|jar|wasm|pyc|o|a|lib|db|sqlite3?)$/i;

/** Generated, enormous, and never where an injection lives. */
const LOCKFILE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock|go\.sum)$/i;

const SKIPPED_DIR = /(^|\/)(node_modules|vendor|dist|build|out|coverage|\.git)\//i;

export interface TreeEntry {
  path: string;
  sha: string;
  /** Absent on some entries; treated as unscannable rather than fetched blind. */
  size?: number;
  type: string;
}

export type StopReason = 'complete' | 'max_files' | 'max_bytes' | 'time' | 'rate_limit';

export interface RepoFinding {
  path: string;
  matches: Match[];
}

export interface RepoScanResult {
  repo: string;
  defaultBranch: string;
  filesScanned: number;
  filesTotal: number;
  bytesScanned: number;
  stoppedBy: StopReason;
  coverage: string;
  findings: RepoFinding[];
}

/**
 * Whether a tree entry is worth fetching.
 *
 * Refuses rather than truncates. A blob whose size cannot be read is skipped
 * instead of fetched blind, because the cap is what keeps a scan bounded and
 * a value we cannot check is not a cap.
 */
export function isScannable(entry: TreeEntry): boolean {
  if (!entry || entry.type !== 'blob') return false;
  if (typeof entry.size !== 'number' || !Number.isFinite(entry.size)) return false;
  if (entry.size > MAX_BLOB_BYTES) return false;

  const path = String(entry.path ?? '');
  if (!path) return false;
  if (SKIPPED_DIR.test(path)) return false;
  if (LOCKFILE.test(path)) return false;
  if (BINARY_EXT.test(path)) return false;

  return true;
}

function priorityRank(path: string): number {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const named = PRIORITY_FILES.findIndex((f) => f.toLowerCase() === base.toLowerCase());
  if (named !== -1) return named;
  if (PRIORITY_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return PRIORITY_FILES.length;
  }
  return PRIORITY_FILES.length + 1;
}

/**
 * Orders the tree so the highest-value targets are read first.
 *
 * This is the entire mitigation for whole-tree scanning's false-positive cost.
 * Findings are not suppressed — a security repository legitimately full of the
 * word "ignore previous instructions" will report every one of them — but a
 * poisoned AGENTS.md appears above them rather than on page four.
 *
 * Stable within a tier, so two scans of an unchanged repository report in the
 * same order.
 */
export function prioritise(entries: TreeEntry[]): TreeEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, rank: priorityRank(entry.path) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((x) => x.entry);
}

const STOP_COPY: Record<Exclude<StopReason, 'complete'>, string> = {
  max_files: `Stopped at the ${MAX_FILES}-file cap.`,
  max_bytes: `Stopped at the ${MAX_TOTAL_BYTES / 1_000_000} MB total cap.`,
  time: `Stopped at the ${WALL_CLOCK_MS / 1000}-second time limit.`,
  rate_limit: 'Stopped because the GitHub rate limit was nearly exhausted.',
};

/**
 * The coverage line shown to the user.
 *
 * A partial scan must never read as a clean bill of health for a repository.
 * If a cap stopped it, the line names which cap and how many files went
 * unread — INV-18. This is the same principle as publishing the L1 miss rate:
 * the honest number is the credible one.
 */
export function summariseCoverage(input: {
  filesScanned: number;
  filesTotal: number;
  stoppedBy: StopReason;
}): string {
  const { filesScanned, filesTotal, stoppedBy } = input;
  const n = (v: number) => v.toLocaleString('en-US');
  const head = `Scanned ${n(filesScanned)} of ${n(filesTotal)} eligible files.`;

  if (stoppedBy === 'complete') return head;

  const unread = Math.max(0, filesTotal - filesScanned);
  return `${head} ${STOP_COPY[stoppedBy]} ${n(unread)} files were not read.`;
}

/**
 * Scans one public repository.
 *
 * Sequential rather than parallel on purpose: bursting 500 requests at the
 * GitHub API is how a scan turns into a rate-limit ban for every user of this
 * deployment, and the wall-clock cap already bounds the wait.
 */
export async function scanRepository(repoRef: string): Promise<RepoScanResult> {
  const startedAt = Date.now();

  const defaultBranch = await fetchDefaultBranch(repoRef);
  const tree = await fetchTree(repoRef, defaultBranch);

  const eligible = prioritise(tree.filter(isScannable));

  const findings: RepoFinding[] = [];
  let filesScanned = 0;
  let bytesScanned = 0;
  let stoppedBy: StopReason = 'complete';

  for (const entry of eligible) {
    if (filesScanned >= MAX_FILES) {
      stoppedBy = 'max_files';
      break;
    }
    if (bytesScanned >= MAX_TOTAL_BYTES) {
      stoppedBy = 'max_bytes';
      break;
    }
    if (Date.now() - startedAt >= WALL_CLOCK_MS) {
      stoppedBy = 'time';
      break;
    }

    let text: string;
    try {
      text = await fetchBlobText(repoRef, entry.sha, MAX_BLOB_BYTES);
    } catch (err) {
      // A rate limit ends the scan and is reported as coverage, not as a
      // failure: partial findings the user can act on beat an error page.
      if (err instanceof IngestError && /rate limit/i.test(err.message)) {
        stoppedBy = 'rate_limit';
        break;
      }
      // One unreadable blob is not a reason to abandon the other 499.
      continue;
    }

    filesScanned++;
    bytesScanned += Buffer.byteLength(text, 'utf8');

    // The repository's own domain is not a signal here — every link in a
    // README points outward. Passing the host allowlist keeps offdomain_url
    // from firing on every file and drowning the findings that matter.
    const { matches } = detectL1(text, { allowedHosts: ['github.com', 'githubusercontent.com'] });
    if (matches.length > 0) findings.push({ path: entry.path, matches });
  }

  return {
    repo: repoRef,
    defaultBranch,
    filesScanned,
    filesTotal: eligible.length,
    bytesScanned,
    stoppedBy,
    coverage: summariseCoverage({ filesScanned, filesTotal: eligible.length, stoppedBy }),
    findings,
  };
}
