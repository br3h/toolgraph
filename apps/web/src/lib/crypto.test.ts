/**
 * Credential encryption.
 *
 * These are the tests that matter for a module whose failure mode is "somebody
 * else's API key is readable". Round-tripping is the least of it; the ones that
 * earn their place are the tampering and cross-binding cases, because those are
 * the properties GCM is chosen FOR and a silent downgrade to unauthenticated
 * encryption would still pass a round-trip test.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Two test keys, DERIVED rather than written out as base64.
 *
 * Not a style choice: a 44-character base64 blob in a source file is exactly
 * what a secret scanner is built to catch, and the pre-commit hook duly caught
 * these. The right response to a fail-closed scanner is to stop putting things
 * that look like keys in the repo — not to add an allowlist entry that makes it
 * quieter. Writing the plaintext out also makes it self-evidently fake, which
 * an opaque blob never is.
 *
 * AES-256 needs exactly 32 bytes, so each source string is 32 ASCII characters.
 */
const KEY_A = Buffer.from('toolgraph-test-key-aaaaaaaaaaaaa!').subarray(0, 32).toString('base64');
const KEY_B = Buffer.from('toolgraph-test-key-bbbbbbbbbbbbb!').subarray(0, 32).toString('base64');

const CONNECTION = '11111111-1111-1111-1111-111111111111';
const OTHER_CONNECTION = '22222222-2222-2222-2222-222222222222';
const SECRET = 'Bearer sk-live-not-a-real-token-0123456789';

async function load() {
  // Re-imported per test because the module reads the key from the environment
  // and the tests change it.
  const mod = await import('./crypto');
  return mod;
}

