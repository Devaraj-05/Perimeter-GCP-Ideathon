import { detectL1, Match } from './detect';
import { readTarGz } from './tarball';
import {
  triageFile,
  summariseFindings,
  tierRank,
  type FindingTier,
  type RepoFinding,
  type RepoVerdict,
} from './triage';
import {
  fetchDefaultBranch,
  fetchTree,
  fetchBlobText,
  fetchTarball,
  githubAuthWarning,
  resetGithubAuthWarning,
  IngestError,
} from './github';

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
 * Blobs fetched at once.
 *
 * Serial was honest but slow: 500 files at ~150ms each is over a minute, so
 * the wall-clock cap ended most scans before the caps that were supposed to.
 * Eight is chosen to be fast without bursting — GitHub throttles concurrent
 * requests separately from the hourly budget, and a scan that trips secondary
 * rate limiting costs every user of the deployment, not just this one.
 */
export const CONCURRENCY = 8;

/**
 * Compressed ceiling for the one-request path.
 *
 * Above this the archive stops being cheaper than fetching the files that
 * actually matter, so the scan falls back to per-blob fetching and its caps.
 */
export const MAX_ARCHIVE_BYTES = 40_000_000;

/**
 * One file's worth of scanning, shared by both fetch paths.
 *
 * Extracted because the archive path and the per-blob path have already
 * drifted once — the archive path was missing the progress detail the other
 * had. Two copies of the decision that turns text into a finding is two
 * places for that decision to diverge.
 *
 * Note what is NOT here: no filter. An earlier version deleted offdomain_url
 * matches outright, which was the right instinct wired the wrong way. Every
 * match L1 finds is kept; triage ranks and labels it. A finding the user
 * cannot see is a finding they cannot judge.
 */
function scanOne(path: string, text: string): RepoFinding | null {
  // The repository's own domain is not a signal here — every link in a README
  // points outward, so github.com links are not treated as off-domain.
  const l1 = detectL1(text, { allowedHosts: ['github.com', 'githubusercontent.com'] });
  return triageFile(path, text, l1);
}

const liveCount = (m: Map<number, RepoFinding>) =>
  [...m.values()].filter((f) => f.tier === 'live').length;

/** Strongest tier first, then original prioritised order within a tier. */
function orderFindings(hits: Map<number, RepoFinding>): RepoFinding[] {
  return [...hits.entries()]
    .sort((a, b) => tierRank(a[1].tier) - tierRank(b[1].tier) || a[0] - b[0])
    .map(([, f]) => f);
}

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

/** Emitted as each batch lands, so a long scan is legible while it runs. */
export interface ScanProgress {
  scanned: number;
  total: number;
  /** The last path read in this batch. Shown so progress is visibly real. */
  path: string;
  findings: number;
  /** Surfaced separately so a real hit is visible the moment it lands. */
  live: number;
}

