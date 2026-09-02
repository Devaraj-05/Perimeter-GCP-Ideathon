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
  return /overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE|DEADLINE_EXCEEDED/.test(message);
}

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
  let lastError: any = null;

  for (const modelName of MODEL_FALLBACK_LADDER) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents,
        config: {
          systemInstruction: options?.systemInstruction,
          temperature: options?.temperature ?? 0.7,
          maxOutputTokens: options?.maxOutputTokens ?? 2048,
        },
      });

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

  throw lastError || new Error('All Gemini fallback models exhausted.');
}
