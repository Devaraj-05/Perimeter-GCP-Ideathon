import { requestReflection, requestReflectionStream } from './geminiApi';
import { agentChat, agentChatStream, ThreatEvent } from './agentApi';
import { ReflectionMode, CategoryType, TurnMessage } from '../types';
import type { ChatStreamHandlers } from './chatStream';

/**
 * Chooses how a journal reflection is answered.
 *
 * With no connected sources there is no external content, so the plain
 * reflection endpoint is used and no tools are bound - nothing to defend
 * against, and no reason to pay for the machinery.
 *
 * Once the user connects a source, reflections route through the agent
 * runtime instead: the assistant can ground its answer in real project
 * context, and every safeguard engages automatically. The user never chooses
 * between "safe mode" and "useful mode", because that is not a choice anyone
 * should be asked to make.
 */

const MODE_GUIDANCE: Record<ReflectionMode, string> = {
  companion: 'Respond as a warm, attentive journalling companion.',
  brainstorm: 'Respond by expanding on ideas and offering new angles.',
  socratic: 'Respond with probing questions that deepen the reflection.',
  gratitude_wellness: 'Respond with a focus on gratitude and wellbeing.',
  executive_summary: 'Respond with a crisp, structured executive summary.',
};

export interface ReflectParams {
  content: string;
  mode: ReflectionMode;
  category: CategoryType;
  turns: TurnMessage[];
  /** Artifact ids to ground this reflection in. Empty = ungrounded. */
  groundingArtifactIds: string[];
}

export interface ReflectResult {
  reply: string;
  modelUsed: string;
  timestamp: string;
  /** True when connected sources contributed to the answer. */
  grounded: boolean;
  /** Policy decisions triggered by this turn. Empty on the ungrounded path. */
  threatEvents: ThreatEvent[];
  /** True when untrusted, non-clean content was in context. */
  turnTaint: boolean;
}

/** Builds the message sent to the agent runtime, carrying the mode intent. */
function composeMessage(params: ReflectParams): string {
  const recent = params.turns
    .slice(-6)
    .map((t) => `${t.role === 'user' ? 'Me' : 'You'}: ${t.text}`)
    .join('\n');

  return [
    MODE_GUIDANCE[params.mode] ?? MODE_GUIDANCE.companion,
    `The entry is filed under ${params.category}.`,
    '',
    recent ? `Conversation so far:\n${recent}` : '',
    '',
    params.content ? `Current entry:\n${params.content}` : 'Reflect on the conversation so far.',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function reflectGrounded(params: ReflectParams): Promise<ReflectResult> {
  const ids = params.groundingArtifactIds;

  if (!ids || ids.length === 0) {
    const r = await requestReflection({
      content: params.content,
      mode: params.mode,
      category: params.category,
      turns: params.turns,
    });
    return {
      reply: r.reply,
      modelUsed: r.modelUsed,
      timestamp: r.timestamp,
      grounded: false,
      threatEvents: [],
      turnTaint: false,
    };
  }

  const r = await agentChat(composeMessage(params), ids);
  return {
    reply: r.reply,
    modelUsed: r.modelUsed,
    timestamp: new Date().toISOString(),
    grounded: true,
    threatEvents: r.threatEvents ?? [],
    turnTaint: r.turnTaint === true,
  };
}


/**
 * The streaming twin of reflectGrounded — Amendment L.
 *
 * Routes exactly as the non-streaming one does, for the same reason: with no
 * connected sources there is no external content and no tools are bound, so
 * the plain reflection endpoint answers. The caller cannot tell the two apart
 * beyond the threatEvents being empty, which was already true.
 */
export async function reflectGroundedStream(
  params: ReflectParams,
  handlers: ChatStreamHandlers = {},
): Promise<ReflectResult> {
  const ids = params.groundingArtifactIds;

  if (!ids || ids.length === 0) {
    const r = await requestReflectionStream(
      {
        content: params.content,
        mode: params.mode,
        category: params.category,
        turns: params.turns,
      },
      handlers,
    );
    return {
      reply: r.reply,
      modelUsed: r.modelUsed,
      timestamp: r.timestamp ?? new Date().toISOString(),
      grounded: false,
      threatEvents: [],
      turnTaint: false,
    };
  }

  const r = await agentChatStream(composeMessage(params), ids, handlers);
  return {
    reply: r.reply,
    modelUsed: r.modelUsed,
    timestamp: new Date().toISOString(),
    grounded: true,
    threatEvents: r.threatEvents ?? [],
    turnTaint: r.turnTaint === true,
  };
}
