import type { TurnMessage, TurnAttachment, TurnFinding } from '../types';
import type { ThreatEvent } from './agentApi';

/**
 * One chat turn, as a pure orchestration.
 *
 * This logic used to live inside JournalEditor's 1768-line closure, where it
 * could not be tested: the component has no test file, and the project's
 * render tests use renderToStaticMarkup, which cannot drive an interaction.
 * Two data-loss defects survived there as a direct result.
 *
 * **Directive 6, "never clear the user's input buffer before a confirmed
 * successful write."** The old code cleared the composer on the line before
 * the request. A failed send took the user's text with it. Here `clearInput`
 * is reachable from exactly one place: after `save` has resolved.
 *
 * **Directive 6, "never fail silently."** The old code wrapped the model call
 * and the Firestore write in one try/catch, so a failed SAVE was reported as
 * "Failed to send message to Gemini." — false, and the reply it discarded was
 * already on screen. A failure here carries the stage it happened in, because
 * "your message never sent" and "the reply arrived but is not saved" call for
 * different actions from the user.
 *
 * Dependencies are injected rather than imported so this can be tested with
 * no network, no Firestore and no DOM.
 */

export type TurnStage = 'send' | 'save' | 'aborted';

export interface TurnFailure {
  stage: TurnStage;
  message: string;
  /** The model replied and that reply is not persisted. Only ever true for 'save'. */
  replyAtRisk: boolean;
}

export interface ChatReply {
  reply: string;
  modelUsed?: string;
  timestamp: string;
  threatEvents: ThreatEvent[];
  turnTaint: boolean;
}

export interface RunTurnDeps {
  /**
   * The model call. Receives the transcript including the new user turn, and
   * an onDelta it may call as text arrives. A non-streaming send simply never
   * calls it.
   */
  send: (turns: TurnMessage[], onDelta: (text: string) => void) => Promise<ChatReply>;
  /** The write. Receives the transcript including the model's reply. */
  save: (turns: TurnMessage[]) => Promise<void>;
  /** Paints the transcript optimistically. Called on every change. */
  onTurns: (turns: TurnMessage[]) => void;
  /** Empties the composer. Callable ONLY after a confirmed write. */
  clearInput: () => void;
  /**
   * Called with the reply so far, as it streams. The turn it describes is
   * PROVISIONAL: it is not persisted and must be rendered as unfinished until
   * this function has stopped being called and runChatTurn has resolved
   * (Amendment L, INV-20).
   */
  onStreamingText?: (textSoFar: string) => void;
  /** True when the user pressed stop. Distinguished from a failure. */
  isAbort?: (err: unknown) => boolean;
  /** Injectable so tests are deterministic. */
  newId?: (role: 'user' | 'model' | 'perimeter') => string;
  nowIso?: () => string;
}

export interface RunTurnResult {
  turns: TurnMessage[];
  reply?: ChatReply;
  failure?: TurnFailure;
}

/**
 * Collision-free ids.
 *
 * `msg-${Date.now()}-u` collides whenever two messages land in the same
 * millisecond, and React keys that collide render the wrong message under the
 * wrong node. The "What's in it" button can fire immediately after a manual
 * send, so this is reachable rather than theoretical.
 */
export function defaultNewId(role: 'user' | 'model' | 'perimeter'): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `msg-${role}-${suffix}`;
}

const messageOf = (err: unknown, fallback: string): string => {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  return typeof m === 'string' && m.trim() ? m : fallback;
};

export interface TurnExtras {
  /** Shown inside the user's own message. */
  attachments?: TurnAttachment[];
  /**
   * Deterministic scan results for those attachments. Each becomes a
   * 'perimeter' message in the transcript, immediately, before the model has
   * been called — it needs no model and there is no reason to make the user
   * wait for one to be told what was found in their own document.
   */
  findings?: TurnFinding[];
}

export async function runChatTurn(
  text: string,
  priorTurns: TurnMessage[],
  deps: RunTurnDeps,
  extras: TurnExtras = {},
): Promise<RunTurnResult> {
  const newId = deps.newId ?? defaultNewId;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());

  const userTurn: TurnMessage = {
    id: newId('user'),
    role: 'user',
    text,
    timestamp: nowIso(),
    ...(extras.attachments?.length ? { attachments: extras.attachments } : {}),
  };

  const perimeterTurns: TurnMessage[] = (extras.findings ?? []).map((finding) => ({
    id: newId('perimeter'),
    role: 'perimeter' as const,
    text: '',
    timestamp: nowIso(),
    finding,
  }));

  const withUser = [...priorTurns, userTurn, ...perimeterTurns];
  deps.onTurns(withUser);

  let streamed = '';
  let reply: ChatReply;
  try {
    // The model never sees a 'perimeter' message. Those are our own text about
    // the conversation, not part of it, and feeding them back would let the
    // Planner reason about — or contradict — the deterministic scan.
    reply = await deps.send(withUser.filter((t) => t.role !== 'perimeter'), (delta) => {
      streamed += delta;
      deps.onStreamingText?.(streamed);
    });
  } catch (err) {
    if (deps.isAbort?.(err)) {
      // Stopping is not failing. The transcript returns to where it was, the
      // text stays in the composer, and nothing is written — a half-answer the
      // user cut off is not something to persist or apologise for.
      deps.onTurns(priorTurns);
      return {
        turns: priorTurns,
        failure: { stage: 'aborted', message: 'Stopped.', replyAtRisk: false },
      };
    }
    // The send failed, so the user turn never happened. Roll it back and leave
    // the text in the composer — that IS the retry affordance Directive 6
    // asks for, and it costs the user nothing to press send again.
    deps.onTurns(priorTurns);
    return {
      turns: priorTurns,
      failure: {
        stage: 'send',
        message: messageOf(err, 'Could not reach the assistant. Your message was not sent.'),
        replyAtRisk: false,
      },
    };
  }

  const finalTurns: TurnMessage[] = [
    ...withUser,
    {
      id: newId('model'),
      role: 'model',
      text: reply.reply,
      timestamp: reply.timestamp,
      modelUsed: reply.modelUsed,
    },
  ];
  deps.onTurns(finalTurns);

  try {
    await deps.save(finalTurns);
  } catch (err) {
    // The reply is real and on screen. Saying "failed to send" here would be
    // false, and clearing the composer would destroy the one copy of the
    // user's text that is not at risk.
    return {
      turns: finalTurns,
      reply,
      failure: {
        stage: 'save',
        message: messageOf(
          err,
          'The reply arrived but could not be saved. It will be lost if you leave this page.',
        ),
        replyAtRisk: true,
      },
    };
  }

  // The only path to here is a confirmed write.
  deps.clearInput();
  return { turns: finalTurns, reply };
}
