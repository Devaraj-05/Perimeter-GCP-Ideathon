import { describe, it, expect } from 'vitest';
import { statusOf, isRecoverable, MODEL_FALLBACK_LADDER } from './gemini';

/**
 * Directive 6 — Resilient Model Fallback Ladder and Error Recovery Matrix.
 *
 * These tests exist because of a real failure: a deployed build received
 * `400 API_KEY_INVALID` and walked all four models in the ladder before
 * surfacing it. Every attempt failed identically, because a bad API key is a
 * property of the request, not of the model. The result was four wasted round
 * trips and a log where the real cause appeared four times.
 *
 * The rule the fix encodes: retry the codes Directive 6 names as recoverable,
 * and surface everything else immediately.
 */

const err = (status: number | undefined, message = '') => ({ status, message });

describe('MODEL_FALLBACK_LADDER', () => {
  it('matches the ladder mandated by Directive 6, in order', () => {
    expect(MODEL_FALLBACK_LADDER).toEqual([
      'gemini-3.6-flash',
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
      'gemini-3.7-flash',
    ]);
  });
});

describe('statusOf', () => {
  it('reads a direct status field', () => {
    expect(statusOf(err(503))).toBe(503);
  });

  it('reads statusCode when status is absent', () => {
    expect(statusOf({ statusCode: 429 })).toBe(429);
  });

  it('extracts the code from a JSON error body when no field is present', () => {
    // This is the shape the SDK actually threw in production.
    const apiError = {
      message:
        '{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}',
    };
    expect(statusOf(apiError)).toBe(400);
  });

  it('returns null rather than guessing when no status can be read', () => {
    // Defaulting to 500 here would silently classify unknown failures as
    // retryable, which is how the original bug produced four identical calls.
    expect(statusOf({ message: 'socket hang up' })).toBeNull();
    expect(statusOf({})).toBeNull();
    expect(statusOf(null)).toBeNull();
  });
});

describe('isRecoverable — Directive 6 Error Recovery Matrix', () => {
  it('retries the codes the directive names', () => {
    for (const code of [429, 500, 502, 503, 504, 404]) {
      expect(isRecoverable(err(code)), `status ${code} should retry`).toBe(true);
    }
  });

  it('does NOT retry a bad API key', () => {
    const apiError = {
      message: '{"error":{"code":400,"message":"API key not valid.","status":"INVALID_ARGUMENT"}}',
    };
    expect(isRecoverable(apiError)).toBe(false);
  });

  it('does NOT retry client errors the next model would also reject', () => {
    for (const code of [400, 401, 403, 413, 422]) {
      expect(isRecoverable(err(code)), `status ${code} should not retry`).toBe(false);
    }
  });

  it('retries transient conditions identified only by message', () => {
    expect(isRecoverable({ message: 'The model is overloaded. Please try again.' })).toBe(true);
    expect(isRecoverable({ message: 'RESOURCE_EXHAUSTED' })).toBe(true);
    expect(isRecoverable({ message: 'UNAVAILABLE' })).toBe(true);
    expect(isRecoverable({ message: 'DEADLINE_EXCEEDED' })).toBe(true);
  });

  it('treats an unreadable failure as permanent', () => {
    // Retrying an unknown error four times is worse than surfacing it once:
    // it multiplies latency and cost while hiding the cause in repetition.
    expect(isRecoverable({ message: 'something unexpected' })).toBe(false);
    expect(isRecoverable({})).toBe(false);
  });

  it('a status field beats a code embedded in the message', () => {
    expect(isRecoverable({ status: 400, message: '{"error":{"code":503}}' })).toBe(false);
  });
});
