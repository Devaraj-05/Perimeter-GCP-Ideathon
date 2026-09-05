import React, { useState, memo } from 'react';
import { Copy, Check } from 'lucide-react';
import { UntrustedText } from './UntrustedText';
import type { TurnMessage } from '../types';

/**
 * The settled transcript — S5.
 *
 * Extracted from JournalEditor and memoised because it was re-rendering on
 * every keystroke and, once Amendment L landed, on every streamed token. The
 * composer's text and the in-flight reply are state on the same component
 * that renders every past turn, with no memoisation anywhere in 1790 lines,
 * so typing one character repainted the entire conversation.
 *
 * This renders only turns that are FINISHED. The provisional streaming turn
 * stays in JournalEditor: it changes many times a second by design, and
 * memoising something that always changes buys nothing.
 *
 * The copy handler is held here rather than passed in, so the props are
 * turns alone and the memo actually holds. A parent-owned callback would be
 * a new function identity on every render and would defeat it silently —
 * which is the usual way a memo boundary turns into decoration.
 */

interface Props {
  turns: TurnMessage[];
}

function TranscriptImpl({ turns }: Props) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <>
      {turns.map((turn, index) => {
                const isUser = turn.role === 'user';
                return (
                  <div
                    key={turn.id || index}
                    className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1 px-1 text-[11px] text-[#8a8a75]">
                      <span className="font-medium">
                        {isUser ? 'You' : `Gemini (${turn.modelUsed || 'gemini-3.6-flash'})`}
                      </span>
                      <span>&bull;</span>
                      <span>
                        {turn.timestamp
                          ? new Date(turn.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>

                    <div
                      className={`relative group max-w-[90%] sm:max-w-[82%] rounded-2xl p-4 text-sm leading-relaxed ${
                        isUser
                          ? 'bg-[#5a5a40] text-white rounded-br-xs shadow-xs'
                          : 'bg-[#f8f6f0] text-[#2c2c24] rounded-bl-xs border border-[#e5e0d3]'
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap font-sans">{turn.text}</p>
                      ) : (
                        // INV-9: assistant output is DERIVED from untrusted content.
                        // Rendered escaped, never as markdown - a markdown image
                        // tag would exfiltrate on paint, with no tool call needed.
                        <UntrustedText text={turn.text} />
                      )}

                      {/* Copy button */}
                      <button
                        type="button"
                        onClick={() => copyToClipboard(turn.text, turn.id)}
                        className={`absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer ${
                          isUser
                            ? 'text-stone-300 hover:bg-[#484833]'
                            : 'text-[#8a8a75] hover:bg-[#e5e0d3]'
                        }`}
                        title="Copy message text"
                      >
                        {copiedId === turn.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                );
                    })}
    </>
  );
}

/**
 * Turns are appended, never mutated, so reference equality on the array is a
 * correct and sufficient test.
 */
export const ChatTranscript = memo(TranscriptImpl, (a, b) => a.turns === b.turns);
