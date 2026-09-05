/**
 * Where in a file a span of text sits, syntactically.
 *
 * The repository scanner reported 31 findings on this project's own repo and
 * every one was a false positive: a test corpus, a threat model, a README. L1
 * answers "does this text look like an injection?" and answers it well. It has
 * no way to answer "would anything obey it?", which is the question a user is
 * actually asking — and that second question is mostly syntactic.
 *
 * An attack string inside a template literal in `corpus.ts` is a fixture. The
 * same string inside a fenced block in a README is a demonstration. The same
 * string unquoted at the top of AGENTS.md is live, because agents are built to
 * read that file as instructions.
 *
 * This module knows nothing about security. It does not import `detect.ts` and
 * has no concept of a signal. It is a grammar utility, and its tests are about
 * markdown and JavaScript rather than about attacks.
 *
 * ---
 *
 * DO NOT WIRE THIS INTO server/ingest.ts.
 *
 * For a fetched page or an uploaded file, "the injection is inside a code
 * fence" is irrelevant: the Reader receives the whole document either way, and
 * a fence is a rendering instruction, not a barrier. Containment is sound only
 * for the repository question — "would an agent obey this file" — where the
 * unit of trust is the file's role. Using it to lower an airlock verdict would
 * be a real security regression.
 */

export type Syntax = 'markdown' | 'c_like' | 'hash' | 'python' | 'plain';

export type ContainmentKind =
  | 'none'
  /** ``` or ~~~ block in markdown. */
  | 'fenced_code'
  /** `span` in markdown. */
  | 'inline_code'
  /** A line beginning with > in markdown. */
  | 'blockquote'
  /** "…" on one line in markdown. The weakest rule here — see below. */
  | 'quoted_span'
  /** '…' "…" `…` /…/ ''' """ in a source file. */
  | 'code_string'
  /** // /* *​/ # in a source file. */
  | 'code_comment';

export interface Region {
  /** Offsets into the SAME string detectL1 was given. Half-open: [start, end). */
  start: number;
  end: number;
  kind: ContainmentKind;
}

export interface ContainmentIndex {
  /** Sorted by start ascending, non-overlapping. */
  regions: Region[];
  syntax: Syntax;
  /**
   * An opening fence, string or comment that never closed.
   *
   * This is an attack, not a curiosity. Open ``` on line 1 of AGENTS.md, put
   * the payload on line 2, never close it — a scanner that runs the fence to
   * end-of-file marks the whole file quoted and the injection disappears. The
   * offending region is discarded rather than trusted, so the affected span
   * reverts to `none` and over-reports. Over-reporting is the safe direction
   * in the one case where under-reporting is the exploit.
   */
  unterminated: boolean;
}

const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx', 'mdc', 'rst']);
const MARKDOWN_BASENAME = new Set([
  'readme',
  'agents',
  'claude',
  'gemini',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
]);

const C_LIKE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'java', 'c', 'h', 'cc', 'cpp', 'hpp',
  'cs', 'go', 'rs', 'swift', 'kt', 'kts', 'php', 'scala', 'dart', 'm', 'mm',
]);

const HASH_EXT = new Set(['sh', 'bash', 'zsh', 'rb', 'pl', 'yml', 'yaml', 'toml', 'ini', 'conf', 'tf']);

const PYTHON_EXT = new Set(['py', 'pyi']);

/**
 * Extension to grammar. Unknown extensions map to `plain`, which produces no
 * regions at all — every match reads as `none` and over-reports.
 *
 * `.json` is deliberately `plain` rather than `c_like`. JSON has no comments,
 * and a JSON file whose payload sits in a string value is a data file an agent
 * may well consume verbatim — .mcp.json and devcontainer.json are exactly
 * that. Treating its strings as containment would demote a real attack surface.
 */
export function syntaxOf(path: string): Syntax {
  const base = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 ? base.slice(dot + 1) : '';
  const stem = dot > 0 ? base.slice(0, dot) : base;

  if (MARKDOWN_EXT.has(ext)) return 'markdown';
  if (MARKDOWN_BASENAME.has(base) || MARKDOWN_BASENAME.has(stem)) return 'markdown';
  if (C_LIKE_EXT.has(ext)) return 'c_like';
  if (PYTHON_EXT.has(ext)) return 'python';
  if (HASH_EXT.has(ext)) return 'hash';
  if (base === 'dockerfile') return 'hash';
  return 'plain';
}

