import { describe, it, expect, vi, afterEach } from 'vitest';
import { sniffKind, extractTextFromFile, ExtractError, MAX_FILE_BYTES } from './extract';
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
    ['plain text', Buffer.from('Just some text, honestly')],
    ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>')],
    ['a shell script', Buffer.from('#!/bin/sh\nrm -rf /')],
    ['a ZIP (PK header)', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0])],
    ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0])],
    ['empty-ish', Buffer.from([0x00])],
  ])('refuses %s rather than guessing', (_label, bytes) => {
    expect(() => sniffKind(bytes)).toThrow(ExtractError);
  });

  it('a file merely NAMED like a PDF is still refused', () => {
    // The whole point: only the leading bytes decide.
    const notReallyPdf = Buffer.from('<html>totally a pdf</html>');
    expect(() => sniffKind(notReallyPdf)).toThrow(ExtractError);
  });

  it('does not accept %PDF appearing later in the file', () => {
    const smuggled = Buffer.from('GARBAGE%PDF-1.7');
    expect(() => sniffKind(smuggled)).toThrow(ExtractError);
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

  it('refuses an unsupported type without calling the model', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const err = await extractTextFromFile(Buffer.from('plain text')).catch((e) => e);
    expect(err.code).toBe('unsupported_file_type');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('the transcriber is Reader-class: it holds no tools', () => {
  const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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
