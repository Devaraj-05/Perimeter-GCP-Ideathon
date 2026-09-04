import { ShieldAlert, ShieldCheck, X, EyeOff } from 'lucide-react';
import type { Match } from '../types';

/**
 * Evidence, not a verdict.
 *
 * This panel exists because the application could tell a user their document
 * was HOSTILE and could not show them one character of why. A red badge with
 * no quotation asks the user to take our word for it, which is the opposite of
 * what this application is for.
 *
 * Every string rendered here comes from a regex match offset in
 * server/detect.ts. No model wrote any of it, and that is deliberate: asking
 * the Reader to explain an attack would let a poisoned document compose our
 * security report about itself.
 *
 * On INV-9 and why excerpts are NOT passed through UntrustedText.
 *
 * UntrustedText is the right renderer for prose. It escapes, refuses to
 * linkify, and loads no remote resources. It also interprets `**bold**`,
 * `*italic*` and backtick code, which means it CONSUMES those characters. For
 * model output that is a feature; for a quotation offered as proof of an
 * attack it is a defect, because an attacker who wraps a payload in asterisks
 * would have them silently deleted from the evidence. A plain React text child
 * is escaped by React itself, interprets nothing, and is strictly more
 * faithful. InjectionReport.render.test.tsx renders this component and asserts
 * on the HTML a browser would actually receive — no img, no anchor, no href,
 * no script, whatever the excerpt contains.
 */

/** Plain-language reading of each signal. Fixed copy; no model writes this. */
const SIGNAL_COPY: Record<string, string> = {
  instruction_override: 'Tries to cancel the assistant’s existing instructions.',
  imperative_to_agent: 'Speaks to the AI rather than to you.',
  tool_invocation_request: 'Asks the assistant to call a tool.',
  concealment_request: 'Asks the assistant to hide something from you.',
  fake_system_role: 'Impersonates a system or developer message.',
  hidden_unicode: 'Invisible characters used to hide text.',
  bidi_override: 'Characters that reorder text on screen to disguise it.',
  html_comment: 'Text hidden in an HTML comment, invisible when the page renders.',
  oversized_base64: 'A long encoded blob, large enough to conceal a payload.',
  markdown_image_exfil: 'A markdown image whose URL could carry your data out.',
  offdomain_url: 'Links pointing somewhere other than this source’s own domain.',
};

export function InjectionReport({
  title,
  verdict,
  matches,
  onClose,
}: {
  title: string;
  verdict: 'clean' | 'suspicious' | 'hostile';
  matches: Match[];
  onClose: () => void;
}) {
  const found = matches.length;

  return (
    <div className="mt-3 rounded-xl border border-[#e5e0d3] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {found > 0 ? (
            <ShieldAlert
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                verdict === 'hostile' ? 'text-rose-600' : 'text-amber-600'
              }`}
            />
          ) : (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          )}
          <p className="text-sm font-medium text-[#2c2c24]">
            {found > 0
              ? `${found} injection attempt${found === 1 ? '' : 's'} in ${title}`
              : `No injection attempts found in ${title}`}
          </p>
        </div>
        <button
          onClick={onClose}
          title="Close"
          className="shrink-0 cursor-pointer opacity-60 hover:opacity-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {found === 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-[#5a5a40]">
          Every pattern was checked and none matched. Detection is not the boundary either way:
          this content was read by a model that holds no tools, so an instruction hidden in it
          would have had nothing to call.
        </p>
      )}

      {found > 0 && (
        <p className="mt-2 text-[11px] leading-relaxed text-[#5a5a40]">
          Quoted exactly as it appears in the content. Nothing here was written by a model.
          These attempts reached a model that holds no tools, so none of them could act.
        </p>
      )}

      <div className="mt-3 space-y-3">
        {matches.map((m, i) => (
          <div
            key={`${m.signal}-${m.start}-${i}`}
            className="rounded-lg border border-[#e5e0d3] bg-[#fbf9f2] p-3"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="rounded bg-[#2c2c24] px-1.5 py-0.5 font-mono text-[10px] text-white">
                {m.signal}
              </span>
              <span className="text-[11px] text-[#8a8a75]">line {m.line}</span>
              {m.hidden && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                  <EyeOff className="h-3 w-3" />
                  invisible &mdash; shown as code points
                </span>
              )}
            </div>

            <p className="mt-1 text-[11px] text-[#5a5a40]">
              {SIGNAL_COPY[m.signal] ?? m.signal}
            </p>

            {/*
              A plain text child. React escapes it, and nothing interprets it,
              so the quotation is byte-faithful to what the attacker wrote.
            */}
            <div className="mt-2 overflow-x-auto rounded border border-[#e5e0d3] bg-white p-2">
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#2c2c24]">
                {m.excerpt}
              </pre>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
