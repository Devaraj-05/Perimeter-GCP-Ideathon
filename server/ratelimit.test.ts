import { describe, it, expect, beforeEach } from 'vitest';
import { checkRateLimit, __resetRateLimits, decide, type Bucket } from './ratelimit';

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

describe('decide — the counting rule both paths share', () => {
  const now = 1_000_000;

  it('starts a fresh window when there is no bucket', () => {
    const { result, next } = decide(null, 5, now);
    expect(result.allowed).toBe(true);
    expect(next.count).toBe(1);
  });

  it('resets a window that has elapsed', () => {
    const stale: Bucket = { count: 5, resetAt: now - 1 };
    expect(decide(stale, 5, now).result.allowed).toBe(true);
    expect(decide(stale, 5, now).next.count).toBe(1);
  });

  it('denies at the limit without advancing the window', () => {
    const full: Bucket = { count: 5, resetAt: now + 60_000 };
    const { result, next } = decide(full, 5, now);
    expect(result.allowed).toBe(false);
    // The window must not move, or a client hammering a spent quota keeps the
    // reset perpetually an hour away.
    expect(next.resetAt).toBe(full.resetAt);
  });

  it('a non-positive limit denies and creates no live bucket', () => {
    const { result, next } = decide(null, 0, now);
    expect(result.allowed).toBe(false);
    expect(next.count).toBe(0);
  });

  it('is pure — the same inputs give the same answer', () => {
    const b: Bucket = { count: 2, resetAt: now + 1000 };
    expect(decide(b, 5, now)).toEqual(decide(b, 5, now));
  });
});
