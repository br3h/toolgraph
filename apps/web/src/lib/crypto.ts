import 'server-only';

/**
 * Envelope encryption for provider credentials.
 *
 * A connection's Authorization header is the one piece of user data in Toolgraph
 * that is worth stealing on its own: it is a live key to somebody else's
 * system. Three separate things have to fail before one leaks —
 *
 *   1. the `connection_secrets` table is granted to `service_role` only, so no
 *      browser-held token can read it (see 20260201000100_connections.sql);
 *   2. RLS is on with no policies, so even a restored grant sees nothing;
 *   3. and the column holds AES-256-GCM ciphertext keyed by a value that lives
 *      in the host environment, not in the database.
 *
 * (3) is what this module is. It is the layer that makes a stolen database
 * backup — the most likely way any of this ever gets out — useless on its own.
 *
 * GCM rather than CBC because it is authenticated: a tampered ciphertext fails
 * to decrypt rather than decrypting to something attacker-influenced. The
 * connection id is bound in as additional authenticated data, so a row copied
 * from one connection to another does not decrypt either — which matters,
 * because `service_role` can write any row it likes and a bug that crossed two
 * users' rows would otherwise be silent.
 */

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // 96 bits, the size GCM is specified for.
const TAG_BYTES = 16;

/**
 * Version prefix on every ciphertext.
 *
 * Without it, changing the key or the algorithm later means guessing what each
 * stored row contains. With it, a migration can decrypt v1 and write v2.
 */
const VERSION = 'v1';

export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialCryptoError';
  }
}

/**
 * The key, or null when the feature is not configured.
 *
 * Null is a first-class, supported state and not an error: a self-hoster who
 * has not set `CREDENTIAL_ENCRYPTION_KEY` gets a Toolgraph where connections
 * work exactly as they did before this feature existed — the credential is
 * typed per session and never stored. The UI says so. What must never happen is
 * a fallback that stores the value in some weaker form, so there isn't one.
 */
function readKey(): Buffer | null {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim();
  if (!raw) return null;

  let key: Buffer;
  try {
    key = Buffer.from(raw, 'base64');
  } catch {
    throw new CredentialCryptoError(
      'CREDENTIAL_ENCRYPTION_KEY is not valid base64. Generate one with: openssl rand -base64 32',
    );
  }

  if (key.length !== KEY_BYTES) {
    throw new CredentialCryptoError(
      `CREDENTIAL_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}. ` +
        'Generate one with: openssl rand -base64 32',
    );
  }

  return key;
}

/** Whether credentials can be stored at all. Drives the UI's honest disclosure. */
export function credentialStorageConfigured(): boolean {
  try {
    return readKey() !== null;
  } catch {
    // A malformed key is not a configured key. The error surfaces on the write
    // path, where there is somewhere to show it.
    return false;
  }
}

function requireKey(): Buffer {
  const key = readKey();
  if (!key) {
    throw new CredentialCryptoError(
      'CREDENTIAL_ENCRYPTION_KEY is not set, so credentials cannot be stored.',
    );
  }
  return key;
}

/**
 * Encrypt `plaintext`, bound to `connectionId`.
 *
 * The id is additional authenticated data rather than part of the plaintext: it
 * is not secret, it must not be recoverable from the output, and it must make
 * decryption fail if it does not match. AAD is exactly that.
 */
export function encryptCredential(connectionId: string, plaintext: string): string {
  const key = requireKey();
  const iv = randomBytes(IV_BYTES);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(connectionId, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64'),
    ciphertext.toString('base64'),
    tag.toString('base64'),
  ].join('.');
}

/**
 * Decrypt, or throw.
 *
 * Every failure — wrong key, wrong connection id, truncated row, tampered tag —
 * comes back as the same message. Distinguishing them would tell an attacker
 * which of their guesses was closer, and there is nothing a caller can do
 * differently for one versus another anyway.
 */
export function decryptCredential(connectionId: string, encoded: string): string {
  const key = requireKey();
  const parts = encoded.split('.');

  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new CredentialCryptoError('That stored credential could not be read.');
  }

  try {
    const iv = Buffer.from(parts[1] as string, 'base64');
    const ciphertext = Buffer.from(parts[2] as string, 'base64');
    const tag = Buffer.from(parts[3] as string, 'base64');

    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new CredentialCryptoError('That stored credential could not be read.');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(connectionId, 'utf8'));
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof CredentialCryptoError) throw error;
    throw new CredentialCryptoError('That stored credential could not be read.');
  }
}

/**
 * Constant-time string comparison, for anywhere a secret is compared to input.
 *
 * `===` on strings short-circuits at the first differing byte, which leaks the
 * length of the matching prefix to anyone who can measure it.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on a length mismatch, which is itself a length
  // oracle — so compare lengths first and return the same way either way.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
