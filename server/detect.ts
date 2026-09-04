/**
 * Detection Layer 1 - deterministic.
 *
 * Amendment A.3: detection is layered and the model layer is NOT the control.
 * Everything here is a pure function over a string. No network, no model, no
 * clock, no randomness - so it is fully unit-testable and cannot be argued
 * with by the text it is inspecting.
 *
 * L1 is a signal generator, not a verdict authority on its own; fuseVerdict()
 * combines it with the L2 score. Ambiguity resolves toward the more suspicious
 * outcome (A.3).
 */

export type Signal =
  | 'imperative_to_agent'
  | 'instruction_override'
  | 'tool_invocation_request'
  | 'concealment_request'
  | 'hidden_unicode'
  | 'bidi_override'
  | 'html_comment'
  | 'oversized_base64'
  | 'markdown_image_exfil'
  | 'offdomain_url'
  | 'fake_system_role';

export type Verdict = 'clean' | 'suspicious' | 'hostile';

export interface L1Result {
  signals: Signal[];
  /** 0..1. Deterministic, derived only from which signals fired. */
  score: number;
  /** Signals that alone justify a hostile verdict. */
  highConfidence: Signal[];
  /** Where each signal fired. Evidence, not verdict — see Match. */
  matches: Match[];
}

/**
 * One place a signal fired.
 *
 * This exists because a verdict is not evidence. The application could tell a
 * user their document was HOSTILE and could not show them a single character
 * of why, because every check here was a boolean .test(). A red badge with no
 * quotation asks the user to take our word for it, which is the opposite of
 * what this application is for.
 *
 * Every field is derived from a regex match offset. No model produces any of
 * it — asking the Reader to explain an attack would let a poisoned document
 * write our security report.
 */
export interface Match {
  signal: Signal;
  /** Character offsets into the scanned text. */
  start: number;
  end: number;
  /** 1-based line number of `start`, for display. */
  line: number;
  /** The match plus surrounding context. Capped — Constitution §7. */
  excerpt: string;
  /** True when the matched characters render as nothing and must be escaped. */
  hidden: boolean;
}

/**
 * Signals that, on their own, are strong enough to mark content hostile.
 * Kept deliberately short: a false positive here blocks a legitimate write,
 * so membership requires the pattern to have essentially no benign reading
 * inside third-party content the user merely asked us to read.
 */
const HIGH_CONFIDENCE: ReadonlySet<Signal> = new Set<Signal>([
  'instruction_override',
  'tool_invocation_request',
  'concealment_request',
  'fake_system_role',
  'bidi_override',
]);

const SIGNAL_WEIGHTS: Record<Signal, number> = {
  instruction_override: 0.9,
  tool_invocation_request: 0.9,
  concealment_request: 0.85,
  fake_system_role: 0.8,
  bidi_override: 0.8,
  imperative_to_agent: 0.5,
  markdown_image_exfil: 0.5,
  hidden_unicode: 0.4,
  html_comment: 0.25,
  oversized_base64: 0.25,
  offdomain_url: 0.15,
};

/** "ignore previous instructions", "disregard all prior directions", etc. */
const INSTRUCTION_OVERRIDE =
  /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(previous|prior|earlier|above|all)\b[^.!?\n]{0,40}\b(instruction|instructions|prompt|prompts|direction|directions|rule|rules|context)\b/i;

/** Text addressed to the model rather than the reader. */
const IMPERATIVE_TO_AGENT =
  /\b(you\s+(are|must|will|should)\s+(now\s+)?(a|an|instead|no\s+longer)|as\s+an\s+ai\b|when\s+(you\s+)?(summaris|summariz|process|read|analys|analyz)\w*\b[^.!?\n]{0,30}\balso\b|new\s+(instructions?|task|persona|role)\s*:)/i;

/** Requests that the agent call a tool or perform a side effect. */
const TOOL_INVOCATION =
  /\b(call|invoke|execute|run|trigger|use)\b[^.!?\n]{0,30}\b(the\s+)?[a-z_]{3,40}\s*(tool|function|api|command|endpoint)\b|\b(create_note|send_message|send_email|delete_|exfil)\w*\s*\(/i;

/** "do not mention this", "keep this secret from the user". */
const CONCEALMENT =
  /\b(do\s+not|don'?t|never)\b[^.!?\n]{0,30}\b(mention|tell|reveal|disclose|inform|show|report|notify)\b[^.!?\n]{0,30}\b(this|it|the\s+user|anyone|them)\b|\bwithout\s+(telling|informing|alerting)\s+the\s+user\b/i;

/**
 * Text impersonating a system or developer turn.
 *
 * Two shapes. The first is a role word acting as a turn label: `SYSTEM:`,
 * `[assistant]:`, `### developer -`. The second is a bracketed pseudo-directive
 * where the role word is not the last token — `[ADMIN OVERRIDE]`,
 * `[SYSTEM DIRECTIVE]` — which the label form misses because the word before
 * the delimiter is "OVERRIDE", not "ADMIN". That gap was found by corpus
 * payload P03.
 */
const FAKE_SYSTEM_ROLE =
  /(^|\n)\s*(\[|<|#{1,3}\s*)?\s*(system|assistant|developer|admin)\s*(\]|>)?\s*[:\-]/i;

const FAKE_SYSTEM_DIRECTIVE =
  /\[\s*(system|admin|developer|root|override)\b[^\]]*\]|\b(admin|system)\s+(override|directive|mode|command)\b/i;

/** Zero-width and other invisible formatting characters. */
const HIDDEN_UNICODE = /[​-‍⁠﻿­]/;

/** Bidirectional override characters - used to visually reorder text. */
const BIDI_OVERRIDE = /[‪-‮⁦-⁩]/;

const HTML_COMMENT = /<!--[\s\S]*?-->/;

/** Base64-looking blob long enough to hide a payload. */
const OVERSIZED_BASE64 = /[A-Za-z0-9+/]{512,}={0,2}/;

/** Markdown image whose URL carries a query string - classic exfil vector. */
const MARKDOWN_IMAGE_EXFIL = /!\[[^\]]*\]\(\s*https?:\/\/[^\s)]+\?[^\s)]+\)/i;

