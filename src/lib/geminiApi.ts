import { ReflectionMode, MoodType, CategoryType, TurnMessage } from '../types';
import { authedHeaders, readError } from './apiClient';

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