/** Start offset of the line containing `index`. */
function lineStart(text: string, index: number): number {
  const nl = text.lastIndexOf('\n', Math.max(0, index - 1));
  return nl === -1 ? 0 : nl + 1;
}

/** Offset just past the newline ending the line containing `index`. */
function lineEnd(text: string, index: number): number {
  const nl = text.indexOf('\n', index);
  return nl === -1 ? text.length : nl + 1;
}

interface FenceInfo {
  char: string;
  length: number;
  indent: number;
}

/** A fence opener: up to 3 spaces, then 3+ of the same ` or ~. */
function fenceAt(line: string): FenceInfo | null {
  const m = /^( {0,3})(`{3,}|~{3,})/.exec(line);
  if (!m) return null;
  return { char: m[2][0], length: m[2].length, indent: m[1].length };
}

/**
 * Markdown regions.
 *
 * Fences resolve first and mask everything inside them, then blockquotes, then
 * inline spans in what is left, then quoted spans. Order is load-bearing: a
 * `>` shell prompt inside a ```bash block is not a blockquote, and a backtick
 * inside a fence must not pair with a fence character.
 */
function indexMarkdown(text: string): { regions: Region[]; unterminated: boolean } {
  const regions: Region[] = [];
  let unterminated = false;

  const masked: boolean[] = new Array(text.length).fill(false);
  const mask = (from: number, to: number) => {
    for (let i = from; i < to && i < masked.length; i++) masked[i] = true;
  };

  // --- Fences -------------------------------------------------------------
  let cursor = 0;
  while (cursor < text.length) {
    const end = lineEnd(text, cursor);
    const line = text.slice(cursor, end).replace(/\r?\n$/, '');
    const open = fenceAt(line);

    if (!open) {
      cursor = end;
      continue;
    }

    // A closing fence must use the SAME character and be at least as long.
    // ```` opens a block that ``` does not close; a naive /^```/ closer ends
    // the block early and un-quotes everything after it.
    let scan = end;
    let closeEnd = -1;
    while (scan < text.length) {
      const e = lineEnd(text, scan);
      const l = text.slice(scan, e).replace(/\r?\n$/, '');
      const c = fenceAt(l);
      if (c && c.char === open.char && c.length >= open.length && /^\s*[`~]+\s*$/.test(l)) {
        closeEnd = e;
        break;
      }
      scan = e;
    }

    if (closeEnd === -1) {
      // Unterminated. Discard rather than trust — see ContainmentIndex.
      unterminated = true;
      cursor = end;
      continue;
    }

    // Region begins at the opening fence marker, so the newline that ends the
    // opening line is inside it. FAKE_SYSTEM_ROLE matches /(^|\n)\s*…/, so its
    // start offset points at the newline BEFORE the role label; a region that
    // began at the first content character would report `none` for every
    // fenced SYSTEM: in the repository.
    regions.push({ start: cursor, end: closeEnd, kind: 'fenced_code' });
    mask(cursor, closeEnd);
    cursor = closeEnd;
  }

  // --- Blockquotes --------------------------------------------------------
  cursor = 0;
  while (cursor < text.length) {
    const end = lineEnd(text, cursor);
    if (!masked[cursor]) {
      const line = text.slice(cursor, end);
      if (/^ {0,3}>/.test(line)) {
        regions.push({ start: cursor, end, kind: 'blockquote' });
        mask(cursor, end);
      }
    }
    cursor = end;
  }

  // --- Inline code spans --------------------------------------------------
  // An opening run of N backticks closes only on a run of exactly N, on the
  // same line. CommonMark allows spans across lines; we do not, because one
  // stray backtick would otherwise pair with another 400 lines later and
  // swallow the file.
  for (let i = 0; i < text.length; ) {
    if (masked[i] || text[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (text[i + n] === '`') n++;

    const stop = text.indexOf('\n', i);
    const limit = stop === -1 ? text.length : stop;

    let j = i + n;
    let closed = -1;
    while (j < limit) {
      if (text[j] === '`' && !masked[j]) {
        let k = 0;
        while (text[j + k] === '`') k++;
        if (k === n) {
          closed = j + k;
          break;
        }
        j += k;
        continue;
      }
      j++;
    }

    if (closed === -1) {
      i += n;
      continue;
    }
    regions.push({ start: i, end: closed, kind: 'inline_code' });
    mask(i, closed);
    i = closed;
  }

  // --- Quoted spans -------------------------------------------------------
  // The weakest rule in this file, and a separate kind so it can be named
  // differently in the report and revoked on its own. Single line, bounded
  // length, and the opening quote must follow a space, '(' or a line start —
  // so a multi-sentence payload in quotes does not qualify.
  const QUOTED = /(^|[\s(])(["“])([^"”\n]{1,200})(["”])/g;
  let q: RegExpExecArray | null;
  while ((q = QUOTED.exec(text)) !== null) {
    const start = q.index + q[1].length;
    const end = start + q[2].length + q[3].length + q[4].length;
    let free = true;
    for (let i = start; i < end; i++) if (masked[i]) { free = false; break; }
    if (!free) continue;
    regions.push({ start, end, kind: 'quoted_span' });
    mask(start, end);
  }

  return { regions, unterminated };
}

type CodeState =
  | 'code'
  | 'line_comment'
  | 'block_comment'
  | 'single'
  | 'double'
  | 'template'
  | 'regex'
  | 'triple_single'
  | 'triple_double';

/**
 * Tokens after which a `/` opens a regular expression rather than dividing.
 *
 * Regex literals MUST be modelled. `server/detect.ts` contains `don'?t` inside
 * a regex literal; without this, that apostrophe opens a string state and every
 * offset for the rest of the file is wrong — including the instruction_override
 * pattern, which would then read as unquoted source and be reported as a real
 * finding in our own detector.
 */
const REGEX_PRECEDERS = new Set('=(,:[!&|?{};+-*%<>~^'.split(''));
const REGEX_KEYWORDS = /\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)$/;

/**
 * One left-to-right pass over a source file.
 *
 * One state machine, not several regexes. Scanning strings and comments
 * independently produces the classic failure: `// don't do this` opens a
 * single-quoted string that runs until the next apostrophe several functions
 * away, and everything between is mislabelled.
 */
function indexCode(
  text: string,
  opts: { line: string[]; block: boolean; template: boolean; regex: boolean; triple: boolean },
): { regions: Region[]; unterminated: boolean } {
  const regions: Region[] = [];
  let unterminated = false;

  let state: CodeState = 'code';
  let start = 0;
  let lastSignificant = '';
  let recent = '';

  const close = (end: number, kind: ContainmentKind) => {
    regions.push({ start, end, kind });
    state = 'code';
  };

  for (let i = 0; i < text.length; ) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    const three = text.slice(i, i + 3);

    if (state === 'code') {
      const lineTok = opts.line.find((t) => text.startsWith(t, i));
      if (lineTok) {
        state = 'line_comment';
        start = i;
        i += lineTok.length;
        continue;
      }
      if (opts.block && two === '/*') {
        state = 'block_comment';
        start = i;
        i += 2;
        continue;
      }
      if (opts.triple && (three === "'''" || three === '"""')) {
        state = three === "'''" ? 'triple_single' : 'triple_double';
        start = i;
        i += 3;
        continue;
      }
      if (c === "'") {
        state = 'single';
        start = i;
        i++;
        continue;
      }
      if (c === '"') {
        state = 'double';
        start = i;
        i++;
        continue;
      }
      if (opts.template && c === '`') {
        state = 'template';
        start = i;
        i++;
        continue;
      }
      if (opts.regex && c === '/') {
        const isRegex =
          lastSignificant === '' ||
          REGEX_PRECEDERS.has(lastSignificant) ||
          REGEX_KEYWORDS.test(recent);
        if (isRegex) {
          state = 'regex';
          start = i;
          i++;
          continue;
        }
      }
      if (!/\s/.test(c)) {
        lastSignificant = c;
        recent = (recent + c).slice(-12);
      }
      i++;
      continue;
    }

    if (state === 'line_comment') {
      if (c === '\n') close(i, 'code_comment');
      i++;
      continue;
    }

    if (state === 'block_comment') {
      if (two === '*/') {
        close(i + 2, 'code_comment');
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (state === 'triple_single' || state === 'triple_double') {
      const marker = state === 'triple_single' ? "'''" : '"""';
      if (three === marker) {
        close(i + 3, 'code_string');
        i += 3;
        continue;
      }
      i++;
      continue;
    }

    // String states. Handle the escape of an escape before the escape of a
    // quote, or `"path\\"` mis-ends and the rest of the file shifts.
    if (c === '\\') {
      i += 2;
      continue;
    }

    if (state === 'single' && c === "'") {
      close(i + 1, 'code_string');
      lastSignificant = "'";
      i++;
      continue;
    }
    if (state === 'double' && c === '"') {
      close(i + 1, 'code_string');
      lastSignificant = '"';
      i++;
      continue;
    }
    if (state === 'template' && c === '`') {
      close(i + 1, 'code_string');
      lastSignificant = '`';
      i++;
      continue;
    }
    if (state === 'regex') {
      // A newline inside a regex literal means it was division after all.
      if (c === '\n') {
        state = 'code';
        i++;
        continue;
      }
      if (c === '/') {
        close(i + 1, 'code_string');
        lastSignificant = '/';
        i++;
        continue;
      }
      if (c === '[') {
        // A / inside a character class does not close the literal.
        const end = text.indexOf(']', i);
        i = end === -1 ? i + 1 : end + 1;
        continue;
      }
      i++;
      continue;
    }

    // A single-quoted or double-quoted string must not cross a line.
    if ((state === 'single' || state === 'double') && c === '\n') {
      unterminated = true;
      state = 'code';
      i++;
      continue;
    }

    i++;
  }

  if (state !== 'code') {
    if (state === 'line_comment') {
      regions.push({ start, end: text.length, kind: 'code_comment' });
    } else {
      // An unterminated string, template or block comment. Discarded, not
      // trusted — the same rule as an unterminated markdown fence.
      unterminated = true;
    }
  }

  return { regions, unterminated };
}

/**
 * Builds the region index for one file. O(n), one pass.
 *
 * Two-phase — index once, query many times — because a file can carry up to
 * MAX_MATCHES_PER_DOCUMENT (100) matches. A single `isInsideCode(text, offset)`
 * would re-parse a 256 KB blob a hundred times.
 */
export function indexContainment(text: string, syntax: Syntax): ContainmentIndex {
  const empty: ContainmentIndex = { regions: [], syntax, unterminated: false };
  if (typeof text !== 'string' || text.length === 0) return empty;

  let built: { regions: Region[]; unterminated: boolean };

  switch (syntax) {
    case 'markdown':
      built = indexMarkdown(text);
      break;
    case 'c_like':
      built = indexCode(text, { line: ['//'], block: true, template: true, regex: true, triple: false });
      break;
    case 'python':
      built = indexCode(text, { line: ['#'], block: false, template: false, regex: false, triple: true });
      break;
    case 'hash':
      built = indexCode(text, { line: ['#'], block: false, template: false, regex: false, triple: false });
      break;
    default:
      return empty;
  }

  const regions = built.regions
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);

  // Drop anything nested inside an earlier region so the list is flat and a
  // binary search cannot land on the wrong one.
  const flat: Region[] = [];
  for (const r of regions) {
    const last = flat[flat.length - 1];
    if (last && r.start < last.end) continue;
    flat.push(r);
  }

  return { regions: flat, syntax, unterminated: built.unterminated };
}

/**
 * The containment of a SPAN, not of a point.
 *
 * Both offsets are required. A match that begins inside a fence and ends
 * outside it is not contained — HTML_COMMENT and OVERSIZED_BASE64 can both
 * legitimately straddle a boundary, and treating a straddle as contained would
 * hide the half that escaped.
 */
export function containmentAt(
  index: ContainmentIndex,
  start: number,
  end: number,
): ContainmentKind {
  const regions = index.regions;
  let lo = 0;
  let hi = regions.length - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = regions[mid];
    if (r.start > start) {
      hi = mid - 1;
    } else if (r.end <= start) {
      lo = mid + 1;
    } else {
      return r.start <= start && end <= r.end ? r.kind : 'none';
    }
  }
  return 'none';
}
