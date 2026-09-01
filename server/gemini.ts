import { GoogleGenAI } from '@google/genai';

/**
 * Directive 6: Resilient Model Fallback Ladder + Error Recovery Matrix.
 *
 * Extracted from server.ts unchanged so that the L2 classifier can reuse the
 * same resilience path. server.ts starts a listener on import, so importing
 * from it would be circular and side-effectful.
 */

let aiClient: GoogleGenAI | null = null;

export function getAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in the environment.');
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

export const MODEL_FALLBACK_LADDER = [
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.7-flash',
];

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
  const ai = getAI();
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
      const status = err?.status || err?.statusCode || (err?.message?.includes('429') ? 429 : 500);
      const isRecoverable = [503, 429, 404, 500, 502, 504].includes(Number(status)) ||
        err?.message?.includes('overloaded') ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('UNAVAILABLE');

      console.warn(`[Gemini Fallback] Model ${modelName} failed (status: ${status}). Recoverable: ${isRecoverable}. Error: ${err?.message}`);

      if (!isRecoverable && MODEL_FALLBACK_LADDER.indexOf(modelName) === MODEL_FALLBACK_LADDER.length - 1) {
        throw err;
      }
    }
  }

  throw lastError || new Error('All Gemini fallback models exhausted.');
}
