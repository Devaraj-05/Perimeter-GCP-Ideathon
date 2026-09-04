import { Type, FunctionDeclaration, Schema } from '@google/genai';

/**
 * Static Tool Registry - Amendment B.2.
 *
 * A tool that is not in this manifest does not exist. The model can emit any
 * function name it likes; if it is not here, the Policy Engine denies it before
 * anything is looked up, so an invented tool name is a dead end rather than an
 * error path.
 *
 * This file is data, deliberately. It has no logic to get wrong.
 */

export type SideEffect = 'read' | 'write';

export interface ToolSpec {
  name: string;
  description: string;
  sideEffect: SideEffect;
  /** Max invocations per user per rolling window. */
  rateLimitPerHour: number;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export const TOOL_REGISTRY: Readonly<Record<string, ToolSpec>> = Object.freeze({
  search_artifacts: {
    name: 'search_artifacts',
    description:
      "Search the signed-in user's own ingested artifacts by keyword. Returns titles and sources.",
    sideEffect: 'read',
    rateLimitPerHour: 60,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for.' },
      },
      required: ['query'],
    },
  },

  summarise_source: {
    name: 'summarise_source',
    description:
      "Summarise the open issues currently ingested from one of the user's own sources.",
    sideEffect: 'read',
    rateLimitPerHour: 30,
    parameters: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'The id of a source the user owns.' },
      },
      required: ['sourceId'],
    },
  },

  send_digest: {
    name: 'send_digest',
    description:
      'Send a digest to a destination the user has previously authorised. Egress class.',
    // The only egress tool. INV-5 exists for this row.
    sideEffect: 'write',
    rateLimitPerHour: 5,
    parameters: {
      type: 'object',
      properties: {
        // NOTE what is absent: no URL, no email address, no webhook, no
        // recipient of any kind. The model names an opaque id and the server
        // resolves it against that user's own destinations. If the model
        // cannot express "send to attacker@example.com", an injection cannot
        // make it - the attack is structurally inexpressible rather than
        // detected and blocked.
        destinationId: {
          type: 'string',
          description: 'Id of a destination the user has already authorised.',
        },
        body: { type: 'string', description: 'The digest text to send.' },
      },
      required: ['destinationId', 'body'],
    },
  },

  create_note: {
    name: 'create_note',
    description: "Create a note in the user's private journal.",
    // Write-class, like send_digest above: both need a human click (S2).
    // What is specific to this row is that it writes into users/{uid}/entries,
    // the collection loadContext() treats as first-party — so its output is
    // marked createdBy: 'agent' and carries taint forward. See agent.ts.
    sideEffect: 'write',
    rateLimitPerHour: 20,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title for the note.' },
        body: { type: 'string', description: 'Body text of the note.' },
      },
      required: ['title', 'body'],
    },
  },
});

export const DEFAULT_ALLOWED_TOOLS: string[] = Object.keys(TOOL_REGISTRY);

export function getToolSpec(name: unknown): ToolSpec | null {
  if (typeof name !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(TOOL_REGISTRY, name)
    ? TOOL_REGISTRY[name]
    : null;
}

/** Maps the manifest's plain JSON-schema strings onto the SDK's Type enum. */
const TYPE_MAP: Record<string, Type> = {
  string: Type.STRING,
  number: Type.NUMBER,
  boolean: Type.BOOLEAN,
  object: Type.OBJECT,
  array: Type.ARRAY,
};

/**
 * Shape handed to Gemini as function declarations. The registry above stays
 * plain declarative data; the SDK-specific enum is applied only here.
 */
export function toFunctionDeclarations(): FunctionDeclaration[] {
  return Object.values(TOOL_REGISTRY).map((t) => {
    const properties: Record<string, Schema> = {};
    for (const [key, prop] of Object.entries(t.parameters.properties)) {
      properties[key] = {
        type: TYPE_MAP[prop.type] ?? Type.STRING,
        description: prop.description,
      };
    }
    return {
      name: t.name,
      description: t.description,
      parameters: {
        type: Type.OBJECT,
        properties,
        required: [...t.parameters.required],
      },
    };
  });
}
