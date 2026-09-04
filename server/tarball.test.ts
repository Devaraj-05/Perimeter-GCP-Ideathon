import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import { readTarGz, stripRoot } from './tarball';

/**
 * The tar reader, tested against archives built here rather than a fixture
 * file, so every case says what it is testing in the test itself.
 *
 * The archive is attacker-influenceable content — anyone can put anything in a
 * public repository — so the cases that matter are the hostile ones: a header
 * claiming a size larger than the data, a file that would blow the memory cap,
 * a symlink asking to be followed.
 */

const BLOCK = 512;

function header(name: string, size: number, typeflag = '0'): Buffer {
  const h = Buffer.alloc(BLOCK, 0);
  h.write(name.slice(0, 100), 0, 'utf8');
  h.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  h.write(typeflag, 156, 'ascii');
  return h;
}

function file(name: string, body: string, typeflag = '0'): Buffer {
  const data = Buffer.from(body, 'utf8');
  const padding = Buffer.alloc((BLOCK - (data.length % BLOCK)) % BLOCK, 0);
  return Buffer.concat([header(name, data.length, typeflag), data, padding]);
}

const archive = (...parts: Buffer[]) =>
  gzipSync(Buffer.concat([...parts, Buffer.alloc(BLOCK * 2, 0)]));

const BIG = 1_000_000;

describe('stripRoot', () => {
  it('removes the single wrapper directory GitHub adds', () => {
    expect(stripRoot('owner-repo-a1b2c3d/README.md')).toBe('README.md');
    expect(stripRoot('owner-repo-a1b2c3d/src/deep/file.ts')).toBe('src/deep/file.ts');
  });

  it('leaves a path with no directory alone', () => {
    expect(stripRoot('README.md')).toBe('README.md');
  });
});

describe('readTarGz', () => {
  it('reads files and their contents', () => {
    const { entries } = readTarGz(
      archive(file('root/a.md', 'hello'), file('root/b/c.ts', 'world')),
      BIG,
      BIG,
    );
    expect(entries.map((e) => e.path)).toEqual(['a.md', 'b/c.ts']);
    expect(entries[0].text).toBe('hello');
    expect(entries[1].text).toBe('world');
  });

  it('reports byte counts from the data, not the header', () => {
    const { entries } = readTarGz(archive(file('root/a.md', 'hello')), BIG, BIG);
    expect(entries[0].bytes).toBe(5);
  });

  it('skips directories', () => {
    const { entries } = readTarGz(
      archive(file('root/dir', '', '5'), file('root/a.md', 'x')),
      BIG,
      BIG,
    );
    expect(entries.map((e) => e.path)).toEqual(['a.md']);
  });

  it('skips symlinks rather than following them', () => {
    // A symlink in an archive is a request to read somewhere else. This
    // reader does not take requests, and never touches the filesystem at all.
    const { entries } = readTarGz(
      archive(file('root/link', '/etc/passwd', '2'), file('root/a.md', 'x')),
      BIG,
      BIG,
    );
    expect(entries.map((e) => e.path)).toEqual(['a.md']);
  });

  it('stops at the total cap and says it was truncated', () => {
    const { entries, truncated } = readTarGz(
      archive(file('root/a.md', 'x'.repeat(600)), file('root/b.md', 'y'.repeat(600))),
      1000,
      BIG,
    );
    expect(entries).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it('skips a file over the per-entry cap instead of truncating it', () => {
    // Half a file produces half the findings, which is worse than none: the
    // report would claim the file was read.
    const { entries, truncated } = readTarGz(
      archive(file('root/big.md', 'x'.repeat(4000)), file('root/small.md', 'ok')),
      BIG,
      1000,
    );
    expect(entries.map((e) => e.path)).toEqual(['small.md']);
    expect(truncated).toBe(true);
  });

  it('stops on a header claiming more data than the archive holds', () => {
    // A size field is attacker-controlled. Trusting it would read past the
    // buffer or seek to an offset that is not there.
    const lying = Buffer.concat([header('root/a.md', 999_999), Buffer.from('short')]);
    const { entries } = readTarGz(gzipSync(lying), BIG, BIG);
    expect(entries).toEqual([]);
  });

  it('treats an unreadable size as zero rather than NaN', () => {
    const bad = Buffer.alloc(BLOCK, 0);
    bad.write('root/a.md', 0, 'utf8');
    bad.write('!!!!!!!!!!!\0', 124, 'ascii');
    bad.write('0', 156, 'ascii');
    expect(() => readTarGz(archive(bad), BIG, BIG)).not.toThrow();
  });

  it('handles an empty archive', () => {
    const { entries, truncated } = readTarGz(gzipSync(Buffer.alloc(BLOCK * 2, 0)), BIG, BIG);
    expect(entries).toEqual([]);
    expect(truncated).toBe(false);
  });

  it('reads a GNU long name from its own block', () => {
    const longPath = 'root/' + 'a/'.repeat(60) + 'deep.md';
    const nameData = Buffer.from(longPath, 'utf8');
    const namePad = Buffer.alloc((BLOCK - (nameData.length % BLOCK)) % BLOCK, 0);
    const gz = archive(
      Buffer.concat([header('././@LongLink', nameData.length, 'L'), nameData, namePad]),
      file('root/ignored', 'content'),
    );
    const { entries } = readTarGz(gz, BIG, BIG);
    expect(entries[0].path).toBe(stripRoot(longPath));
    expect(entries[0].text).toBe('content');
  });
});

describe('readTarGz — the byte cap belongs to files the caller will actually read', () => {
  /**
   * Without a predicate the cap is spent on content that gets discarded a
   * moment later. Scanning this project's own repository reported itself
   * truncated after reading a package-lock.json that was never eligible — a
   * budget spent on files nobody looks at silently shortens the scan.
   */
  it('does not count unwanted files against the total', () => {
    const gz = archive(
      file('root/package-lock.json', 'x'.repeat(900)),
      file('root/a.md', 'y'.repeat(90)),
    );
    const { entries, truncated } = readTarGz(gz, 1000, BIG, (p) => p === 'a.md');
    expect(entries.map((e) => e.path)).toEqual(['a.md']);
    expect(truncated).toBe(false);
  });

  it('still truncates when the WANTED files exceed the cap', () => {
    const gz = archive(file('root/a.md', 'x'.repeat(600)), file('root/b.md', 'y'.repeat(600)));
    const { entries, truncated } = readTarGz(gz, 1000, BIG, () => true);
    expect(entries).toHaveLength(1);
    expect(truncated).toBe(true);
  });

  it('keeps everything when no predicate is given', () => {
    const gz = archive(file('root/a.md', 'x'), file('root/b.md', 'y'));
    expect(readTarGz(gz, BIG, BIG).entries).toHaveLength(2);
  });
});
