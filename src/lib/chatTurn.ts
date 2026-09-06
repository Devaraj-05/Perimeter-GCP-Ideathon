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
 * the request and never put it back, so a failed send took the user's text
 * with it. Amendment R.1 keeps the guarantee and changes how it is met: the
 * composer is cleared at the echo, the submitted text is held here for the
 * life of the turn, and `restoreInput` puts it back verbatim on every path
 * that does not end in a confirmed write. The user cannot lose what they
 * typed, and they are no longer made to look at it for thirty seconds to
 * prove it.
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
  /**
   * Empties the composer.
   *
   * Amendment R.1. Called in the same tick as the echo, BEFORE the network,
   * so the composer behaves the way every chat interface behaves: what you
   * sent moves out of the box and into the transcript. Directive 6's guarantee
   * - the user never loses what they typed - is met by `restoreInput` below,
   * not by making them stare at their own text for the length of the turn.
   */
  clearInput: () => void;
  /**
   * Puts the submitted text back, verbatim - Amendment R.1.
   *
   * Called on every path where no reply was persisted: send failure, abort,
   * and a failed preparation step. This is what makes clearing safe, and it is
   * strictly stronger than the old retention: held text cannot be overwritten
   * by a second message typed during a slow turn, which the old behaviour lost
   * silently.
   */
  restoreInput?: (text: string) => void;
  /**
   * Work that must happen before the model call but AFTER the user's message
   * is on screen - fetching linked pages, pulling mail.
   *
   * It lives here rather than in the caller because anything awaited before
   * `runChatTurn` delays the echo, which is exactly the defect Amendment R.1
   * exists to fix: a mailbox read put thirty seconds between the user pressing
   * send and any evidence that they had.
   */
  prepare?: () => Promise<void>;
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

  // Amendment R.1. The echo and the clear happen together, before anything is
  // awaited, so pressing send has a visible effect in the same frame.
  deps.onTurns(withUser);
  deps.clearInput();

  /** The user's message stays; only its reply is marked missing (R.2). */
  const markUndelivered = (reason?: string): TurnMessage[] => {
    const kept = withUser.map((t) =>
      t.id === userTurn.id
        ? { ...t, undelivered: true, ...(reason ? { undeliveredReason: reason } : {}) }
        : t,
    );
    deps.onTurns(kept);
    deps.restoreInput?.(text);
    return kept;
  };

  // Preparation - links, mail - now runs with the message already on screen.
  if (deps.prepare) {
    try {
      await deps.prepare();
    } catch (err) {
      const message = messageOf(err, 'Could not prepare that message.');
      return {
        turns: markUndelivered(message),
        failure: { stage: 'send', message, replyAtRisk: false },
      };
    }
  }

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
    // Amendment R.2. Neither path rolls the transcript back any more.
    //
    // It used to return to `priorTurns`, which deleted the user's own message
    // and every deterministic finding shown beside it. The user watched their
    // question and several security messages appear and then vanish - which
    // reads as data loss, and destroys the evidence this product exists to
    // show. Only the reply failed, so only the reply is absent.
    if (deps.isAbort?.(err)) {
      // Stopping is not failing. Nothing is written - a half-answer the user
      // cut off is not something to persist or apologise for.
      return {
        turns: markUndelivered('You stopped this one.'),
        failure: { stage: 'aborted', message: 'Stopped.', replyAtRisk: false },
      };
    }
    const message = messageOf(err, 'Could not reach the assistant. Your message was not sent.');
    return {
      turns: markUndelivered(message),
      failure: { stage: 'send', message, replyAtRisk: false },
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

  // The composer was cleared at the echo (R.1) and the write has now confirmed,
  // so there is nothing left to clear and nothing to restore.
  return { turns: finalTurns, reply };
}
