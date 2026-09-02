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
    return { signals: [], score: 0, highConfidence: [] };
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

  return { signals, score: Math.min(1, Number(score.toFixed(4))), highConfidence };
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
