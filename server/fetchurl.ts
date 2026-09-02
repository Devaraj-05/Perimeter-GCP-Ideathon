import { lookup } from 'dns/promises';
import ipaddr from 'ipaddr.js';
import { PerimeterViolation } from './segments';

/**
 * Guarded outbound fetch — INV-11.
 *
 * This is the file that takes a URL from a user, which makes it the SSRF
 * surface. Everything here exists because "fetch the link they pasted" is one
 * of the easiest ways to turn a web app into a proxy for reading things it
 * should not reach — most notably the cloud metadata endpoint, which on a
 * misconfigured instance hands out service account tokens.
 *
 * The checks, in the order they must happen:
 *
 *  1. Scheme, credentials and port, before anything resolves.
 *  2. DNS resolution, checking EVERY returned address. A hostile domain can
 *     return one public and one private address; checking only the first is a
 *     bypass.
 *  3. Redirects handled manually, re-validating each hop. `redirect: 'follow'`
 *     would let a public URL 302 to 169.254.169.254 after the check passed.
 *  4. Size and time caps, enforced while streaming rather than after.
 *  5. Content type, so a fetch cannot be pointed at a binary.
 *
 * A note on what this deliberately does NOT do: it does not resolve and then
 * connect to the resolved IP (which would close the DNS-rebinding window
 * between check and connect). Doing that properly requires a custom agent and
 * breaks TLS SNI. The residual risk is a rebind attack in the milliseconds
 * between our lookup and Node's, which is narrow but real. Stated rather than
 * hidden.
 */

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const ALLOWED_PORTS = new Set(['', '443']);

const ALLOWED_CONTENT = [/^text\/html/i, /^text\/plain/i, /^application\/json/i, /^application\/xhtml/i];

/** IP ranges that must never be reachable from a user-supplied URL. */
const BLOCKED_RANGES = new Set([
  'unspecified',
  'broadcast',
  'multicast',
  'linkLocal',
  'loopback',
  'private',
  'reserved',
  'carrierGradeNat',
  'uniqueLocal',
  'ipv4Mapped',
  'rfc6145',
  'rfc6052',
  '6to4',
  'teredo',
]);

/**
 * True when an address must not be fetched.
 *
 * Pure and exported so the range table is directly testable — a bug here is
 * the vulnerability, not a step towards it.
 */
export function isBlockedAddress(address: string): boolean {
  let parsed;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    // Unparseable means we cannot reason about it. Fail closed.
    return true;
  }

  // The metadata endpoint is link-local and already covered, but it is named
  // explicitly because it is the single highest-value target on this platform.
  if (address === '169.254.169.254' || address === 'fd00:ec2::254') return true;

  const range = parsed.range();
  if (BLOCKED_RANGES.has(range)) return true;

  // An IPv4-mapped IPv6 address hides an IPv4 address that might itself be
  // private: ::ffff:127.0.0.1 is loopback wearing a costume.
  if (parsed.kind() === 'ipv6') {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      return isBlockedAddress(v6.toIPv4Address().toString());
    }
  }

  return range !== 'unicast';
}

/**
 * Validates the URL's own shape, before any network activity.
 *
 * Throws rather than returning false so a caller cannot accidentally ignore
 * the result.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new PerimeterViolation('INV-11', 'malformed url');
  }

  if (url.protocol !== 'https:') {
    // http:, file:, gopher:, data: and friends all land here.
    throw new PerimeterViolation('INV-11', `refused scheme ${url.protocol}`);
  }
  if (url.username || url.password) {
    // https://user:pass@host is a credential-smuggling and confusion vector.
    throw new PerimeterViolation('INV-11', 'credentials in url');
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new PerimeterViolation('INV-11', `refused port ${url.port}`);
  }
  if (!url.hostname) {
    throw new PerimeterViolation('INV-11', 'missing hostname');
  }

  return url;
}

/**
 * Resolves a hostname and rejects it if ANY address is blocked.
 *
 * `all: true` matters. A hostname can resolve to several addresses, and an
 * attacker controlling DNS can return one public and one private. Checking
 * only the first would pass, and Node might then connect to the second.
 */
export async function assertResolvesPublic(hostname: string): Promise<string[]> {
  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new PerimeterViolation('INV-11', 'dns resolution failed');
  }

  if (addresses.length === 0) {
    throw new PerimeterViolation('INV-11', 'hostname resolved to nothing');
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new PerimeterViolation('INV-11', `resolves to a blocked address (${address})`);
    }
  }

  return addresses.map((a) => a.address);
}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  contentType: string;
  text: string;
  bytes: number;
  truncated: boolean;
}

/**
 * Reads a response body without letting it exceed the cap.
 *
 * Checking Content-Length is not enough: it is attacker-supplied and can lie,
 * or be absent entirely on a chunked response. This counts what actually
 * arrives and stops.
 */
async function readCapped(res: Response): Promise<{ text: string; bytes: number; truncated: boolean }> {
  const reader = res.body?.getReader();
  if (!reader) return { text: '', bytes: 0, truncated: false };

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let truncated = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    bytes += value.byteLength;
    if (bytes > MAX_BYTES) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }

  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: merged.toString('utf8'), bytes, truncated };
}

/**
 * Converts HTML to the text a detector needs to see.
 *
 * Deliberately RETAINS HTML comments and the content of elements hidden by
 * CSS. Those are exactly where injection payloads live — white-on-white 1px
 * text and `<!-- SYSTEM: ... -->` are the two most common shapes. A sanitiser
 * that strips them would hand the Reader a document that looks clean while the
 * attack sails through in the part a human cannot see either.
 *
 * Only <script> and <style> bodies are dropped, because those are markup
 * machinery rather than content.
 */
export function extractText(html: string, contentType: string): string {
  if (!/html/i.test(contentType)) return String(html ?? '');

  let text = String(html ?? '');

  // Surface comments as visible text rather than discarding them.
  text = text.replace(/<!--([\s\S]*?)-->/g, (_m, body) => `\n[html-comment] ${body}\n`);

  text = text
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fetches one page, following redirects manually and re-validating each hop.
 */
export async function safeFetch(rawUrl: string): Promise<FetchedPage> {
  let current = assertPublicHttpUrl(rawUrl);
  const original = current.toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertResolvesPublic(current.hostname);

    let res: Response;
    try {
      res = await fetch(current, {
        // Manual, not 'follow'. A public URL that 302s to the metadata
        // endpoint would otherwise defeat every check above it.
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: 'text/html,text/plain,application/json', 'User-Agent': 'perimeter-reader' },
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError') {
        throw new PerimeterViolation('INV-11', 'fetch timed out');
      }
      throw new PerimeterViolation('INV-11', 'could not reach the url');
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) throw new PerimeterViolation('INV-11', 'redirect without a location');
      if (hop === MAX_REDIRECTS) throw new PerimeterViolation('INV-11', 'too many redirects');

      // Re-validated at the top of the next iteration, which is the point.
      current = assertPublicHttpUrl(new URL(location, current).toString());
      continue;
    }

    if (!res.ok) {
      throw new PerimeterViolation('INV-11', `upstream returned ${res.status}`);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!ALLOWED_CONTENT.some((r) => r.test(contentType))) {
      throw new PerimeterViolation('INV-11', `refused content-type ${contentType || 'unknown'}`);
    }

    const { text, bytes, truncated } = await readCapped(res);
    return {
      url: original,
      finalUrl: current.toString(),
      contentType,
      text: extractText(text, contentType),
      bytes,
      truncated,
    };
  }

  throw new PerimeterViolation('INV-11', 'too many redirects');
}
