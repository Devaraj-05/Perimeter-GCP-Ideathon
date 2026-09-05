import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { syntaxOf, indexContainment, containmentAt, type Syntax } from './containment';

/**
 * Grammar tests. Deliberately no security vocabulary except in the golden
 * fixture at the end — this module knows nothing about attacks, and its tests
 * should read like tests for a markdown parser.
 */

const at = (text: string, syntax: Syntax, needle: string) => {
  const start = text.indexOf(needle);
  expect(start, `needle not found: ${needle}`).toBeGreaterThanOrEqual(0);
  return containmentAt(indexContainment(text, syntax), start, start + needle.length);
};

describe('syntaxOf', () => {
  it('maps by extension', () => {
    expect(syntaxOf('docs/a.md')).toBe('markdown');
    expect(syntaxOf('server/a.ts')).toBe('c_like');
    expect(syntaxOf('x/y.py')).toBe('python');
    expect(syntaxOf('ci/deploy.yml')).toBe('hash');
  });

  it('maps extensionless agent files as markdown', () => {
    for (const p of ['README', 'AGENTS.md', 'CLAUDE.md', '.cursorrules', 'pkg/.windsurfrules']) {
      expect(syntaxOf(p), p).toBe('markdown');
    }
  });

  it('leaves json as plain, on purpose', () => {
    // .mcp.json and devcontainer.json are consumed verbatim by agents, so
    // treating their string values as containment would demote a real surface.
    expect(syntaxOf('.mcp.json')).toBe('plain');
    expect(syntaxOf('package.json')).toBe('plain');
  });

  it('falls back to plain for anything unknown', () => {
    expect(syntaxOf('a.sql')).toBe('plain');
    expect(syntaxOf('noextension')).toBe('plain');
  });
});

describe('markdown fences', () => {
  it('contains text inside a fence', () => {
    expect(at('before\n```\npayload here\n```\nafter', 'markdown', 'payload here')).toBe(
      'fenced_code',
    );
  });

  it('leaves text outside a fence alone', () => {
    expect(at('```\ninside\n```\noutside here', 'markdown', 'outside here')).toBe('none');
  });

  it('requires the closer to be at least as long as the opener', () => {
    // ```` opens a block that ``` does not close. A naive /^```/ closer ends
    // the block early and un-quotes everything after it.
    const text = '````\nstill inside\n```\nalso inside\n````\nout';
    expect(at(text, 'markdown', 'still inside')).toBe('fenced_code');
    expect(at(text, 'markdown', 'also inside')).toBe('fenced_code');
    expect(at(text, 'markdown', 'out')).toBe('none');
  });

  it('does not let a tilde fence close a backtick fence', () => {
    const text = '```\ninside\n~~~\nstill inside\n```\nout';
    expect(at(text, 'markdown', 'still inside')).toBe('fenced_code');
  });

  it('covers the newline that ends the opening line', () => {
    // FAKE_SYSTEM_ROLE matches /(^|\n)\s*…/, so its start offset points at the
    // newline BEFORE the label. A region beginning at the first content
    // character reports `none` for every fenced SYSTEM: in the repository.
    const text = 'prose\n```\nSYSTEM: do a thing\n```\n';
    const start = text.indexOf('\nSYSTEM');
    const index = indexContainment(text, 'markdown');
    expect(containmentAt(index, start, start + '\nSYSTEM:'.length)).toBe('fenced_code');
  });

  it('discards an unterminated fence rather than trusting it', () => {
    // Open ``` on line 1 of AGENTS.md, payload on line 2, never close. A
    // scanner that runs the fence to EOF marks the whole file quoted and the
    // injection vanishes.
    const text = '```\npayload here\nand more\n';
    const index = indexContainment(text, 'markdown');
    expect(index.unterminated).toBe(true);
    expect(at(text, 'markdown', 'payload here')).toBe('none');
  });

  it('handles CRLF line endings', () => {
    const text = 'a\r\n```\r\ninside\r\n```\r\nb';
    expect(at(text, 'markdown', 'inside')).toBe('fenced_code');
  });
});

describe('markdown blockquotes and inline spans', () => {
  it('contains a blockquote line', () => {
    expect(at('text\n> quoted words\nmore', 'markdown', 'quoted words')).toBe('blockquote');
  });

  it('does not treat a shell prompt inside a fence as a blockquote', () => {
    const text = '```bash\n> cat file\n```\n';
    expect(at(text, 'markdown', '> cat file')).toBe('fenced_code');
  });

  it('contains an inline code span', () => {
    expect(at('use `the thing` now', 'markdown', 'the thing')).toBe('inline_code');
  });

  it('confines an inline span to one line', () => {
    // One stray backtick must not pair with another 400 lines later.
    expect(at('a ` stray\nb later ` c', 'markdown', 'later')).toBe('none');
  });

  it('does not pair a backtick inside a fence with one outside', () => {
    const text = '```\nhas ` inside\n```\nplain text here';
    expect(at(text, 'markdown', 'plain text here')).toBe('none');
  });

  it('contains a short quoted span', () => {
    expect(at('prose saying "a quoted phrase" inline', 'markdown', 'a quoted phrase')).toBe(
      'quoted_span',
    );
  });

  it('does not treat a very long quotation as a span', () => {
    const long = 'x'.repeat(400);
    expect(at(`prose "${long}" end`, 'markdown', long)).toBe('none');
  });
});

