import { GoogleGenAI } from '@google/genai';
import { getGeminiKey } from './secrets';

/**
 * Directive 6: Resilient Model Fallback Ladder + Error Recovery Matrix.
 *
 * Extracted from server.ts unchanged so that the L2 classifier can reuse the
 * same resilience path. server.ts starts a listener on import, so importing
 * from it would be circular and side-effectful.
 */

let aiClient: GoogleGenAI | null = null;

/**
 * INV-8. The key is fetched from Secret Manager on first use and cached in
 * module memory. Async because the fetch is a network call; the cache means
 * that cost is paid once per instance, at cold start.
 */
export async function getAI(): Promise<GoogleGenAI> {
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: await getGeminiKey() });
  }
  return aiClient;
}

export const MODEL_FALLBACK_LADDER = [
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.7-flash',
];


/**
 * Extracts an HTTP status from a Gemini SDK error.
 *
 * The SDK surfaces the code inconsistently: sometimes as `status`, sometimes
 * only inside a JSON body on `message`. Defaulting to 500 when it cannot be
 * read would classify an unknown failure as retryable, so this returns null
 * instead and lets the caller decide.
 */
export function statusOf(err: any): number | null {
  const direct = Number(err?.status ?? err?.statusCode);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const match = /"code"\s*:\s*(\d{3})/.exec(String(err?.message ?? ''));
  return match ? Number(match[1]) : null;
}

/** Directive 6 Error Recovery Matrix, as a pure testable predicate. */
export function isRecoverable(err: any): boolean {
  const status = statusOf(err);
  if (status !== null) {
    return [429, 500, 502, 503, 504].includes(status) || status === 404;
  }

  // No readable status. Fall back to the transient markers the API uses, and
  // treat anything else as permanent - retrying an unknown failure four times
  // is worse than surfacing it once.
  const message = String(err?.message ?? '');
  // A timed-out model is exactly the case the ladder exists for: the next one
  // may well answer. It is recoverable, and the budget above stops the climb
  // from becoming its own hang.
  if (/^model_timeout:/.test(message)) return true;
  return /overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED/.test(message);
}

/**
 * How long one rung of the ladder may take, and how long the whole climb may.
 *
 * Constitution §8 requires every external call to be wrapped in a timeout and
 * names Gemini first. Gemini was the only one without: generateContent was
 * awaited with no deadline, so a slow or wedged model blocked the request
 * until the BROWSER gave up at 30 seconds and showed "that took too long".
 * The server had no opinion about it at all.
 *
 * The ladder makes it worse rather than better. Four models tried in sequence
 * multiply the exposure, so the budget bounds the climb as well as each step:
 * a request that cannot finish inside the budget should fail as a typed error
 * the UI can explain, not as an abandoned socket.
 */
export const MODEL_ATTEMPT_TIMEOUT_MS = 20_000;
export const LADDER_BUDGET_MS = 55_000;

export class ModelTimeoutError extends Error {
  constructor(model: string, ms: number) {
    super(`model_timeout:${model}:${ms}ms`);
    this.name = 'ModelTimeoutError';
  }
}

/**
 * Bounds a model call.
 *
 * Promise.race rather than an SDK abort signal: it bounds what the CALLER
 * waits for regardless of which SDK version is installed, which is the
 * property §8 is actually about. The underlying request may still be in
 * flight; it is no longer holding a user request open.
 */
