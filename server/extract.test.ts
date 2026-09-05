import { describe, it, expect, vi, afterEach } from 'vitest';
import { sniffKind, extractTextFromFile, looksLikeText, ExtractError, MAX_FILE_BYTES } from './extract';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Amendment G / INV-15.
 *
 * The security-critical part of file upload is not the transcription — it is
 * deciding WHAT a file is. A declared MIME type is attacker-controlled, so the
 * type must come from the bytes, and anything unrecognised must be refused
 * rather than guessed at.
 */

const pdf = (extra = '') => Buffer.from('%PDF-1.7\n' + extra, 'latin1');
const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const gif = () => Buffer.from('GIF89a' + '\0'.repeat(4), 'latin1');
const webp = () => Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);

afterEach(() => vi.unstubAllGlobals());

describe('type comes from the bytes, never from the caller', () => {
  it.each([
    ['pdf', pdf(), 'application/pdf'],
    ['png', png(), 'image/png'],
    ['jpeg', jpeg(), 'image/jpeg'],
    ['gif', gif(), 'image/gif'],
    ['webp', webp(), 'image/webp'],
  ])('identifies %s', (_label, bytes, mime) => {
    expect(sniffKind(bytes).mime).toBe(mime);
  });

  it('classifies PDFs and images into the right kind', () => {
    expect(sniffKind(pdf()).kind).toBe('pdf');
    expect(sniffKind(png()).kind).toBe('image');
  });

  it.each([
    ['a ZIP (PK header)', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])],
    ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0])],
    ['a NUL byte', Buffer.from([0x00])],
  ])('refuses %s — binary that is not a recognised type', (_label, bytes) => {
    expect(() => sniffKind(bytes)).toThrow(ExtractError);
  });

  it('classifies text as text, not as the type it may pretend to be', () => {
    // The security principle is unchanged: only the leading bytes decide a
    // BINARY type. What changed is the fallback for content matching no binary
    // signature — read as text now rather than refused, because text still
    // routes through the airlock like any other document.
    for (const t of [
      'Just some text, honestly',
      '<!doctype html><script>alert(1)</script>',
      '#!/bin/sh',
    ]) {
      expect(sniffKind(Buffer.from(t)).kind).toBe('text');
    }
  });

  it('an HTML file claiming to be a PDF is text, never a PDF', () => {
    // Content does not get to lie about its type. It is not a PDF; it is text.
    expect(sniffKind(Buffer.from('<html>totally a pdf</html>')).kind).toBe('text');
  });

  it('does not accept %PDF appearing later in the file as a PDF', () => {
    // Still not a PDF — the signature must lead. It is now read as text.
    expect(sniffKind(Buffer.from('GARBAGE%PDF-1.7')).kind).toBe('text');
  });
});

describe('size and emptiness are checked before any model call', () => {
  it('refuses an empty file without calling the model', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    await expect(extractTextFromFile(Buffer.alloc(0))).rejects.toThrow(ExtractError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses an oversized file without calling the model', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const huge = Buffer.concat([pdf(), Buffer.alloc(MAX_FILE_BYTES + 1)]);
    const err = await extractTextFromFile(huge).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractError);
    expect(err.code).toBe('file_too_large');
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses an unsupported binary type without calling the model', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    // Plain text would now be accepted, so the fixture has to be genuinely
    // binary — a NUL byte, no matching signature — to exercise the refusal.
    const err = await extractTextFromFile(Buffer.from([0x00, 0x01, 0x02, 0xff])).catch((e) => e);
    expect(err.code).toBe('unsupported_file_type');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the transcriber is Reader-class: it holds no tools', () => {
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const EXTRACT = strip(readFileSync(join(process.cwd(), 'server', 'extract.ts'), 'utf8'));
  const GEMINI = strip(readFileSync(join(process.cwd(), 'server', 'gemini.ts'), 'utf8'));

  it('extract.ts never declares tools', () => {
    // A document can make the transcription wrong. It must not be able to make
    // it privileged.
    expect(EXTRACT).not.toMatch(/\btools\b/);
    expect(EXTRACT).not.toMatch(/functionDeclarations/);
  });

  it('extract.ts goes through the shared fallback helper, not a raw model call', () => {
    // Directive 6: one helper, so resilience and the model ladder are uniform.
    expect(EXTRACT).toContain('generateContentWithFallback');
    expect(EXTRACT).not.toMatch(/ai\.models\.generateContent/);
  });

  it('the shared helper itself never sets a tools key', () => {
    // This is what makes every caller of it toolless by construction.
    expect(GEMINI).not.toMatch(/\btools\s*:/);
    expect(GEMINI).not.toMatch(/functionDeclarations/);
  });

  it('the transcription instruction tells the model it is transcribing, not obeying', () => {
    expect(EXTRACT).toMatch(/transcribing, not following/i);
  });
});

describe('plain text — the format a user pastes the contents of anyway', () => {
  const buf = (s: string) => Buffer.from(s, 'utf8');

  it('recognises text once the binary signatures have all missed', () => {
    expect(sniffKind(buf('# Notes\n\nordinary markdown')).kind).toBe('text');
    expect(sniffKind(buf('a,b,c\n1,2,3')).kind).toBe('text');
    expect(sniffKind(buf('{"k":"v"}')).kind).toBe('text');
  });

  it('reads text directly, with no model call', async () => {
    // The transcription path would need a mocked Gemini; this one must not
    // reach it at all. If it did, this test would throw trying to call the API.
    const out = await extractTextFromFile(buf('just some notes'));
    expect(out.kind).toBe('text');
    expect(out.text).toBe('just some notes');
  });

  it('still refuses a binary that is not a recognised type', () => {
    // The principle holds: unknown-and-binary is refused, not guessed. A NUL
    // byte is the tell.
    const binary = Buffer.from([0x01, 0x02, 0x00, 0x03, 0xff, 0xfe]);
    expect(looksLikeText(binary)).toBe(false);
    expect(() => sniffKind(binary)).toThrow(ExtractError);
  });

  it('refuses invalid UTF-8 rather than mangling it into text', () => {
    const invalid = Buffer.from([0xc3, 0x28, 0xa0, 0xa1]); // not valid UTF-8
    expect(looksLikeText(invalid)).toBe(false);
  });

  it('an all-whitespace text file is empty, not content', async () => {
    await expect(extractTextFromFile(buf('   \n\t  '))).rejects.toThrow(ExtractError);
  });

  it('a PDF is still a PDF, not text', () => {
    // The text branch is a fallback and must never shadow a real signature.
    expect(sniffKind(Buffer.from('%PDF-1.7 rest', 'latin1')).kind).toBe('pdf');
  });
});
