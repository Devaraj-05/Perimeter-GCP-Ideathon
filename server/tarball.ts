import { gunzipSync } from 'zlib';

/**
 * A minimal tar reader — Amendment I.
 *
 * The scanner used to fetch one blob per file: 121 requests for this project's
 * own repository, which spends GitHub's 60-per-hour anonymous budget before it
 * reaches the halfway mark. A tarball is the same repository in ONE request and
 * 392 KB, so rate limits stop being the thing that decides how much of a
 * repository gets read.
 *
 * No dependency is added, and Constitution §3 would require a reason for one.
 * There is not a good one here: gzip is `zlib` from the standard library, and
 * tar is a sequence of 512-byte headers followed by padded payloads. The
 * subset that matters is small enough to read in one sitting, which is worth
 * more than a package that also handles symlinks and sparse files.
 *
 * This parser is deliberately incurious. It reads regular files and skips
 * everything else — no symlinks followed, no paths written anywhere, nothing
 * extracted to disk. The archive is attacker-influenceable content, so the
 * only safe thing to do with it is read bytes out of memory and never let a
 * name in it become a filesystem path.
 */

const BLOCK = 512;

/** Offsets within a tar header block. */
const NAME = 0;
const SIZE = 124;
const TYPEFLAG = 156;
const PREFIX = 345;

export interface TarEntry {
  /** Path with the archive's single root directory stripped. */
  path: string;
  bytes: number;
  text: string;
}

function readString(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

/**
 * Tar stores sizes as octal ASCII. A malformed field yields 0 rather than NaN:
 * a size we cannot read must not become an offset we then seek to.
 */
function readOctal(buf: Buffer, offset: number, length: number): number {
  const raw = readString(buf, offset, length).trim();
  if (!raw) return 0;
  const value = parseInt(raw, 8);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * GitHub wraps every archive in one directory named for the repo and commit.
 * Stripping it is what makes a path in here comparable to a path in the tree
 * API — `README.md`, not `owner-repo-a1b2c3d/README.md`.
 */
export function stripRoot(path: string): string {
  const slash = path.indexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * Reads a gzipped tar into entries.
 *
 * @param maxTotalBytes stop once this much file content has been read. A tar
 * can claim to hold far more than it transferred, so the cap is enforced on
 * what is actually accumulated rather than on the compressed size.
 * @param maxEntryBytes files larger than this are skipped, not truncated. A
 * half-read file produces half-findings, which is worse than none.
 * @param wanted decides which paths are worth keeping, BEFORE their bytes count
 * against the total. Without it the cap is spent on lockfiles and binaries the
 * caller is about to discard: scanning this project's own repository reported
 * "truncated" after reading a package-lock.json that was never going to be
 * scanned. A budget spent on content nobody looks at is a budget that silently
 * shortens the scan.
 */
export function readTarGz(
  gz: Buffer,
  maxTotalBytes: number,
  maxEntryBytes: number,
  wanted?: (path: string) => boolean,
): { entries: TarEntry[]; truncated: boolean } {
  const tar = gunzipSync(gz);
  const entries: TarEntry[] = [];

  let offset = 0;
  let total = 0;
  let truncated = false;
  /** Set by a GNU long-name block, consumed by the header that follows it. */
  let pendingLongName = '';

  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);

    // Two consecutive zero blocks end the archive; one is enough to stop here.
    if (header.every((b) => b === 0)) break;

    const size = readOctal(header, SIZE, 12);
    const typeflag = String.fromCharCode(header[TYPEFLAG] || 0);
    const dataStart = offset + BLOCK;
    const padded = Math.ceil(size / BLOCK) * BLOCK;

    if (dataStart + size > tar.length) break;

    // GNU long name: this block's payload is the next entry's path.
    if (typeflag === 'L') {
      pendingLongName = tar.subarray(dataStart, dataStart + size).toString('utf8').replace(/\0+$/, '');
      offset = dataStart + padded;
      continue;
    }

    const prefix = readString(header, PREFIX, 155);
    const name = readString(header, NAME, 100);
    const full = pendingLongName || (prefix ? `${prefix}/${name}` : name);
    pendingLongName = '';

    // '0' and NUL are regular files. Directories, links, and everything else
    // are skipped rather than interpreted — a symlink in an archive is a
    // request to read somewhere else, and this reader does not take requests.
    const isFile = typeflag === '0' || typeflag === '\0';

    const path = stripRoot(full);
    const keep = isFile && (!wanted || wanted(path));

    if (keep && size > 0 && size <= maxEntryBytes) {
      if (total + size > maxTotalBytes) {
        truncated = true;
        break;
      }
      const text = tar.subarray(dataStart, dataStart + size).toString('utf8');
      total += size;
      entries.push({ path, bytes: size, text });
    } else if (keep && size > maxEntryBytes) {
      truncated = true;
    }

    offset = dataStart + padded;
  }

  return { entries, truncated };
}
