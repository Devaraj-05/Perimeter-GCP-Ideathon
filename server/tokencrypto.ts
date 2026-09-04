import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getOAuthEncryptionKey } from './secrets';

/**
 * Envelope encryption for stored OAuth tokens — Amendment H, INV-16.
 *
 * AES-256-GCM from node:crypto. No dependency is added because none is needed,
 * and a hand-rolled construction is avoided by using an AEAD that binds the
 * ciphertext to its authentication tag: a tampered record fails to decrypt
 * rather than decrypting to something attacker-chosen.
 *
 * Why encrypt at all when Firestore rules already deny the client?
 *
 * Because rules protect the client path only. The Admin SDK bypasses them
 * entirely, so anything with database access — a future misconfigured export, a
 * backup, an over-broad service account, a query written in a hurry — reads
 * plaintext tokens. The key lives in Secret Manager under a separate IAM
 * binding, so reading the database is not sufficient to use what is in it.
 *
 * Format: v1.<iv>.<tag>.<ciphertext>, all base64url. Versioned so the scheme
 * can be rotated without guessing at what an old record used.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96 bits, the GCM standard
const VERSION = 'v1';

export class TokenCryptoError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'TokenCryptoError';
  }
}

/** Accepts a base64 or base64url 32-byte key. */
export function parseKey(raw: string): Buffer {
  const key = Buffer.from(String(raw ?? '').trim(), 'base64');
  if (key.length !== 32) throw new TokenCryptoError('bad_encryption_key');
  return key;
}

export function sealWithKey(plaintext: string, key: Buffer): string {
  if (typeof plaintext !== 'string' || plaintext === '') {
    throw new TokenCryptoError('nothing_to_seal');
  }

  // A fresh IV per record. Reusing one under the same key breaks GCM
  // catastrophically — it is not merely weaker, it leaks the keystream.
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function openWithKey(sealed: string, key: Buffer): string {
  const parts = String(sealed ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new TokenCryptoError('bad_ciphertext');

  const [, ivB64, tagB64, dataB64] = parts;

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Any tampering lands here: wrong key, altered tag, altered ciphertext.
    // The reason is never reported — distinguishing them is an oracle.
    throw new TokenCryptoError('decrypt_failed');
  }
}

/** Seals with the deployment's key from Secret Manager. */
export async function seal(plaintext: string): Promise<string> {
  return sealWithKey(plaintext, parseKey(await getOAuthEncryptionKey()));
}

/** Opens with the deployment's key from Secret Manager. */
export async function open(sealed: string): Promise<string> {
  return openWithKey(sealed, parseKey(await getOAuthEncryptionKey()));
}