describe('c_like source', () => {
  it('contains a single-quoted string', () => {
    expect(at("const a = 'the value';", 'c_like', 'the value')).toBe('code_string');
  });

  it('contains a template literal', () => {
    expect(at('const a = `the value`;', 'c_like', 'the value')).toBe('code_string');
  });

  it('contains a line comment', () => {
    expect(at('code();\n// the note\nmore();', 'c_like', 'the note')).toBe('code_comment');
  });

  it('contains a block comment', () => {
    expect(at('/* the note */\ncode();', 'c_like', 'the note')).toBe('code_comment');
  });

  it('does not let an apostrophe in a comment open a string', () => {
    // The classic failure: `// don't do this` opens a ' string that runs to
    // the next apostrophe several functions away.
    const text = "// don't do this\nconst live = notAString;\n";
    expect(at(text, 'c_like', 'notAString')).toBe('none');
  });

  it('models a regex literal containing quotes', () => {
    // server/detect.ts has `don'?t` inside a regex literal. Without this the
    // apostrophe desyncs the scanner and every later offset is wrong.
    const text = "const R = /\\b(do not|don'?t|never)\\b/i;\nconst live = notAString;\n";
    expect(at(text, 'c_like', "don'?t")).toBe('code_string');
    expect(at(text, 'c_like', 'notAString')).toBe('none');
  });

  it('treats division as division, not as a regex opener', () => {
    const text = 'const x = a / b;\nconst live = notAString;\n';
    expect(at(text, 'c_like', 'notAString')).toBe('none');
  });

  it('handles an escaped backslash before a closing quote', () => {
    const text = 'const p = "a\\\\";\nconst live = notAString;\n';
    expect(at(text, 'c_like', 'notAString')).toBe('none');
  });

  it('reports an unterminated string rather than swallowing the file', () => {
    const index = indexContainment('const a = "never closed;\n', 'c_like');
    expect(index.unterminated).toBe(true);
  });
});

describe('python and hash', () => {
  it('contains a triple-quoted docstring', () => {
    expect(at('def f():\n    """the doc"""\n', 'python', 'the doc')).toBe('code_string');
  });

  it('contains a hash comment', () => {
    expect(at('run\n# the note\nmore', 'hash', 'the note')).toBe('code_comment');
  });
});

describe('span semantics and stability', () => {
  it('a straddling match is not contained', () => {
    // HTML_COMMENT and OVERSIZED_BASE64 can cross a fence edge. Treating a
    // straddle as contained would hide the half that escaped.
    const text = 'a\n```\ninside\n```\noutside';
    const index = indexContainment(text, 'markdown');
    const start = text.indexOf('inside');
    expect(containmentAt(index, start, text.length)).toBe('none');
  });

  it('handles empty and single-character input', () => {
    expect(indexContainment('', 'markdown').regions).toEqual([]);
    expect(containmentAt(indexContainment('', 'markdown'), 0, 0)).toBe('none');
    expect(containmentAt(indexContainment('a', 'c_like'), 0, 1)).toBe('none');
  });

  it('is idempotent across calls', () => {
    // detect.ts already carries a lastIndex bug class that bit this project
    // once. No module-level mutable regex here; two calls agree exactly.
    const text = 'a `b` c\n```\nd\n```\n';
    expect(indexContainment(text, 'markdown')).toEqual(indexContainment(text, 'markdown'));
  });

  it('plain syntax produces no regions, so everything over-reports', () => {
    expect(indexContainment('anything "quoted" here', 'plain').regions).toEqual([]);
  });
});

describe('golden fixture — this project detector reads as quoted', () => {
  /**
   * The regression guard for the regex-literal case. server/detect.ts contains
   * the injection patterns themselves, as regex literals with apostrophes in
   * them. If the c_like scanner desyncs, those patterns read as unquoted source
   * and our own detector is reported as a live finding.
   */
  it('the detection patterns in detect.ts are inside string regions', () => {
    const path = join(process.cwd(), 'server', 'detect.ts');
    const text = readFileSync(path, 'utf8');
    const index = indexContainment(text, 'c_like');

    for (const needle of ['ignore|disregard|forget', 'mention|tell|reveal', 'system|admin|developer|root']) {
      const start = text.indexOf(needle);
      expect(start, needle).toBeGreaterThanOrEqual(0);
      expect(containmentAt(index, start, start + needle.length), needle).toBe('code_string');
    }
  });
});
