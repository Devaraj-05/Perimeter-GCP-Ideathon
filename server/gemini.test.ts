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

describe('§8 — every model call is bounded', () => {
  /**
   * Constitution §8 requires every external call to be wrapped in a timeout
   * and names Gemini first. Gemini was the only one without one, and the
   * symptom was a chat that returned nothing while the browser showed "that
   * took too long": the server had no opinion about how long a model may
   * take, so the client abandoned a request the server was still working on.
   *
   * Asserted here because an invariant nothing checks is one that drifts.
   */

  it('resolves normally when the work finishes in time', async () => {
    const { withDeadline } = await import('./gemini');
    await expect(withDeadline(Promise.resolve('ok'), 'm', 1_000)).resolves.toBe('ok');
  });

  it('rejects with a typed error when the work does not', async () => {
    const { withDeadline, ModelTimeoutError } = await import('./gemini');
    const never = new Promise(() => undefined);
    await expect(withDeadline(never as Promise<unknown>, 'slow-model', 20)).rejects.toBeInstanceOf(
      ModelTimeoutError,
    );
  });

  it('names the model and the budget, so a log says which rung hung', async () => {
    const { withDeadline } = await import('./gemini');
    const never = new Promise(() => undefined);
    await expect(
      withDeadline(never as Promise<unknown>, 'gemini-3.6-flash', 15),
    ).rejects.toThrow('model_timeout:gemini-3.6-flash:15ms');
  });

  it('treats a timeout as recoverable, so the ladder tries the next model', async () => {
    const { isRecoverable, ModelTimeoutError } = await import('./gemini');
    expect(isRecoverable(new ModelTimeoutError('m', 10))).toBe(true);
  });

  it('does not treat a bad key as recoverable', async () => {
    // A condition the next model shares is not worth three more round trips.
    const { isRecoverable } = await import('./gemini');
    expect(isRecoverable(new Error('API key not valid'))).toBe(false);
  });

  it('clears its timer so a fast call leaves nothing pending', async () => {
    // A leaked timer keeps the event loop alive and makes a server that
    // answered quickly take the full budget to shut down.
    const { withDeadline } = await import('./gemini');
    const before = process.getActiveResourcesInfo?.().length ?? 0;
    await withDeadline(Promise.resolve(1), 'm', 30_000);
    const after = process.getActiveResourcesInfo?.().length ?? 0;
    expect(after).toBeLessThanOrEqual(before);
  });

  it('the ladder budget exceeds no single attempt budget', async () => {
    // If one attempt could outlast the whole climb, the budget would never
    // stop anything.
    const { MODEL_ATTEMPT_TIMEOUT_MS, LADDER_BUDGET_MS } = await import('./gemini');
    expect(LADDER_BUDGET_MS).toBeGreaterThan(MODEL_ATTEMPT_TIMEOUT_MS);
  });
});

describe('quota exhaustion is told apart from every other failure', () => {
  /**
   * Taken from a real Cloud Run log line. Google answers a spent quota with
   * the exact retry delay and whether the cap was per-minute or per-DAY, and
   * both were discarded — so a free-tier daily limit reached the user as
   * "the assistant is unavailable, please retry". Retrying was the one thing
   * that could not work.
   */
  const DAILY_429 = JSON.stringify({
    error: {
      code: 429,
      message:
'        You exceeded your current quota. Quota exceeded for metric: ' +
'        generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
'        limit: 20, model: gemini-3.6-flash. Please retry in 24.592505637s.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '24s' },
      ],
    },
  });

  it('recognises a quota error', async () => {
    const { readQuotaError } = await import('./gemini');
    expect(readQuotaError(new Error(DAILY_429))).not.toBeNull();
  });

  it('reads the retry delay Google supplied, rounded up', async () => {
    const { readQuotaError } = await import('./gemini');
    expect(readQuotaError(new Error(DAILY_429))!.retryAfterSeconds).toBe(24);
  });

  it('knows a DAILY cap from a per-minute one', async () => {
    // The difference is whether the answer is "wait a minute" or "enable
    // billing", and they are not interchangeable advice.
    const { readQuotaError } = await import('./gemini');
    expect(readQuotaError(new Error(DAILY_429))!.daily).toBe(true);

    const perMinute = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded. Please retry in 3s.',
        details: [{ quotaId: 'GenerateRequestsPerMinutePerProject' }],
      },
    });
    expect(readQuotaError(new Error(perMinute))!.daily).toBe(false);
    expect(readQuotaError(new Error(perMinute))!.retryAfterSeconds).toBe(3);
  });

  it('is not fooled by an unrelated failure', async () => {
    const { readQuotaError } = await import('./gemini');
    expect(readQuotaError(new Error('503 UNAVAILABLE: high demand'))).toBeNull();
    expect(readQuotaError(new Error('API key not valid'))).toBeNull();
    expect(readQuotaError(undefined)).toBeNull();
  });

  it('survives a quota error with no delay in it', async () => {
    // Absent structure must produce null rather than NaN, or the UI renders
    // "try again in NaN seconds".
    const { readQuotaError } = await import('./gemini');
    const bare = readQuotaError(new Error('RESOURCE_EXHAUSTED'))!;
    expect(bare.retryAfterSeconds).toBeNull();
  });
});

