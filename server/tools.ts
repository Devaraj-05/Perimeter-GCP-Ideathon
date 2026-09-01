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

  create_note: {
    name: 'create_note',
    description: "Create a note in the user's private journal.",
    // The only write-class tool. Everything about B.3 exists for this row.
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
