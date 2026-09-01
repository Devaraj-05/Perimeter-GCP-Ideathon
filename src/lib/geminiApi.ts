import { ReflectionMode, MoodType, CategoryType, TurnMessage } from '../types';
import { auth } from './firebase';

/**
 * Every server route that spends Gemini quota is authenticated. Attach the
 * caller's Firebase ID token so the backend can verify it with the Admin SDK.
 */
async function authedHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You must be signed in to use Gemini.');
  }
  const token = await user.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function readError(res: Response): Promise<string> {
  const errData = await res.json().catch(() => ({} as any));
  if (res.status === 401) {
    return errData.error || 'Your session expired. Please sign in again.';
  }
  if (res.status === 429) {
    return errData.error || 'Rate limit reached. Please wait a moment and retry.';
  }
  return errData.error || `Server returned error (${res.status})`;
}

export interface ReflectResponse {
  reply: string;
  modelUsed: string;
  timestamp: string;
}

export interface SummarizeResponse {
  title: string;
  summary: string;
  insights: string[];
  sentiment?: string;
  tags?: string[];
  modelUsed?: string;
}

export async function requestReflection(params: {
  content: string;
  mode: ReflectionMode;
  mood: MoodType;
  category: CategoryType;
  turns: TurnMessage[];
}): Promise<ReflectResponse> {
  const res = await fetch('/api/gemini/reflect', {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  return res.json();
}

export async function requestSummary(params: {
  content: string;
  turns: TurnMessage[];
}): Promise<SummarizeResponse> {
  const res = await fetch('/api/gemini/summarize', {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    throw new Error(await readError(res));
  }

  return res.json();
}
