import { ReflectionMode, MoodType, CategoryType, TurnMessage } from '../types';

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server returned error (${res.status})`);
  }

  return res.json();
}

export async function requestSummary(params: {
  content: string;
  turns: TurnMessage[];
}): Promise<SummarizeResponse> {
  const res = await fetch('/api/gemini/summarize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Server returned error (${res.status})`);
  }

  return res.json();
}
