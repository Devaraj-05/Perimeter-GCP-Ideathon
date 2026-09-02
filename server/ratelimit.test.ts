import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, __resetRateLimits } from './ratelimit';

beforeEach(() => __resetRateLimits());

describe('checkRateLimit', () => {
  it('allows calls up to the limit', () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit('alice', 5).allowed).toBe(true);
    }
  });

  it('denies the call after the limit is reached', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('alice', 5);
    const r = checkRateLimit('alice', 5);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
  });

  it('reports a retry-after the client can act on', () => {
    for (let i = 0; i < 3; i++) checkRateLimit('alice', 3);
    const r = checkRateLimit('alice', 3);
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
    expect(r.retryAfterSeconds).toBeLessThanOrEqual(3600);
  });

  it('isolates users - one user exhausting quota does not block another', () => {
    for (let i = 0; i < 5; i++) checkRateLimit('alice', 5);
    expect(checkRateLimit('alice', 5).allowed).toBe(false);
    expect(checkRateLimit('bob', 5).allowed).toBe(true);
  });

  it('counts down remaining accurately', () => {
    expect(checkRateLimit('alice', 3).remaining).toBe(2);
    expect(checkRateLimit('alice', 3).remaining).toBe(1);
    expect(checkRateLimit('alice', 3).remaining).toBe(0);
  });

  it('a limit of zero denies immediately', () => {
    expect(checkRateLimit('alice', 0).allowed).toBe(false);
  });
});
