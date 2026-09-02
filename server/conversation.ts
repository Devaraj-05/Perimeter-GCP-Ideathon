/**
 * Multi-turn conversation assembly.
 *
 * Extracted from the /api/gemini/reflect route unchanged so the behaviour can
 * be tested. Multi-turn interaction is a graded Phase 2 requirement, and it
 * was previously only exercised by clicking the app — which means a refactor
 * could have quietly reduced it to single-shot and nothing would have failed.
 *
 * Pure: no I/O, no model call. Given a request shape it returns exactly what
 * would be sent.
 */

export interface TurnInput {
  role?: string;
  text?: string;
}

export interface ConversationInput {
  content: string;
  mode: string;
  mood: string;
  category: string;
  turns: TurnInput[];
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: { text: string }[];
}

const BASE_INSTRUCTION = `You are a thoughtful, empathetic, and intellectually astute personal reflection partner and journal companion.
The user is writing in their private journal.
Your goal is to provide a grounded, compassionate, and constructive response.
- Acknowledge emotions without being overly clinical or dismissive.
- Provide crisp, structured observations, highlighting hidden themes, cognitive shifts, or gentle reframing.
- Offer 2-3 engaging, open-ended reflection questions or actionable brainstorming ideas.
- Use clean Markdown formatting with clear headings, bullet points, and emphasis where helpful.`;

const MODE_INSTRUCTION: Record<string, string> = {
  brainstorm: `\nMode: Brainstorming & Actionable Solutions. Focus on creative, structured ideas, pragmatic next steps, and divergent options.`,
  socratic: `\nMode: Socratic Inquiry. Ask probing, thoughtful questions that challenge assumptions and invite deeper self-discovery.`,
  gratitude_wellness: `\nMode: Gratitude & Mindfulness. Focus on grounding, celebration of micro-wins, self-compassion, and stress reduction.`,
  executive_summary: `\nMode: Executive Synthesis. Provide a sharp, concise 2-sentence summary and 3 key takeaway bullet points.`,
};

export function buildSystemInstruction(mode: string): string {
  return BASE_INSTRUCTION + (MODE_INSTRUCTION[mode] ?? '');
}

/**
 * Builds the Gemini `contents` array for a reflection.
 *
 * The prior turns are replayed as alternating user/model messages rather than
 * flattened into one string, which is what makes this a conversation the model
 * can reason over instead of a transcript it reads.
 */
export function buildConversationContents(input: ConversationInput): GeminiContent[] {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  const turns = Array.isArray(input.turns) ? input.turns : [];

  let contextHeader = `[User Context: Mood: ${input.mood}, Category: ${input.category}, Mode: ${input.mode}]\n`;
  if (content) {
    contextHeader += `[Initial Journal Entry]:\n${content}\n\n`;
  }

  const contents: GeminiContent[] = [];

  if (turns.length > 0) {
    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (turn && turn.role && turn.text) {
        const role: 'user' | 'model' = turn.role === 'user' ? 'user' : 'model';
        // The context header rides on the first turn only; repeating it on
        // every turn would burn tokens and dilute the conversation.
        const text = i === 0 && content ? `${contextHeader}${turn.text}` : turn.text;
        contents.push({ role, parts: [{ text }] });
      }
    }
  } else {
    contents.push({ role: 'user', parts: [{ text: `${contextHeader}${content}` }] });
  }

  return contents;
}