export async function withDeadline<T>(
  work: Promise<T>,
  model: string,
  ms: number = MODEL_ATTEMPT_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ModelTimeoutError(model, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Quota exhaustion, told apart from every other 429.
 *
 * Google answers a spent quota with the exact time to wait and whether the
 * limit was per-minute or per-DAY. Both were discarded, so a free-tier daily
 * limit — 20 requests per model — surfaced to the user as "the assistant is
 * unavailable, please retry". Retrying was the one thing that could not work:
 * the quota does not come back for hours.
 *
 * A chat turn costs several requests (classifyL2 on each ingest, a Reader per
 * artifact, then the Planner), so twenty is about five interactions. Being
 * told which wall was hit is the difference between waiting a minute and
 * enabling billing.
 */
export class QuotaExhaustedError extends Error {
  constructor(
    readonly model: string,
    readonly retryAfterSeconds: number | null,
    readonly daily: boolean,
  ) {
    super(`quota_exhausted:${model}`);
    this.name = 'QuotaExhaustedError';
  }
}

/** Reads what Google actually said. Returns null when this is not a quota error. */
export function readQuotaError(err: unknown): { retryAfterSeconds: number | null; daily: boolean } | null {
  const raw = String((err as any)?.message ?? '');
  if (!/RESOURCE_EXHAUSTED|exceeded your current quota/i.test(raw)) return null;

  // The delay arrives either as RetryInfo.retryDelay ("24s") or in the prose
  // ("Please retry in 24.59s"). Prefer the structured one.
  let retryAfterSeconds: number | null = null;
  const structured = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(raw);
  const prose = /retry in (\d+(?:\.\d+)?)s/i.exec(raw);
  const found = structured?.[1] ?? prose?.[1];
  if (found) retryAfterSeconds = Math.ceil(Number(found));

  // PerDay in the quota id is the free tier daily cap. Waiting will not fix it.
  const daily = /PerDay|free_tier/i.test(raw);

  return { retryAfterSeconds, daily };
}

/**
 * Credential failures, told apart from each other and from everything else.
 *
 * Sibling of readQuotaError and written for the same reason. Every failure
 * that was not a quota error reached the user as "The assistant is
 * unavailable. Please retry." — which is true, useless, and wrong about the
 * remedy: retrying fixes none of these. An invalid key, a disabled API and a
 * key blocked by its own restrictions are three different operator actions,
 * and the message has to say which.
 *
 * Returns null for anything it cannot name. A classifier that guesses is how
 * the generic message became misleading in the first place.
 */
export type CredentialFault =
  | 'not_configured'
  | 'invalid_key'
  | 'api_disabled'
  | 'key_restricted';

export function readCredentialError(err: unknown): CredentialFault | null {
  const raw = String((err as any)?.message ?? '');
  if (!raw) return null;

  // Quota owns RESOURCE_EXHAUSTED. Two classifiers firing on one error means
  // the second message overwrites the first and the advice is wrong again.
  if (/RESOURCE_EXHAUSTED|exceeded your current quota/i.test(raw)) return null;

  // Thrown by resolveSecret BEFORE any request is made, so no classifier that
  // reads Google's response can ever see it. This is the failure that reached
  // production: a revision with neither variable set.
  if (/^config_missing:/.test(raw)) return 'not_configured';

  // Checked most specific first: a restricted key also mentions the API, and
  // a disabled API also mentions permission.
  if (/API_KEY_SERVICE_BLOCKED|method .* are blocked/i.test(raw)) return 'key_restricted';
  if (/SERVICE_DISABLED|has not been used in project|or it is disabled/i.test(raw)) {
    return 'api_disabled';
  }
  if (/API_KEY_INVALID|API key not valid/i.test(raw)) return 'invalid_key';

  return null;
}

/** The operator action for each fault. Shown to the user, not just logged. */
export const CREDENTIAL_FAULT_MESSAGE: Record<CredentialFault, string> = {
  not_configured:
    'This deployment has no Gemini credential configured. Either GEMINI_KEY_SECRET is unset, or it is set and Secret Manager could not be read — the server log line beginning "[secrets]" says which.',
  invalid_key:
    'The Gemini API key this deployment is using is not valid. Locally that usually means .env still holds the placeholder; in production it means GEMINI_KEY_SECRET points at a bad or disabled secret version.',
  api_disabled:
    'The Generative Language API is not enabled on this project. Enable it, then retry — the key itself is fine.',
  key_restricted:
    'This Gemini API key is blocked by its own API restrictions. Allow the Generative Language API on the key, or use a key without that restriction.',
};

export interface FallbackOptions {
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Standard Helper Implementation:
 * Sequentially executes generateContent using the fallback ladder when encountering
 * recoverable status codes or transient failures.
 */
export async function generateContentWithFallback(
  contents: any,
  options?: FallbackOptions
): Promise<{ text: string; modelUsed: string }> {
  const ai = await getAI();
  const startedAt = Date.now();
  let lastError: any = null;

  for (const modelName of MODEL_FALLBACK_LADDER) {
    // Climbing further cannot help if there is no time left to climb in. The
    // caller gets a typed error it can render rather than a request the
    // browser eventually abandons.
    if (Date.now() - startedAt >= LADDER_BUDGET_MS) {
      throw lastError ?? new ModelTimeoutError('ladder', LADDER_BUDGET_MS);
    }

    try {
      const remaining = LADDER_BUDGET_MS - (Date.now() - startedAt);
      const response = await withDeadline(
        ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction: options?.systemInstruction,
            temperature: options?.temperature ?? 0.7,
            maxOutputTokens: options?.maxOutputTokens ?? 2048,
          },
        }),
        modelName,
        Math.min(MODEL_ATTEMPT_TIMEOUT_MS, Math.max(1_000, remaining)),
      );

      const text = response.text || '';
      if (text) {
        return { text, modelUsed: modelName };
      }
    } catch (err: any) {
      lastError = err;
      const status = statusOf(err);
      const recoverable = isRecoverable(err);

      console.warn(
        `[Gemini Fallback] Model ${modelName} failed (status: ${status}). ` +
          `Recoverable: ${recoverable}. Error: ${err?.message}`,
      );

      // Directive 6 lists the recoverable codes: 503, 429, 404, 500. Anything
      // else is a condition the next model shares - a bad API key, a malformed
      // request, a disabled service - so walking the rest of the ladder burns
      // three more round trips to arrive at the identical failure, and buries
      // the real cause under repetition in the logs.
      if (!recoverable) throw err;
    }
  }

  // Every rung refused. If the reason was quota, say so — a caller told to
  // "retry" when the daily cap is spent is being given the one instruction
  // that cannot help.
  const quota = readQuotaError(lastError);
  if (quota) {
    throw new QuotaExhaustedError(
      MODEL_FALLBACK_LADDER[MODEL_FALLBACK_LADDER.length - 1],
      quota.retryAfterSeconds,
      quota.daily,
    );
  }

  throw lastError || new Error('All Gemini fallback models exhausted.');
}
