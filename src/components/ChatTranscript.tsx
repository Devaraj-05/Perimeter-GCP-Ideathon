import React, { useState, memo } from 'react';
import { Copy, Check, Paperclip, Link2, FileText, Github, ShieldAlert, ShieldCheck } from 'lucide-react';
import { UntrustedText } from './UntrustedText';
import { findingHeadline, findingFooter, describeSignal } from '../lib/findingMessage';
import type { TurnMessage, TurnAttachment, TurnFinding } from '../types';

const ATTACHMENT_ICON = {
  file: FileText,
  link: Link2,
  note: Paperclip,
  repo: Github,
} as const;

/**
 * What the user attached, shown inside their own message.
 *
 * No verdict here. A verdict on the user's own bubble, before they have asked
 * anything, is the application talking over them — and it appeared for every
 * upload whether or not they wanted it.
 */
function Attachments({ items }: { items: TurnAttachment[] }) {
  return (
    <div className="mb-2 flex flex-wrap justify-end gap-1.5">
      {items.map((a) => {
        const Icon = ATTACHMENT_ICON[a.kind] ?? Paperclip;
        return (
          <span
            key={a.id}
            className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#6b6b52] bg-[#4a4a38] px-2 py-1 text-[11px] text-stone-200"
          >
            <Icon className="h-3 w-3 shrink-0" />
            <span className="truncate">{a.title}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * A finding, in the conversation — not a panel beside it.
 *
 * Every word of the framing comes from src/lib/findingMessage.ts. The excerpts
 * are attacker text and are rendered as PLAIN CHILDREN, not through the
 * markdown subset: React escapes them, and nothing reinterprets a document's
 * own characters while quoting that document back.
 */
function Finding({ finding }: { finding: TurnFinding }) {
  const hostile = finding.matches.length > 0;
  const Icon = hostile ? ShieldAlert : ShieldCheck;

  return (
    <div className="max-w-[90%] text-sm leading-relaxed text-[#2c2c24] sm:max-w-[82%]">
      <p className="flex items-start gap-2">
        <Icon
          className={`mt-0.5 h-4 w-4 shrink-0 ${hostile ? 'text-rose-600' : 'text-emerald-600'}`}
        />
        <span>{findingHeadline(finding)}</span>
      </p>

      {finding.matches.map((m, i) => (
        <div key={i} className="mt-2 ml-6 border-l-2 border-rose-300 pl-3">
          <p className="text-[11px] text-[#8a8a75]">
            line {m.line} &middot; {describeSignal(m.signal)}
            {m.hidden && <span className="ml-1 text-amber-700">not visible when rendered</span>}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs text-[#2c2c24]">
            {m.excerpt}
          </p>
        </div>
      ))}

      {findingFooter(finding) && (
        <p className="mt-2.5 ml-6 text-[11px] text-[#5a5a40]">{findingFooter(finding)}</p>
      )}
    </div>
  );
}

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

                // A finding is a message, not a panel. It sits in the flow
                // like any other turn and is labelled Perimeter, because a
                // reader has to be able to tell which sentences the
                // application stands behind and which a model produced from
                // attacker-influenced input.
                if (turn.role === 'perimeter' && turn.finding) {
                  return (
                    <div key={turn.id || index} className="flex flex-col items-start">
                      <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-[#8a8a75]">
                        <span className="font-medium text-[#5a5a40]">Perimeter</span>
                        <span>&bull;</span>
                        <span>deterministic scan, no model</span>
                      </div>
                      <Finding finding={turn.finding} />
                    </div>
                  );
                }

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

                    {turn.attachments && turn.attachments.length > 0 && (
                      <Attachments items={turn.attachments} />
                    )}

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
