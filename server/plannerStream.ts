/**
 * Consuming the fallback ladder as a stream — Amendment L, INV-20.
 *
 * §6 mandates a fallback ladder. Streaming complicates it in one specific way:
 * once a token has been written to the response it cannot be withdrawn, so a
 * failure partway through cannot fall through to the next model without
 * showing the user two different answers stitched together.
 *
 * The rule, stated in Amendment L and enforced here: an attempt is COMMITTED
 * the moment its first chunk arrives. Before that point a failure walks the
 * ladder normally. After it, a failure ends the turn — no further model is
 * tried and nothing further is emitted.
 *
 * This module holds no model client. It takes a factory that opens a stream,
 * so the commit rule can be tested against fake streams with no network and no
 * API key — which is the only way it would ever be tested at all.
 */

export interface StreamChunk {
  text?: string;
  functionCalls?: Array<{ name?: string; args?: unknown }>;
}

/**
 * Shaped to match what a non-streaming response gives the broker, because the
 * tool loop must not know or care which path produced it. extractProposals
 * reads `functionCalls`; the handler reads `text`.
 */
export interface AggregatedResponse {
  text: string;
  functionCalls: Array<{ name?: string; args?: unknown }>;
}

export class LadderExhausted extends Error {
  constructor(readonly lastError: unknown) {
    super('All Gemini fallback models exhausted.');
    this.name = 'LadderExhausted';
  }
}

export interface ConsumeOptions<M extends string> {
  models: readonly M[];
  /** Opens a stream for one model. Throwing here counts as that model failing. */
  open: (model: M) => Promise<AsyncIterable<StreamChunk>>;
  /** Called for each non-empty text fragment, in order. Never before commit. */
  onDelta: (text: string) => void;
  /** Recoverable failures walk the ladder; everything else stops it. */
  isRecoverable: (err: unknown) => boolean;
  /** Errors that must never be retried or swallowed, whatever else is true. */
  isFatal?: (err: unknown) => boolean;
  onModelFailure?: (model: M, err: unknown) => void;
}

export async function consumeLadder<M extends string>(
  opts: ConsumeOptions<M>,
): Promise<{ response: AggregatedResponse; modelUsed: M }> {
  let lastError: unknown = null;

  for (const model of opts.models) {
    let iterator: AsyncIterator<StreamChunk>;
    let first: IteratorResult<StreamChunk>;

    // --- Uncommitted. A failure here is ordinary and walks the ladder. ---
    try {
      const stream = await opts.open(model);
      iterator = stream[Symbol.asyncIterator]();
      first = await iterator.next();
    } catch (err) {
      if (opts.isFatal?.(err)) throw err;
      lastError = err;
      opts.onModelFailure?.(model, err);
      if (!opts.isRecoverable(err)) throw err;
      continue;
    }

    // --- Committed. Nothing below may fall back to another model. ---
    const parts: string[] = [];
    const functionCalls: Array<{ name?: string; args?: unknown }> = [];

    const take = (chunk: StreamChunk | undefined) => {
      if (!chunk) return;
      if (typeof chunk.text === 'string' && chunk.text.length > 0) {
        parts.push(chunk.text);
        opts.onDelta(chunk.text);
      }
      if (Array.isArray(chunk.functionCalls)) functionCalls.push(...chunk.functionCalls);
    };

    let cursor = first;
    while (!cursor.done) {
      take(cursor.value);
      cursor = await iterator.next();
    }
    // A final value can ride along with done === true.
    take(cursor.value as StreamChunk | undefined);

    return { response: { text: parts.join(''), functionCalls }, modelUsed: model };
  }

  throw new LadderExhausted(lastError);
}
