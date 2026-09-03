import { describe, it, expect } from 'vitest';
import { securityHeaders } from './headers';

/**
 * The CSP is the second layer under INV-9.
 *
 * INV-9 stops the markdown-image beacon in the renderer, which never emits an
 * <img>. But the deployed CSP said `img-src 'self' data: https:` — any HTTPS
 * origin — so a regressed renderer would have been a working exfiltration
 * channel with nothing behind it. The project's headline threat had exactly
 * one line of defence.
 *
 * These tests keep the narrowed directive from quietly widening again.
 */
function collectCsp(): string {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as any;
  securityHeaders({} as any, res, () => undefined);
  return headers['Content-Security-Policy'];
}

function directive(name: string): string {
  return collectCsp()
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(name))!;
}

describe('CSP backstops INV-9', () => {
  it('is set at all', () => {
    expect(collectCsp()).toBeTruthy();
  });

  it('does not allow images from arbitrary https origins', () => {
    const imgSrc = directive('img-src');
    expect(imgSrc).toBeDefined();
    // `https:` as a bare scheme source is the regression being guarded.
    expect(imgSrc.split(/\s+/)).not.toContain('https:');
    expect(imgSrc).toContain("'self'");
  });

  it('allows the Google avatar origin, which is the only external image used', () => {
    expect(directive('img-src')).toContain('googleusercontent.com');
  });

  it('still forbids objects, framing and stray base tags', () => {
    expect(directive('object-src')).toContain("'none'");
    expect(directive('frame-ancestors')).toContain("'none'");
    expect(directive('base-uri')).toContain("'self'");
  });
});
