/**
 * Adversarial regression tests for the SSRF guard.
 *
 * Written independently of `ssrf.test.ts` and deliberately from the attacker's
 * side: each case is a bypass that has worked against real URL validators.
 * The point is not coverage of the implementation, it is that these specific
 * tricks stay dead.
 */
import { describe, expect, it } from 'vitest';
import { assertUrlAllowed, isBlockedAddress } from './ssrf';

const strict = { allowPrivateNetwork: false };
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

describe('adversarial: literal address forms', () => {
  const mustBlock = [
    '127.0.0.1',
    '127.1.1.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    '240.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '203.0.113.1',
    '::1',
    '::',
    'fc00::1',
    'fd00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:169.254.169.254',
    '64:ff9b::7f00:1',
    '2001:db8::1',
  ];
  for (const ip of mustBlock) {
    it(`blocks ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true));
  }

  const mustAllow = ['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700::1111'];
  for (const ip of mustAllow) {
    it(`allows ${ip}`, () => expect(isBlockedAddress(ip)).toBe(false));
  }
});

describe('adversarial: hostname obfuscation', () => {
  const bypasses = [
    'http://2130706433/', // decimal 127.0.0.1
    'http://0x7f000001/', // hex
    'http://0177.0.0.1/', // octal
    'http://127.1/', // short form
    'http://[::1]/', // bracketed v6 loopback
    'http://[::ffff:127.0.0.1]/', // v4-mapped
    'http://localhost/',
    'http://LOCALHOST/',
    'http://foo.localhost/',
    'http://x.local/',
    'http://y.internal/',
    'http://metadata.google.internal/',
    'http://169.254.169.254/latest/meta-data/',
  ];
  for (const url of bypasses) {
    it(`denies ${url}`, async () => {
      const v = await assertUrlAllowed(url, strict, { lookup: publicLookup });
      expect(v.allowed, `${url} was ALLOWED`).toBe(false);
    });
  }
});

describe('adversarial: protocol and credentials', () => {
  for (const url of ['file:///etc/passwd', 'gopher://x/', 'ftp://x/', 'data:text/plain,x']) {
    it(`denies ${url}`, async () => {
      const v = await assertUrlAllowed(url, strict, { lookup: publicLookup });
      expect(v.allowed).toBe(false);
      if (!v.allowed) expect(v.code).toBe('protocol_not_allowed');
    });
  }

  it('denies credentials embedded in the URL', async () => {
    const v = await assertUrlAllowed('https://user:pass@example.com/', strict, {
      lookup: publicLookup,
    });
    expect(v.allowed).toBe(false);
    if (!v.allowed) expect(v.code).toBe('credentials_in_url');
  });
});

describe('adversarial: DNS rebinding — the check a hostname string cannot make', () => {
  it('denies a public hostname resolving to loopback', async () => {
    const v = await assertUrlAllowed('https://rebind.example.com/', strict, {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    expect(v.allowed, 'rebinding to 127.0.0.1 was ALLOWED').toBe(false);
    if (!v.allowed) expect(v.code).toBe('blocked_ip');
  });

  it('denies when ANY resolved address is private', async () => {
    const v = await assertUrlAllowed('https://mixed.example.com/', strict, {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ],
    });
    expect(v.allowed, 'mixed public+private resolution was ALLOWED').toBe(false);
  });

  it('denies a hostname resolving to a v4-mapped loopback', async () => {
    const v = await assertUrlAllowed('https://sneaky.example.com/', strict, {
      lookup: async () => [{ address: '::ffff:127.0.0.1', family: 6 }],
    });
    expect(v.allowed).toBe(false);
  });

  it('allows a genuinely public destination', async () => {
    const v = await assertUrlAllowed('https://example.com/mcp', strict, { lookup: publicLookup });
    expect(v.allowed, 'a public host was wrongly denied').toBe(true);
  });
});

describe('adversarial: the local-dev escape hatch stays narrow', () => {
  const loose = { allowPrivateNetwork: true };

  it('permits loopback when explicitly enabled', async () => {
    const v = await assertUrlAllowed('http://127.0.0.1:3000/mcp', loose, {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    expect(v.allowed).toBe(true);
  });

  it('still denies file:// even when enabled', async () => {
    const v = await assertUrlAllowed('file:///etc/passwd', loose, { lookup: publicLookup });
    expect(v.allowed).toBe(false);
  });

  it('still denies embedded credentials even when enabled', async () => {
    const v = await assertUrlAllowed('http://u:p@127.0.0.1/', loose, {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    });
    expect(v.allowed).toBe(false);
  });
});
