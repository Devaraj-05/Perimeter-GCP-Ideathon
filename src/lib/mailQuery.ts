/**
 * Turning what the user asked into a Gmail search — Amendment R.3, INV-26.
 *
 * Applied to the user's own message and to nothing else. Never to a turn, an
 * artifact, an attachment or a tool result — the same rule `extractUrls` and
 * `findRepoReference` follow, for the same reason: a search term taken from
 * untrusted content is an attacker choosing which of the user's emails this
 * application reads and loads into its own context.
 *
 * The result is a Gmail search expression. It is URL-encoded into the `q`
 * parameter server-side and never concatenated into a prompt, so it selects
 * documents and cannot instruct anything. Every message it selects is still
 * UNTRUSTED and still enters through the Reader unchanged.
 *
 * Why this exists: "is there any mail about the Gen AI Academy APAC Edition"
 * used to fetch the ten most recent messages and hand them to the model, which
 * faithfully summarised four unrelated emails. The model was not wrong — it was
 * given the wrong documents.
 */

/** Words that say a mailbox is meant. Not search terms. */
const MAIL_WORDS = /^(mail|mails|mailbox|inbox|e-?mail|e-?mails|message|messages|msg)$/i;

/** Words that say WHEN. Handled as a date bound, not as text to match. */
const TIME_WORDS =
  /^(today|todays|today's|yesterday|recent|recently|latest|new|newest|this|past|last|week|weeks|day|days|morning|evening)$/i;

/**
 * Ordinary question scaffolding.
 *
 * Deliberately conservative: a word only belongs here when including it as a
 * search term would make the search worse. Anything not listed survives into
 * the query, because a missing term costs recall and a wrong term costs the
 * whole answer.
 */
const SCAFFOLDING = new Set([
  'fetch', 'get', 'show', 'list', 'find', 'search', 'check', 'read', 'open',
  'tell', 'give', 'bring', 'pull', 'see', 'look', 'looking', 'summarise',
  'summarize', 'summary', 'any', 'all', 'some', 'is', 'are', 'was', 'were',
  'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
  'there', 'here', 'me', 'my', 'mine', 'i', 'you', 'your', 'it', 'its',
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at',
  'for', 'from', 'with', 'about', 'regarding', 'related', 'concerning', 're',
  'please', 'kindly', 'what', 'which', 'who', 'whom', 'when', 'where', 'why',
  'how', 'anything', 'something', 'received', 'receive', 'got', 'sent',
  'that', 'this', 'these', 'those', 'them', 'they',
]);

export interface MailQuery {
  /** The Gmail search expression. Empty means "most recent", the old behaviour. */
  q: string;
  /** True when the user named something specific to look for. */
  hasTerms: boolean;
  /** The date bound that was recognised, if any. Exposed for tests and copy. */
  dateBound: string | null;
}

/** Maps the time words a person actually types onto Gmail's date operators. */
function dateBoundFor(text: string): string | null {
  const t = text.toLowerCase();
  if (/\byesterday\b/.test(t)) return 'newer_than:2d';
  if (/\btoday'?s?\b/.test(t)) return 'newer_than:1d';
  if (/\b(this|past|last)\s+week\b/.test(t)) return 'newer_than:7d';
  if (/\b(this|past|last)\s+month\b/.test(t)) return 'newer_than:30d';
  return null;
}

/**
 * Builds the search for a message that has already been judged to be about mail.
 *
 * The precedence is deliberate. When the message carries BOTH a date word and
 * a specific subject — "fetch today emails and is there any mail Gen AI Academy
 * APAC Edition" — the subject wins and the date bound is dropped. Those are two
 * questions, and the specific one is the one that has a wrong answer: ANDing
 * them returns nothing whenever the message the user is looking for is older
 * than today, and "no results" is the least useful reply available. Asking only
 * for a date keeps the date.
 */
export function buildMailQuery(text: string): MailQuery {
  const raw = typeof text === 'string' ? text : '';
  const dateBound = dateBoundFor(raw);

  const terms = raw
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}@._-]+|[^\p{L}\p{N}@._-]+$/gu, ''))
    .filter(Boolean)
    .filter((w) => !MAIL_WORDS.test(w))
    .filter((w) => !TIME_WORDS.test(w))
    .filter((w) => !SCAFFOLDING.has(w.toLowerCase()))
    // Gmail's own operators, typed by a user who knows them, are left alone.
    .filter((w) => w.length > 1 || /^[\p{L}\p{N}]$/u.test(w));

  if (terms.length > 0) {
    // Space-separated is Gmail's AND. Capped so a pasted paragraph cannot
    // become a hundred-clause query that matches nothing.
    return { q: terms.slice(0, 12).join(' '), hasTerms: true, dateBound };
  }

  return { q: dateBound ?? '', hasTerms: false, dateBound };
}