describe('credential encryption', () => {
  const original = process.env.CREDENTIAL_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = KEY_A;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    else process.env.CREDENTIAL_ENCRYPTION_KEY = original;
  });

  it('round-trips a credential', async () => {
    const { encryptCredential, decryptCredential } = await load();
    const sealed = encryptCredential(CONNECTION, SECRET);
    expect(decryptCredential(CONNECTION, sealed)).toBe(SECRET);
  });

  it('never leaves the plaintext recoverable from the ciphertext', async () => {
    const { encryptCredential } = await load();
    const sealed = encryptCredential(CONNECTION, SECRET);

    // The specific thing being asserted: no substring of the secret survives
    // into the stored value. A bug that wrote the plaintext alongside the
    // ciphertext would round-trip perfectly and be caught only by this.
    expect(sealed).not.toContain(SECRET);
    expect(sealed).not.toContain('sk-live');
    expect(Buffer.from(sealed, 'utf8').toString('utf8')).not.toContain('sk-live');
  });

  it('produces a different ciphertext every time', async () => {
    const { encryptCredential } = await load();
    const first = encryptCredential(CONNECTION, SECRET);
    const second = encryptCredential(CONNECTION, SECRET);

    // A fresh IV per encryption. Without it, two identical credentials would
    // produce identical rows, which tells an observer with database access that
    // two connections share a token.
    expect(first).not.toBe(second);
  });

  it('carries a version prefix so the format can change later', async () => {
    const { encryptCredential } = await load();
    expect(encryptCredential(CONNECTION, SECRET).startsWith('v1.')).toBe(true);
  });

  it('refuses to decrypt with a different key', async () => {
    const { encryptCredential } = await load();
    const sealed = encryptCredential(CONNECTION, SECRET);

    process.env.CREDENTIAL_ENCRYPTION_KEY = KEY_B;
    const { decryptCredential } = await load();

    expect(() => decryptCredential(CONNECTION, sealed)).toThrow();
  });

  it('refuses to decrypt a row bound to another connection', async () => {
    const { encryptCredential, decryptCredential } = await load();
    const sealed = encryptCredential(CONNECTION, SECRET);

    // The connection id is additional authenticated data, so a row copied from
    // one connection to another does not decrypt. This is what stops a bug —
    // or a service-role query — that crossed two users' rows from being silent.
    expect(() => decryptCredential(OTHER_CONNECTION, sealed)).toThrow();
  });

  it('refuses a tampered ciphertext', async () => {
    const { encryptCredential, decryptCredential } = await load();
    const sealed = encryptCredential(CONNECTION, SECRET);
    const parts = sealed.split('.');

    // Flip a byte in the ciphertext. GCM's tag must catch it; an unauthenticated
    // mode would decrypt to attacker-influenced garbage instead of failing.
    const body = Buffer.from(parts[2] as string, 'base64');
    body[0] = (body[0] as number) ^ 0xff;
    const tampered = [parts[0], parts[1], body.toString('base64'), parts[3]].join('.');

    expect(() => decryptCredential(CONNECTION, tampered)).toThrow();
  });

  it('refuses a tampered auth tag', async () => {
    const { encryptCredential, decryptCredential } = await load();
    const parts = encryptCredential(CONNECTION, SECRET).split('.');
    const tag = Buffer.from(parts[3] as string, 'base64');
    tag[0] = (tag[0] as number) ^ 0xff;

    expect(() =>
      decryptCredential(
        CONNECTION,
        [parts[0], parts[1], parts[2], tag.toString('base64')].join('.'),
      ),
    ).toThrow();
  });

  it.each([
    ['empty', ''],
    ['wrong shape', 'not-a-ciphertext'],
    ['unknown version', 'v9.aaaa.bbbb.cccc'],
    ['too few parts', 'v1.aaaa.bbbb'],
  ])('refuses a malformed value: %s', async (_label, value) => {
    const { decryptCredential } = await load();
    expect(() => decryptCredential(CONNECTION, value)).toThrow();
  });

  it('gives the same message for every failure, so it is not an oracle', async () => {
    const { encryptCredential, decryptCredential } = await load();
    const sealed = encryptCredential(CONNECTION, SECRET);

    const messages = new Set<string>();
    for (const attempt of [
      () => decryptCredential(OTHER_CONNECTION, sealed),
      () => decryptCredential(CONNECTION, 'v1.aaaa.bbbb.cccc'),
      () => decryptCredential(CONNECTION, `${sealed}x`),
    ]) {
      try {
        attempt();
      } catch (error) {
        messages.add((error as Error).message);
      }
    }

    // Distinguishing "wrong connection" from "corrupt row" would tell an
    // attacker which of their guesses was closer.
    expect(messages.size).toBe(1);
  });

  describe('when no key is configured', () => {
    beforeEach(() => {
      delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    });

    it('reports the feature as unconfigured rather than throwing', async () => {
      const { credentialStorageConfigured } = await load();
      expect(credentialStorageConfigured()).toBe(false);
    });

    it('refuses to encrypt rather than falling back to something weaker', async () => {
      const { encryptCredential } = await load();
      // The important half: there is no path that stores the value in a weaker
      // form when the key is missing. It fails, loudly.
      expect(() => encryptCredential(CONNECTION, SECRET)).toThrow(/not set/i);
    });
  });

  describe('with a malformed key', () => {
    it('treats a wrong-length key as unconfigured', async () => {
      process.env.CREDENTIAL_ENCRYPTION_KEY = Buffer.from('too short').toString('base64');
      const { credentialStorageConfigured, encryptCredential } = await load();

      expect(credentialStorageConfigured()).toBe(false);
      // But the write path still explains what is wrong, because that is where
      // there is somewhere to show it.
      expect(() => encryptCredential(CONNECTION, SECRET)).toThrow(/32 bytes/);
    });
  });
});

describe('safeEqual', () => {
  it('matches identical strings and rejects different ones', async () => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = KEY_A;
    const { safeEqual } = await load();

    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
  });

  it('returns false rather than throwing on a length mismatch', async () => {
    const { safeEqual } = await load();
    // node:crypto's timingSafeEqual throws when lengths differ, which would
    // itself be a length oracle via the exception.
    expect(safeEqual('short', 'much longer string')).toBe(false);
  });
});