describe('a credential failure names itself', () => {
  /**
   * The generic 500 — "The assistant is unavailable. Please retry." — was
   * reached by every failure that was not a quota error. An invalid key, a
   * disabled API and a restricted key are three different operator actions,
   * and collapsing them into one sentence sent the operator to the logs each
   * time. Retrying works for none of them.
   *
   * Bodies below are the shapes Google actually returns; the placeholder case
   * is the one this project hit, from an unfilled `.env`.
   */
  const INVALID_KEY = JSON.stringify({
    error: {
      code: 400,
      message: 'API key not valid. Please pass a valid API key.',
      status: 'INVALID_ARGUMENT',
      details: [{ reason: 'API_KEY_INVALID' }],
    },
  });

  const SERVICE_DISABLED = JSON.stringify({
    error: {
      code: 403,
      message:
        'Generative Language API has not been used in project 12345 before or it is disabled.',
      status: 'PERMISSION_DENIED',
      details: [{ reason: 'SERVICE_DISABLED' }],
    },
  });

  const KEY_RESTRICTED = JSON.stringify({
    error: {
      code: 403,
      message:
        'Requests to this API generativelanguage.googleapis.com method ' +
        'google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent are blocked.',
      status: 'PERMISSION_DENIED',
      details: [{ reason: 'API_KEY_SERVICE_BLOCKED' }],
    },
  });

  it('recognises an invalid key', async () => {
    const { readCredentialError } = await import('./gemini');
    expect(readCredentialError(new Error(INVALID_KEY))).toBe('invalid_key');
  });

  it('recognises a disabled API, which is not the same as a bad key', async () => {
    // "Enable the API" and "replace the key" are different actions.
    const { readCredentialError } = await import('./gemini');
    expect(readCredentialError(new Error(SERVICE_DISABLED))).toBe('api_disabled');
  });

  it('recognises a key blocked by its own restrictions', async () => {
    const { readCredentialError } = await import('./gemini');
    expect(readCredentialError(new Error(KEY_RESTRICTED))).toBe('key_restricted');
  });

  it('catches a placeholder that never was a key', async () => {
    // The literal case: an unfilled .env sends "PASTE_YOUR_KEY_HERE" to
    // Google, which answers API_KEY_INVALID like any other bad string.
    const { readCredentialError } = await import('./gemini');
    expect(readCredentialError(new Error('API_KEY_INVALID'))).toBe('invalid_key');
  });

  it('does not claim a quota error or a transient one', async () => {
    // These already have handlers. Two classifiers must not both fire, or the
    // second message overwrites the first and the advice is wrong again.
    const { readCredentialError, readQuotaError } = await import('./gemini');
    expect(readCredentialError(new Error('503 UNAVAILABLE: high demand'))).toBeNull();
    const daily = JSON.stringify({
      error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'You exceeded your current quota.' },
    });
    expect(readCredentialError(new Error(daily))).toBeNull();
    expect(readQuotaError(new Error(INVALID_KEY))).toBeNull();
    expect(readCredentialError(undefined)).toBeNull();
  });
});
