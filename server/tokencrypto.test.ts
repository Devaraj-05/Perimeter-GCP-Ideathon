import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { sealWithKey, openWithKey, parseKey, TokenCryptoError } from './tokencrypto';

/**
 * INV-16 — Amendment H.
 *
 * These test the construction, not the plumbing. The properties that matter for
 * a stored refresh token are: it round-trips, a wrong key fails, ANY tampering
 * fails, and two seals of the same value never look alike.
 *
 * That last one is not cosmetic. GCM with a reused IV under the same key leaks
 * the keystream — it is not "somewhat weaker", it is broken. A test that two
 * ciphertexts of identical plaintext differ is the cheapest way to catch a
 * future refactor that hoists the IV out of the function.
 */

const KEY = randomBytes(32);
const OTHER = randomBytes(32);
const TOKEN = '1//0gTESTrefreshTOKENvalue-not-real';

describe('seal / open round trip', () => {
  it('recovers the exact value', () => {
    expect(openWithKey(sealWithKey(TOKEN, KEY), KEY)).toBe(TOKEN);
  });

  it('handles unicode and long values', () => {
    for (const v of ['héllo–wörld 🔐', 'x'.repeat(4000), '{"json":"payload"}']) {
      expect(openWithKey(sealWithKey(v, KEY), KEY)).toBe(v);
    }
  });

  it('never emits the plaintext in the ciphertext', () => {
    const sealed = sealWithKey(TOKEN, KEY);
    expect(sealed).not.toContain(TOKEN);
    expect(sealed).not.toContain('refreshTOKEN');
  });

  it('is versioned so the scheme can be rotated', () => {
    expect(sealWithKey(TOKEN, KEY).startsWith('v1.')).toBe(true);
  });
});

describe('a fresh IV per record', () => {
  it('two seals of the same value differ', () => {
    // If these are ever equal, the IV has been hoisted and GCM is broken.
    const a = sealWithKey(TOKEN, KEY);
    const b = sealWithKey(TOKEN, KEY);
    expect(a).not.toBe(b);
  });

  it('100 seals produce 100 distinct IVs', () => {
    const ivs = new Set(Array.from({ length: 100 }, () => sealWithKey(TOKEN, KEY).split('.')[1]));
    expect(ivs.size).toBe(100);
  });
});

describe('tampering fails closed', () => {
  it('a different key cannot open it', () => {
    expect(() => openWithKey(sealWithKey(TOKEN, KEY), OTHER)).toThrow(TokenCryptoError);
  });

  it('an altered ciphertext is rejected', () => {
    const [v, iv, tag, data] = sealWithKey(TOKEN, KEY).split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 0xff;
    expect(() => openWithKey([v, iv, tag, flipped.toString('base64url')].join('.'), KEY)).toThrow(
      TokenCryptoError,
    );
  });

  it('an altered auth tag is rejected', () => {
    const [v, iv, tag, data] = sealWithKey(TOKEN, KEY).split('.');
    const t = Buffer.from(tag, 'base64url');
    t[0] ^= 0xff;
    expect(() => openWithKey([v, iv, t.toString('base64url'), data].join('.'), KEY)).toThrow(
      TokenCryptoError,
    );
  });

  it('an altered IV is rejected', () => {
    const [v, iv, tag, data] = sealWithKey(TOKEN, KEY).split('.');
    const i = Buffer.from(iv, 'base64url');
    i[0] ^= 0xff;
    expect(() => openWithKey([v, i.toString('base64url'), tag, data].join('.'), KEY)).toThrow(
      TokenCryptoError,
    );
  });

  it.each([
    ['empty', ''],
    ['not versioned', 'a.b.c.d'],
    ['too few parts', 'v1.a.b'],
    ['plaintext', TOKEN],
    ['null-ish', null],
  ])('refuses malformed input: %s', (_label, value) => {
    expect(() => openWithKey(value as any, KEY)).toThrow(TokenCryptoError);
  });

  it('reports one reason for every failure, so it is not an oracle', () => {
    const [v, iv, tag, data] = sealWithKey(TOKEN, KEY).split('.');
    const t = Buffer.from(tag, 'base64url');
    t[0] ^= 0xff;

    const e1 = (() => {
      try {
        openWithKey(sealWithKey(TOKEN, KEY), OTHER);
      } catch (e: any) {
        return e.code;
      }
    })();
    const e2 = (() => {
      try {
        openWithKey([v, iv, t.toString('base64url'), data].join('.'), KEY);
      } catch (e: any) {
        return e.code;
      }
    })();

    expect(e1).toBe('decrypt_failed');
    expect(e2).toBe('decrypt_failed');
  });
});

describe('key validation', () => {
  it('requires exactly 32 bytes', () => {
    expect(() => parseKey(randomBytes(16).toString('base64'))).toThrow(TokenCryptoError);
    expect(() => parseKey(randomBytes(64).toString('base64'))).toThrow(TokenCryptoError);
    expect(parseKey(randomBytes(32).toString('base64')).length).toBe(32);
  });

  it.each([['empty', ''], ['whitespace', '   '], ['undefined', undefined]])(
    'refuses %s',
    (_l, v) => {
      expect(() => parseKey(v as any)).toThrow(TokenCryptoError);
    },
  );
});