const URL_PATTERN = /https?:\/\/([^\s/?#"'<>)\]]+)/gi;

function hostOf(url: string): string {
  const match = /^https?:\/\/([^\s/?#"'<>)\]]+)/i.exec(url);
  return match ? match[1].toLowerCase().replace(/^www\./, '') : '';
}

/**
 * Detects links pointing somewhere other than the source's own domain.
 * Weak on its own - most benign issues link outward - which is why it carries
 * a low weight and is not high-confidence.
 */
function findOffDomainUrls(text: string, allowedHosts: string[]): boolean {
  const allowed = allowedHosts.map((h) => h.toLowerCase().replace(/^www\./, ''));
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const host = hostOf(match[0]);
    if (!host) continue;
    const permitted = allowed.some((a) => host === a || host.endsWith(`.${a}`));
    if (!permitted) return true;
  }
  return false;
}

const MAX_MATCHES_PER_SIGNAL = 20;
const MAX_MATCHES_PER_DOCUMENT = 100;
const EXCERPT_CONTEXT = 80;
const EXCERPT_CAP = 200;

/** Signals whose matched characters are invisible when rendered. */
const HIDDEN_SIGNALS = new Set<Signal>(['hidden_unicode', 'bidi_override']);

/**
 * Written with explicit escapes rather than literal characters, unlike the
 * detection patterns above. A character class whose contents are themselves
 * invisible cannot be reviewed by the next person to read this file.
 */
const INVISIBLE = /[​-‍⁠﻿­‪-‮⁦-⁩]/g;

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Renders invisible characters as code points.
 *
 * An excerpt of a zero-width payload is otherwise byte-for-byte
 * indistinguishable from ordinary text on screen, which makes it useless as
 * evidence: the user sees "harmlesstext" and no reason for the warning.
 */
function escapeInvisible(value: string): string {
  return value.replace(
    INVISIBLE,
    (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
  );
}

function excerptAround(text: string, start: number, end: number, hidden: boolean): string {
  const from = Math.max(0, start - EXCERPT_CONTEXT);
  const to = Math.min(text.length, end + EXCERPT_CONTEXT);
  const slice = text.slice(from, to);
  return (hidden ? escapeInvisible(slice) : slice).slice(0, EXCERPT_CAP);
}

/**
 * Collects every match of one pattern.
 *
 * The globalised clone is built per call and deliberately never hoisted to
 * module scope. A global RegExp carries mutable lastIndex, so a shared one
 * would resume mid-document on the next call and silently skip matches on
 * every second scan — a detector that works only on odd-numbered documents.
 */
function sweep(text: string, pattern: RegExp, signal: Signal): Match[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
  const scanner = new RegExp(pattern.source, flags);
  const hidden = HIDDEN_SIGNALS.has(signal);
  const out: Match[] = [];

  let m: RegExpExecArray | null;
  while (out.length < MAX_MATCHES_PER_SIGNAL && (m = scanner.exec(text)) !== null) {
    // A pattern able to match the empty string would never advance lastIndex.
    if (m[0].length === 0) {
      scanner.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    out.push({
      signal,
      start,
      end,
      line: lineOf(text, start),
      excerpt: excerptAround(text, start, end, hidden),
      hidden,
    });
  }
  return out;
}

/** Same rule as findOffDomainUrls, but records where each offending URL sits. */
function offDomainUrlMatches(text: string, allowedHosts: string[]): Match[] {
  const allowed = allowedHosts.map((h) => h.toLowerCase().replace(/^www./, ''));
  const scanner = new RegExp(URL_PATTERN.source, URL_PATTERN.flags);
  const out: Match[] = [];

  let m: RegExpExecArray | null;
  while (out.length < MAX_MATCHES_PER_SIGNAL && (m = scanner.exec(text)) !== null) {
    const host = hostOf(m[0]);
    if (!host) continue;
    if (allowed.some((a) => host === a || host.endsWith(`.${a}`))) continue;
    const start = m.index;
    const end = start + m[0].length;
    out.push({
      signal: 'offdomain_url',
      start,
      end,
      line: lineOf(text, start),
      excerpt: excerptAround(text, start, end, false),
      hidden: false,
    });
  }
  return out;
}

export interface L1Options {
  /** Hosts considered native to the artifact's own source. */
  allowedHosts?: string[];
}

/**
 * Runs every deterministic check over a single piece of untrusted text.
 * Never throws: detection failing open on malformed input would be worse than
 * a false positive.
 */
export function detectL1(text: unknown, options: L1Options = {}): L1Result {
  const input = typeof text === 'string' ? text : '';
  if (!input) {
    return { signals: [], score: 0, highConfidence: [], matches: [] };
  }

  const allowedHosts = options.allowedHosts ?? ['github.com', 'githubusercontent.com'];
  const signals: Signal[] = [];

  if (INSTRUCTION_OVERRIDE.test(input)) signals.push('instruction_override');
  if (IMPERATIVE_TO_AGENT.test(input)) signals.push('imperative_to_agent');
  if (TOOL_INVOCATION.test(input)) signals.push('tool_invocation_request');
  if (CONCEALMENT.test(input)) signals.push('concealment_request');
  if (FAKE_SYSTEM_ROLE.test(input) || FAKE_SYSTEM_DIRECTIVE.test(input)) signals.push('fake_system_role');
  if (HIDDEN_UNICODE.test(input)) signals.push('hidden_unicode');
  if (BIDI_OVERRIDE.test(input)) signals.push('bidi_override');
  if (HTML_COMMENT.test(input)) signals.push('html_comment');
  if (OVERSIZED_BASE64.test(input)) signals.push('oversized_base64');
  if (MARKDOWN_IMAGE_EXFIL.test(input)) signals.push('markdown_image_exfil');
  if (findOffDomainUrls(input, allowedHosts)) signals.push('offdomain_url');

  const highConfidence = signals.filter((s) => HIGH_CONFIDENCE.has(s));

  // Combine weights so that multiple weak signals can still add up, without
  // any single weak signal reaching the hostile threshold on its own.
  const score = signals.reduce((acc, s) => acc + (1 - acc) * SIGNAL_WEIGHTS[s], 0);

  // Additive, and deliberately a SECOND pass rather than a refactor of the
  // boolean sweep above.
  //
  // Deriving signals from matches.length > 0 would be tidier and would also
  // make a verdict regression possible in the one file that decides whether a
  // write is blocked. The duplicated work is the price of the guarantee that
  // adding evidence cannot change a decision.
  const matches: Match[] = [
    ...sweep(input, INSTRUCTION_OVERRIDE, 'instruction_override'),
    ...sweep(input, IMPERATIVE_TO_AGENT, 'imperative_to_agent'),
    ...sweep(input, TOOL_INVOCATION, 'tool_invocation_request'),
    ...sweep(input, CONCEALMENT, 'concealment_request'),
    // Both shapes report under the one signal they share.
    ...sweep(input, FAKE_SYSTEM_ROLE, 'fake_system_role'),
    ...sweep(input, FAKE_SYSTEM_DIRECTIVE, 'fake_system_role'),
    ...sweep(input, HIDDEN_UNICODE, 'hidden_unicode'),
    ...sweep(input, BIDI_OVERRIDE, 'bidi_override'),
    ...sweep(input, HTML_COMMENT, 'html_comment'),
    ...sweep(input, OVERSIZED_BASE64, 'oversized_base64'),
    ...sweep(input, MARKDOWN_IMAGE_EXFIL, 'markdown_image_exfil'),
    ...offDomainUrlMatches(input, allowedHosts),
  ]
    .sort((x, y) => x.start - y.start)
    .slice(0, MAX_MATCHES_PER_DOCUMENT);

  return {
    signals,
    score: Math.min(1, Number(score.toFixed(4))),
    highConfidence,
    matches,
  };
}

export const L2_HOSTILE_THRESHOLD = 0.7;
export const SUSPICIOUS_THRESHOLD = 0.3;

/**
 * Amendment A.3 fusion rule. L1 high-confidence hits and a high L2 score are
 * independent routes to "hostile"; either suffices. Anything above the
 * suspicious floor is suspicious. Ambiguity resolves upward, never downward.
 *
 * L2 is deliberately unable to *lower* a verdict L1 has raised - a compromised
 * or fooled classifier must not be able to clear hostile content.
 */
export function fuseVerdict(l1: L1Result, l2Score: number | null): Verdict {
  const l2 = typeof l2Score === 'number' && Number.isFinite(l2Score) ? l2Score : null;

  if (l1.highConfidence.length > 0) return 'hostile';
  if (l2 !== null && l2 >= L2_HOSTILE_THRESHOLD) return 'hostile';

  const combined = l2 === null ? l1.score : Math.max(l1.score, l2);
  if (combined >= SUSPICIOUS_THRESHOLD) return 'suspicious';
  if (l1.signals.length > 0) return 'suspicious';

  return 'clean';
}
