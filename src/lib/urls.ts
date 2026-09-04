/**
 * URL extraction for the web-search toggle.
 *
 * This function must only ever be applied to text the USER typed into the
 * composer. That is not a style preference — it is the boundary.
 *
 * A URL inside untrusted content is an attacker choosing what our server
 * requests. Following one would hand an attacker a fetch primitive pointed at
 * whatever they like, which is SSRF by proxy and would undo `fetchurl.ts`
 * entirely. `fetchurl` refuses private addresses, but the right answer is not
 * to rely on that: it is never to look for links in attacker-controlled text in
 * the first place.
 *
 * So: user input in, candidate URLs out, and nothing in this file ever sees an
 * artifact body.
 */

/**
 * At most three per message.
 *
 * A message containing forty links should not become forty fetches. The cap is
 * about the user's own quota and latency, not about safety — safety is the
 * source of the text, not the count.
 */
export const MAX_URLS_PER_MESSAGE = 3;

/** Matches http(s) URLs. Deliberately narrow: no bare hostnames, no other schemes. */
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;

/**
 * Trailing punctuation is almost always sentence punctuation rather than part
 * of the address — "see https://example.com." should not fetch a trailing dot.
 * Unbalanced closing brackets get the same treatment.
 */
function trimTrailing(raw: string): string {
  let url = raw;
  for (;;) {
    const last = url[url.length - 1];
    if (!last) break;
    if ('.,;:!?'.includes(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ')' && !url.includes('(')) {
      url = url.slice(0, -1);
      continue;
    }
    if ((last === ']' && !url.includes('[')) || (last === '}' && !url.includes('{'))) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

/**
 * Pulls the http(s) links out of a message the user typed.
 *
 * Returns them in order, deduplicated, capped. The server still applies every
 * SSRF check when it fetches — this only decides what is offered.
 */
export function extractUrls(userMessage: string): string[] {
  if (typeof userMessage !== 'string' || !userMessage) return [];

  const found = userMessage.match(URL_PATTERN) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of found) {
    const url = trimTrailing(raw);

    // Parse before offering it: a string that is not a URL should not reach
    // the server as one.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      continue;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;

    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);

    if (out.length >= MAX_URLS_PER_MESSAGE) break;
  }

  return out;
}

/** True when a message mentions a link, used to prompt for the toggle. */
export function mentionsUrl(userMessage: string): boolean {
  return extractUrls(userMessage).length > 0;
}
