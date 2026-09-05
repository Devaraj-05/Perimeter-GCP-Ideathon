import { ReflectionMode, CategoryType, TurnMessage } from '../types';
import { authedHeaders, readError } from './apiClient';
import { postChatStream, type ChatStreamHandlers } from './chatStream';

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

/** The streaming twin. Same route, same shape, one extra flag. */
export async function requestReflectionStream(
  params: {
    content: string;
    mode: ReflectionMode;
    category: CategoryType;
    turns: TurnMessage[];
  },
  handlers: ChatStreamHandlers = {},
) {
  return postChatStream('/api/gemini/reflect', { ...params, stream: true }, handlers);
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