export interface RepoScanResult {
  repo: string;
  defaultBranch: string;
  filesScanned: number;
  filesTotal: number;
  bytesScanned: number;
  stoppedBy: StopReason;
  coverage: string;
  /** What the scan concluded. Never merged with coverage — see below. */
  verdict: RepoVerdict;
  /** One sentence, composed from fixed literals and counts. */
  headline: string;
  tierCounts: Record<FindingTier, number>;
  /**
   * Conditions the user should know about that did not stop the scan — a
   * rejected token, for instance. Degrading silently would hide a real
   * configuration fault behind a thinner set of results.
   */
  warnings: string[];
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
 * Fetches in bounded batches rather than one at a time. Findings are collected
 * by the file's position in the prioritised list and sorted before returning,
 * so a scan of an unchanged repository reports in the same order every time
 * even though the fetches finish out of order.
 *
 * @param onProgress called after each batch. Purely for display — nothing about
 * the scan's result depends on anyone listening.
 */
export async function scanRepository(
  repoRef: string,
  onProgress?: (p: ScanProgress) => void,
  /** The caller's uid, so a connected user's own credential reaches their private repos. */
  uid?: string,
): Promise<RepoScanResult> {
  const startedAt = Date.now();
  resetGithubAuthWarning();

  const defaultBranch = await fetchDefaultBranch(repoRef, uid);
  const tree = await fetchTree(repoRef, defaultBranch, uid);

  const eligible = prioritise(tree.filter(isScannable));

  // One request for the whole repository, when that is possible.
  //
  // Fetching a blob per file cost 121 requests for this project's own repo and
  // spent GitHub's 60-per-hour anonymous budget before reaching halfway. The
  // archive is the same content in a single download, which is the difference
  // between "scanned 50 of 121" and a complete answer.
  //
  // The per-blob path below stays as the fallback: a repository too large to
  // download whole is exactly the case where reading the prioritised files and
  // stopping is the right behaviour.
  try {
    const archive = await fetchTarball(repoRef, defaultBranch, MAX_ARCHIVE_BYTES, uid);
    const wanted = new Map(eligible.slice(0, MAX_FILES).map((e, i) => [e.path, i]));
    // The predicate matters: without it the byte cap is spent on lockfiles
    // and binaries this loop is about to skip, and the scan reports itself
    // truncated after reading content nobody was ever going to look at.
    const { entries, truncated } = readTarGz(
      archive,
      MAX_TOTAL_BYTES,
      MAX_BLOB_BYTES,
      (path) => wanted.has(path),
    );

    const hits = new Map<number, RepoFinding>();
    let scanned = 0;
    let bytes = 0;

    for (const entry of entries) {
      const index = wanted.get(entry.path);
      // The tree already decided what is worth reading — binaries, lockfiles
      // and vendored directories are filtered there, and the archive must not
      // become a second, looser answer to the same question.
      if (index === undefined) continue;

      scanned++;
      bytes += entry.bytes;

      const finding = scanOne(entry.path, entry.text);
      if (finding) hits.set(index, finding);
    }

    const stopped: StopReason = truncated
      ? 'max_bytes'
      : eligible.length > MAX_FILES
        ? 'max_files'
        : 'complete';

    onProgress?.({
      scanned,
      total: wanted.size,
      path: '',
      findings: hits.size,
      live: liveCount(hits),
    });

    const archiveFindings = orderFindings(hits);
    const archiveSummary = summariseFindings(archiveFindings);

    return {
      repo: repoRef,
      defaultBranch,
      filesScanned: scanned,
      filesTotal: eligible.length,
      bytesScanned: bytes,
      stoppedBy: stopped,
      coverage: summariseCoverage({
        filesScanned: scanned,
        filesTotal: eligible.length,
        stoppedBy: stopped,
      }),
      verdict: archiveSummary.verdict,
      headline: archiveSummary.headline,
      tierCounts: archiveSummary.tierCounts,
      warnings: [githubAuthWarning()].filter((w): w is string => typeof w === 'string'),
      findings: archiveFindings,
    };
  } catch (err) {
    // Too large, or the archive endpoint refused. Fall through to per-blob
    // fetching, which is slower and capped but always available.
    console.warn(
      '[reposcan] archive path unavailable, falling back to per-file fetch:',
      err instanceof Error ? err.message : 'unknown',
    );
  }

  const found = new Map<number, RepoFinding>();
  let filesScanned = 0;
  let bytesScanned = 0;
  let stoppedBy: StopReason = 'complete';

  const capped = eligible.slice(0, MAX_FILES);
  if (eligible.length > MAX_FILES) stoppedBy = 'max_files';

  for (let start = 0; start < capped.length; start += CONCURRENCY) {
    if (bytesScanned >= MAX_TOTAL_BYTES) {
      stoppedBy = 'max_bytes';
      break;
    }
    if (Date.now() - startedAt >= WALL_CLOCK_MS) {
      stoppedBy = 'time';
      break;
    }

    const batch = capped.slice(start, start + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (entry, offset) => {
        try {
          const text = await fetchBlobText(repoRef, entry.sha, MAX_BLOB_BYTES, uid);
          return { index: start + offset, entry, text, rateLimited: false };
        } catch (err) {
          const rateLimited =
            err instanceof IngestError && /rate limit|unauthenticated budget/i.test(err.message);
          // One unreadable blob is not a reason to abandon the other 499.
          return { index: start + offset, entry, text: null, rateLimited };
        }
      }),
    );

    let lastPath = '';
    for (const r of results) {
      if (r.rateLimited) stoppedBy = 'rate_limit';
      if (r.text === null) continue;

      filesScanned++;
      bytesScanned += Buffer.byteLength(r.text, 'utf8');
      lastPath = r.entry.path;

      const finding = scanOne(r.entry.path, r.text);
      if (finding) found.set(r.index, finding);
    }

    onProgress?.({
      scanned: filesScanned,
      total: capped.length,
      path: lastPath,
      findings: found.size,
      live: liveCount(found),
    });

    if (stoppedBy === 'rate_limit') break;
  }

  // Strongest tier first, then position in the prioritised list — not
  // completion order, so a rerun of an unchanged repository reports
  // identically despite fetches finishing out of order.
  const findings = orderFindings(found);
  const summary = summariseFindings(findings);

  return {
    repo: repoRef,
    defaultBranch,
    filesScanned,
    filesTotal: eligible.length,
    bytesScanned,
    stoppedBy,
    coverage: summariseCoverage({ filesScanned, filesTotal: eligible.length, stoppedBy }),
    verdict: summary.verdict,
    headline: summary.headline,
    tierCounts: summary.tierCounts,
    warnings: [githubAuthWarning()].filter((w): w is string => typeof w === 'string'),
    findings,
  };
}
