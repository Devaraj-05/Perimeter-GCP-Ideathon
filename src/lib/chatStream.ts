import { authedHeaders } from './apiClient';
import type { ThreatEvent } from './agentApi';

/**
 * The NDJSON chat reader — Amendment L, INV-20.
 *
 * One implementation, used by both routes that stream a reply. Two copies of
 * a wire-format parser is how the archive and per-blob scan paths drifted in
 * server/reposcan.ts, and the same shape of bug here would mean one route
 * enforcing the verdict-before-text ordering and the other not.
 *
 * NDJSON over POST rather than SSE: EventSource cannot set an Authorization
 * header, and INV-3 requires a verified token on every request.
 */

export interface ChatStreamResult {
  reply: string;
  modelUsed: string;
  turnTaint: boolean;
  threatEvents: ThreatEvent[];
  contextIds: string[];
  timestamp?: string;
}

export interface ChatStreamHandlers {
  /** The taint verdict. Always delivered before the first delta. */
  onMeta?: (meta: { turnTaint: boolean; contextIds: string[] }) => void;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

export class ChatAborted extends Error {
  constructor() {
    super('Stopped.');
    this.name = 'ChatAborted';
  }
}

/** Parses one NDJSON line. Exported so the ordering rule can be tested. */
export function makeStreamReducer(handlers: ChatStreamHandlers) {
  let sawMeta = false;
  let final: ChatStreamResult | null = null;

  return {
    push(event: any) {
      if (!event || typeof event !== 'object') return;

      if (event.type === 'meta') {
        sawMeta = true;
        handlers.onMeta?.({
          turnTaint: event.turnTaint === true,
          contextIds: Array.isArray(event.contextIds) ? event.contextIds : [],
        });
        return;
      }

      if (event.type === 'delta') {
        // INV-20, enforced at the receiving end as well as the sending one. A
        // server that emitted text before its verdict would be a defect worth
        // failing loudly on, not one to paint anyway.
        if (!sawMeta) throw new Error('The assistant sent text before its safety verdict.');
        if (typeof event.text === 'string' && event.text) handlers.onDelta?.(event.text);
        return;
      }

      if (event.type === 'final') {
        final = {
          reply: typeof event.reply === 'string' ? event.reply : '',
          modelUsed: typeof event.modelUsed === 'string' ? event.modelUsed : '',
          turnTaint: event.turnTaint === true,
          threatEvents: Array.isArray(event.threatEvents) ? event.threatEvents : [],
          contextIds: Array.isArray(event.contextIds) ? event.contextIds : [],
          timestamp: typeof event.timestamp === 'string' ? event.timestamp : undefined,
        };
        return;
      }

      if (event.type === 'error') {
        throw new Error(event.error || 'The assistant stopped partway through this reply.');
      }
    },
    result: () => final,
  };
}

export async function postChatStream(
  url: string,
  body: unknown,
  handlers: ChatStreamHandlers = {},
): Promise<ChatStreamResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers: await authedHeaders(),
    body: JSON.stringify(body),
    signal: handlers.signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.error ?? 'The assistant could not be reached.');
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('The assistant could not be reached.');

  const decoder = new TextDecoder();
  const reducer = makeStreamReducer(handlers);
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Keep the trailing fragment: a chunk boundary can fall mid-line.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          // A malformed line is dropped rather than ending the turn: the
          // stream is still coherent and the 'final' record is what decides
          // whether this succeeded.
          continue;
        }
        reducer.push(event);
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError' || handlers.signal?.aborted) throw new ChatAborted();
    throw err;
  }

  const final = reducer.result();
  if (!final) throw new Error('The assistant stopped before finishing. Nothing was saved.');
  return final;
}
