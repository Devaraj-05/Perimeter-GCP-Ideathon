import express, { Request, Response } from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { requireAuth, AuthedRequest } from './server/auth';
import { generateContentWithFallback } from './server/gemini';
import { ingestRouter } from './server/ingest';
import { agentRouter } from './server/agent';
import { internalRouter } from './server/internal';
import { secretStatus } from './server/secrets';

dotenv.config();

const app = express();
// Cloud Run injects PORT (8080) and probes it. Listening on a hardcoded port
// fails the startup health check.
const PORT = Number(process.env.PORT) || 3000;

// 1. Top-Level Request Deserialization (Ordering Guarantee)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Directive 6 (Defensive Payload Ingestion): a malformed body must produce a
// clean 400 in our JSON shape, not an unhandled parser exception and Express's
// default HTML error page.
app.use((err: any, _req: Request, res: Response, next: any) => {
  if (err && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Malformed JSON body.' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  return next(err);
});

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// Untrusted external content ingestion (Amendment A). Mounted after the body
// parsers above, per Directive 6 ordering guarantee.
app.use('/api/ingest', ingestRouter);

// Tool execution boundary (Amendment B). The model proposes here; the Policy
// Engine decides; only then does the executor act.
app.use('/api/agent', agentRouter);

// Scheduled ingestion (Amendment A.5). OIDC-only; never publicly invocable.
app.use('/internal', internalRouter);

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  // Constitution section 8: the health check touches no downstream service.
  // So this reports whether a key SOURCE is configured, never fetching one.
  //
  // aiConfigured previously tested process.env.GEMINI_API_KEY directly, which
  // became a lie the moment the key moved to Secret Manager - it reported
  // false on a perfectly healthy deployment. keySource stays null until the
  // first Gemini call resolves it, then names the path actually taken.
  const secret = secretStatus();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    aiConfigured: !!(process.env.GEMINI_KEY_SECRET || process.env.GEMINI_API_KEY),
    keySource: secret.via,
    keyResolved: secret.configured,
  });
});

// Reflect / Converse on Journal Entry
app.post('/api/gemini/reflect', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    const mode = typeof data.mode === 'string' ? data.mode : 'companion';
    const mood = typeof data.mood === 'string' ? data.mood : 'Neutral';
    const category = typeof data.category === 'string' ? data.category : 'General';
    const turns = Array.isArray(data.turns) ? data.turns : [];

    if (!content && turns.length === 0) {
      return res.status(400).json({ error: 'Journal content or message is required.' });
    }

    let systemInstruction = `You are a thoughtful, empathetic, and intellectually astute personal reflection partner and journal companion.
The user is writing in their private journal. 
Your goal is to provide a grounded, compassionate, and constructive response.
- Acknowledge emotions without being overly clinical or dismissive.
- Provide crisp, structured observations, highlighting hidden themes, cognitive shifts, or gentle reframing.
- Offer 2-3 engaging, open-ended reflection questions or actionable brainstorming ideas.
- Use clean Markdown formatting with clear headings, bullet points, and emphasis where helpful.`;

    if (mode === 'brainstorm') {
      systemInstruction += `\nMode: Brainstorming & Actionable Solutions. Focus on creative, structured ideas, pragmatic next steps, and divergent options.`;
    } else if (mode === 'socratic') {
      systemInstruction += `\nMode: Socratic Inquiry. Ask probing, thoughtful questions that challenge assumptions and invite deeper self-discovery.`;
    } else if (mode === 'gratitude_wellness') {
      systemInstruction += `\nMode: Gratitude & Mindfulness. Focus on grounding, celebration of micro-wins, self-compassion, and stress reduction.`;
    } else if (mode === 'executive_summary') {
      systemInstruction += `\nMode: Executive Synthesis. Provide a sharp, concise 2-sentence summary and 3 key takeaway bullet points.`;
    }

    // Build conversation context
    const contents: any[] = [];
    
    // Add context prelude
    let contextHeader = `[User Context: Mood: ${mood}, Category: ${category}, Mode: ${mode}]\n`;
    if (content) {
      contextHeader += `[Initial Journal Entry]:\n${content}\n\n`;
    }

    // Add multi-turn dialogue
    if (turns.length > 0) {
      for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        if (turn && turn.role && turn.text) {
          const role = turn.role === 'user' ? 'user' : 'model';
          const text = (i === 0 && content) ? `${contextHeader}${turn.text}` : turn.text;
          contents.push({
            role,
            parts: [{ text }],
          });
        }
      }
    } else {
      contents.push({
        role: 'user',
        parts: [{ text: `${contextHeader}${content}` }],
      });
    }

    const { text, modelUsed } = await generateContentWithFallback(contents, {
      systemInstruction,
      temperature: 0.75,
    });

    return res.json({
      reply: text,
      modelUsed,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in /api/gemini/reflect:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to generate reflection. Please try again.',
    });
  }
});

// Generate Summary & Key Takeaways for Journal Entry
app.post('/api/gemini/summarize', requireAuth, async (req: AuthedRequest, res: Response) => {
  try {
    const data = req.body && typeof req.body === 'object' ? req.body : {};
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    const turns = Array.isArray(data.turns) ? data.turns : [];

    if (!content && turns.length === 0) {
      return res.status(400).json({ error: 'Entry content is required for summarization.' });
    }

    const conversationHistory = turns.map((t: any) => `${t.role === 'user' ? 'User' : 'Gemini'}: ${t.text}`).join('\n');
    const fullText = `Main Entry:\n${content}\n\nConversation:\n${conversationHistory}`;

    const prompt = `Analyze this journal entry and reflection exchange. Output a JSON object matching this schema exactly:
{
  "title": "A concise, meaningful 3-6 word title capturing the essence",
  "summary": "A 2-sentence empathetic and crisp summary of the main topic and thoughts",
  "insights": ["Key takeaway or actionable insight 1", "Key takeaway 2", "Key takeaway 3"],
  "sentiment": "Positive" | "Reflective" | "Challenged" | "Grateful" | "Determined" | "Neutral",
  "tags": ["tag1", "tag2", "tag3"]
}

Entry text to analyze:
${fullText}

Return ONLY raw JSON, no markdown code block fences if possible.`;

    const { text, modelUsed } = await generateContentWithFallback(
      [{ role: 'user', parts: [{ text: prompt }] }],
      {
        systemInstruction: 'You are a precise data extractor that returns valid JSON only.',
        temperature: 0.3,
      }
    );

    // Clean JSON response if wrapped in ```json
    let cleanJson = text.trim();
    if (cleanJson.startsWith('```json')) {
      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    try {
      const parsed = JSON.parse(cleanJson);
      return res.json({
        ...parsed,
        modelUsed,
      });
    } catch {
      return res.json({
        title: content.slice(0, 30) + '...',
        summary: text.slice(0, 160),
        insights: ['Reflection completed.'],
        sentiment: 'Reflective',
        tags: ['Journal'],
        modelUsed,
      });
    }
  } catch (error: any) {
    console.error('Error in /api/gemini/summarize:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to synthesize entry summary.',
    });
  }
});

// -------------------------------------------------------------
// Vite Dev Server / Production Static Serving
// -------------------------------------------------------------
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ReflectAI Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
