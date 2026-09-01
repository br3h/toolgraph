import { describe, expect, it } from 'vitest';

import {
  assertUrlAllowed,
  blockedRangeFor,
  checkHostnameLiteral,
  isBlockedAddress,
  isIpLiteral,
  parseIpv4,
  parseIpv6,
  type DnsLookupFn,
  type SsrfPolicy,
  type UrlVerdict,
} from './ssrf';

/* -------------------------------------------------------------------------- */
/* Harness                                                                     */
/* -------------------------------------------------------------------------- */

const strict: SsrfPolicy = { allowPrivateNetwork: false };
const permissive: SsrfPolicy = { allowPrivateNetwork: true };

/** A resolver that answers every name with the given addresses. */
const resolvesTo =
  (...addresses: string[]): DnsLookupFn =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));

const resolverFails: DnsLookupFn = async () => {
  throw new Error('ENOTFOUND');
};

const resolverEmpty: DnsLookupFn = async () => [];

/**
 * Asserts the network is never touched. Any test that reaches this has a path
 * that would have made a real DNS query.
 */
const resolverForbidden: DnsLookupFn = async () => {
  throw new Error('the resolver must not be consulted on this path');
};

function denial(verdict: UrlVerdict): { code: string; reason: string } {
  if (verdict.allowed) throw new Error('expected the URL to be denied, but it was allowed');
  return { code: verdict.code, reason: verdict.reason };
}

/* -------------------------------------------------------------------------- */
/* IPv4 literals                                                               */
/* -------------------------------------------------------------------------- */

describe('blocked IPv4 ranges', () => {
  const blocked: [string, string][] = [
    ['0.0.0.0', '0.0.0.0/8'],
    ['0.1.2.3', '0.0.0.0/8'],
    ['10.0.0.1', '10.0.0.0/8'],
    ['10.255.255.254', '10.0.0.0/8'],
    ['100.64.0.1', '100.64.0.0/10'],
    ['100.127.255.254', '100.64.0.0/10'],
    ['127.0.0.1', '127.0.0.0/8'],
    ['127.255.255.254', '127.0.0.0/8'],
    ['169.254.0.1', '169.254.0.0/16'],
    ['169.254.169.254', '169.254.0.0/16'],
    ['172.16.0.1', '172.16.0.0/12'],
    ['172.31.255.254', '172.16.0.0/12'],
    ['192.0.0.1', '192.0.0.0/24'],
    ['192.0.2.1', '192.0.2.0/24'],
    ['192.88.99.1', '192.88.99.0/24'],
    ['192.168.0.1', '192.168.0.0/16'],
    ['192.168.255.254', '192.168.0.0/16'],
    ['198.18.0.1', '198.18.0.0/15'],
    ['198.19.255.254', '198.18.0.0/15'],
    ['198.51.100.1', '198.51.100.0/24'],
    ['203.0.113.1', '203.0.113.0/24'],
    ['224.0.0.1', '224.0.0.0/4'],
    ['239.255.255.255', '224.0.0.0/4'],
    ['240.0.0.1', '240.0.0.0/4'],
    ['255.255.255.255', '240.0.0.0/4'],
  ];

  it.each(blocked)('blocks %s and names the range', (address, range) => {
    expect(isBlockedAddress(address)).toBe(true);
    expect(blockedRangeFor(address)).toContain(range);
  });

  it('specifically blocks the cloud metadata endpoint', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  const allowed = [
    '93.184.216.34',
    '1.1.1.1',
    '8.8.8.8',
    // Neighbours of blocked ranges: a string-prefix check would fail all of these.
    '110.0.0.1',
    '100.128.0.1',
    '128.0.0.1',
    '169.255.0.1',
    '172.32.0.1',
    '192.0.1.1',
    '192.0.3.1',
    '192.88.100.1',
    '192.169.0.1',
    '198.20.0.1',
    '198.51.101.1',
    '203.0.114.1',
    '223.255.255.255',
  ];

  it.each(allowed)('allows the public address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
    expect(blockedRangeFor(address)).toBeNull();
  });
});

describe('non-dotted IPv4 spellings', () => {
  it('parses the decimal form', () => {
    expect(parseIpv4('2130706433')).toBe(0x7f000001);
    expect(isBlockedAddress('2130706433')).toBe(true);
  });

  it('parses the hex form', () => {
    expect(parseIpv4('0x7f000001')).toBe(0x7f000001);
    expect(isBlockedAddress('0x7f000001')).toBe(true);
  });

  it('parses the octal form', () => {
    expect(parseIpv4('0177.0.0.1')).toBe(0x7f000001);
    expect(isBlockedAddress('0177.0.0.1')).toBe(true);
  });

  it('parses the short form', () => {
    expect(parseIpv4('127.1')).toBe(0x7f000001);
    expect(isBlockedAddress('127.1')).toBe(true);
  });

  it('rejects strings that are not addresses at all', () => {
    expect(parseIpv4('example.com')).toBeNull();
    expect(parseIpv4('1.2.3.4.5')).toBeNull();
    expect(parseIpv4('127.0.0.1.')).toBeNull();
    expect(parseIpv4('0x')).toBeNull();
    expect(parseIpv4('0199.0.0.1')).toBeNull();
    expect(parseIpv4('256.0.0.1')).toBeNull();
    expect(parseIpv4('')).toBeNull();
    expect(isBlockedAddress('example.com')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* IPv6 literals                                                               */
/* -------------------------------------------------------------------------- */

describe('blocked IPv6 ranges', () => {
  const blocked = [
    '::',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'ff00::1',
    'ff02::1',
    '100::1',
    '2001:db8::1',
  ];

  it.each(blocked)('blocks %s', (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it('blocks bracketed literals', () => {
    expect(isBlockedAddress('[::1]')).toBe(true);
    expect(isBlockedAddress('[fe80::1]')).toBe(true);
  });

  it('ignores a zone id when deciding', () => {
    expect(isBlockedAddress('fe80::1%eth0')).toBe(true);
  });

  const allowed = ['2606:4700:4700::1111', '2a00:1450:4001:82f::200e', '2001:db9::1'];

  it.each(allowed)('allows the public address %s', (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it('rejects malformed literals rather than parsing them', () => {
    expect(parseIpv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIpv6('1::2::3')).toBeNull();
    expect(parseIpv6(':1')).toBeNull();
    expect(parseIpv6('nope')).toBeNull();
    expect(parseIpv6('::ffff:999.0.0.1')).toBeNull();
  });
});

describe('IPv4 embedded in IPv6', () => {
  it('unwraps the IPv4-mapped form and re-runs the IPv4 check', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedAddress('::ffff:169.254.169.254')).toBe(true);
    // The same address in the hex spelling the URL parser normalises it to.
    expect(isBlockedAddress('::ffff:7f00:1')).toBe(true);
  });

  it('names both the wrapper and the wrapped range', () => {
    expect(blockedRangeFor('::ffff:10.0.0.1')).toContain('IPv4-mapped');
    expect(blockedRangeFor('::ffff:10.0.0.1')).toContain('10.0.0.0/8');
  });

  it('unwraps the IPv4-compatible form', () => {
    expect(isBlockedAddress('::127.0.0.1')).toBe(true);
    expect(isBlockedAddress('::192.168.1.1')).toBe(true);
  });

  it('unwraps the IPv4-translated form', () => {
    expect(isBlockedAddress('::ffff:0:127.0.0.1')).toBe(true);
  });

  it('unwraps NAT64', () => {
    expect(isBlockedAddress('64:ff9b::127.0.0.1')).toBe(true);
    expect(isBlockedAddress('64:ff9b::7f00:1')).toBe(true);
    expect(isBlockedAddress('64:ff9b::169.254.169.254')).toBe(true);
  });

  it('still allows a public address wrapped in a mapped prefix', () => {
    expect(isBlockedAddress('::ffff:93.184.216.34')).toBe(false);
    expect(isBlockedAddress('64:ff9b::93.184.216.34')).toBe(false);
  });
});

describe('isIpLiteral', () => {
  it('recognises every form the guard has to normalise', () => {
    expect(isIpLiteral('127.0.0.1')).toBe(true);
    expect(isIpLiteral('2130706433')).toBe(true);
    expect(isIpLiteral('[::1]')).toBe(true);
    expect(isIpLiteral('93.184.216.34')).toBe(true);
  });

  it('does not mistake a hostname for an address', () => {
    expect(isIpLiteral('example.com')).toBe(false);
    expect(isIpLiteral('')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Hostnames                                                                   */
/* -------------------------------------------------------------------------- */

describe('checkHostnameLiteral', () => {
  const names = [
    'localhost',
    'LOCALHOST',
    'LocalHost',
    'localhost.',
    'foo.localhost',
    'x.local',
    'PRINTER.LOCAL',
    'y.internal',
    'metadata',
    'metadata.google.internal',
    'instance-data',
    'router.home.arpa',
  ];

  it.each(names)('rejects %s', (host) => {
    const verdict = checkHostnameLiteral(host, strict);
    expect(verdict).not.toBeNull();
    expect(verdict?.allowed).toBe(false);
  });

  it('does not object to an ordinary public name', () => {
    expect(checkHostnameLiteral('example.com', strict)).toBeNull();
    expect(checkHostnameLiteral('api.internal-tools.com', strict)).toBeNull();
  });

  it('rejects an empty hostname whatever the policy says', () => {
    expect(checkHostnameLiteral('', strict)?.allowed).toBe(false);
    expect(checkHostnameLiteral('', permissive)?.allowed).toBe(false);
  });

  it('lets a permissive policy through', () => {
    expect(checkHostnameLiteral('localhost', permissive)).toBeNull();
    expect(checkHostnameLiteral('127.0.0.1', permissive)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* assertUrlAllowed                                                            */
/* -------------------------------------------------------------------------- */

describe('assertUrlAllowed: protocols and credentials', () => {
  it.each([
    'file:///etc/passwd',
    'gopher://x/',
    'ftp://x/',
    'ws://example.com/',
    'data:text/plain,hi',
  ])('refuses %s with protocol_not_allowed', async (url) => {
    const verdict = await assertUrlAllowed(url, strict, { lookup: resolverForbidden });
    expect(denial(verdict).code).toBe('protocol_not_allowed');
  });

  it('refuses credentials in the URL', async () => {
    const verdict = await assertUrlAllowed('http://user:pass@example.com', strict, {
      lookup: resolverForbidden,
    });
    expect(denial(verdict).code).toBe('credentials_in_url');
  });

  it('refuses a username with no password', async () => {
    const verdict = await assertUrlAllowed('https://token@example.com/mcp', strict, {
      lookup: resolverForbidden,
    });
    expect(denial(verdict).code).toBe('credentials_in_url');
  });

  it('refuses an unparseable URL', async () => {
    const verdict = await assertUrlAllowed('not a url', strict, { lookup: resolverForbidden });
    expect(denial(verdict).code).toBe('invalid_url');
  });
});

describe('assertUrlAllowed: ports', () => {
  it.each(['http://example.com:22/', 'http://example.com:0/', 'http://example.com:1023/'])(
    'refuses %s',
    async (url) => {
      const verdict = await assertUrlAllowed(url, strict, { lookup: resolverForbidden });
      expect(denial(verdict).code).toBe('port_not_allowed');
    },
  );

  it.each([
    'http://example.com/',
    'https://example.com/',
    'http://example.com:8080/',
    'http://example.com:65535/',
  ])('allows %s', async (url) => {
    const verdict = await assertUrlAllowed(url, strict, { lookup: resolvesTo('93.184.216.34') });
    expect(verdict.allowed).toBe(true);
  });
});

describe('assertUrlAllowed: literal hosts', () => {
  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://[::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[64:ff9b::7f00:1]/',
  ])('refuses %s with blocked_ip', async (url) => {
    const verdict = await assertUrlAllowed(url, strict, { lookup: resolverForbidden });
    expect(denial(verdict).code).toBe('blocked_ip');
  });

  it.each([
    'http://localhost/',
    'http://foo.localhost/',
    'http://x.local/',
    'http://y.internal/',
    'http://metadata.google.internal/',
  ])('refuses %s with blocked_hostname', async (url) => {
    const verdict = await assertUrlAllowed(url, strict, { lookup: resolverForbidden });
    expect(denial(verdict).code).toBe('blocked_hostname');
  });

  it('allows a genuinely public literal without resolving it', async () => {
    const verdict = await assertUrlAllowed('https://93.184.216.34/mcp', strict, {
      lookup: resolverForbidden,
    });
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) expect(verdict.resolvedAddresses).toEqual(['93.184.216.34']);
  });
});

describe('assertUrlAllowed: DNS', () => {
  it('blocks a public-looking name that resolves to loopback (rebinding)', async () => {
    const verdict = await assertUrlAllowed('https://totally-fine.example/mcp', strict, {
      lookup: resolvesTo('127.0.0.1'),
    });
    const { code, reason } = denial(verdict);
    expect(code).toBe('blocked_ip');
    expect(reason).toContain('127.0.0.1');
  });

  it('blocks a name that resolves to the metadata endpoint', async () => {
    const verdict = await assertUrlAllowed('https://mcp.attacker.example/', strict, {
      lookup: resolvesTo('169.254.169.254'),
    });
    expect(denial(verdict).code).toBe('blocked_ip');
  });

  it('denies when any one of several addresses is private', async () => {
    const verdict = await assertUrlAllowed('https://mixed.example/', strict, {
      lookup: resolvesTo('93.184.216.34', '10.0.0.5'),
    });
    expect(denial(verdict).code).toBe('blocked_ip');
  });

  it('denies when the private address comes first', async () => {
    const verdict = await assertUrlAllowed('https://mixed.example/', strict, {
      lookup: resolvesTo('10.0.0.5', '93.184.216.34'),
    });
    expect(denial(verdict).code).toBe('blocked_ip');
  });

  it('blocks an IPv6 answer in a private range', async () => {
    const verdict = await assertUrlAllowed('https://six.example/', strict, {
      lookup: resolvesTo('fd00::1'),
    });
    expect(denial(verdict).code).toBe('blocked_ip');
  });

  it('blocks an IPv4-mapped answer', async () => {
    const verdict = await assertUrlAllowed('https://six.example/', strict, {
      lookup: resolvesTo('::ffff:127.0.0.1'),
    });
    expect(denial(verdict).code).toBe('blocked_ip');
  });

  it('treats an unparseable answer as hostile', async () => {
    const verdict = await assertUrlAllowed('https://weird.example/', strict, {
      lookup: resolvesTo('not-an-address'),
    });
    expect(denial(verdict).code).toBe('blocked_ip');
  });

  it('denies when resolution fails', async () => {
    const verdict = await assertUrlAllowed('https://nxdomain.example/', strict, {
      lookup: resolverFails,
    });
    expect(denial(verdict).code).toBe('dns_resolution_failed');
  });

  it('denies when resolution returns nothing', async () => {
    const verdict = await assertUrlAllowed('https://empty.example/', strict, {
      lookup: resolverEmpty,
    });
    expect(denial(verdict).code).toBe('dns_resolution_failed');
  });

  it('allows a name whose every address is public', async () => {
    const verdict = await assertUrlAllowed('https://example.com/mcp', strict, {
      lookup: resolvesTo('93.184.216.34', '2606:4700:4700::1111'),
    });
    expect(verdict.allowed).toBe(true);
    if (verdict.allowed) {
      expect(verdict.resolvedAddresses).toEqual(['93.184.216.34', '2606:4700:4700::1111']);
      expect(verdict.url.href).toBe('https://example.com/mcp');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* allowPrivateNetwork                                                         */
/* -------------------------------------------------------------------------- */

describe('allowPrivateNetwork', () => {
  it('permits loopback and private literals', async () => {
    for (const url of [
      'http://127.0.0.1:3000/mcp',
      'http://localhost:8000/sse',
      'http://[::1]:9000/',
    ]) {
      const verdict = await assertUrlAllowed(url, permissive, { lookup: resolverForbidden });
      expect(verdict.allowed).toBe(true);
    }
  });

  it('still refuses file://', async () => {
    const verdict = await assertUrlAllowed('file:///etc/passwd', permissive, {
      lookup: resolverForbidden,
    });
    expect(denial(verdict).code).toBe('protocol_not_allowed');
  });

  it('still refuses other non-HTTP protocols', async () => {
    const verdict = await assertUrlAllowed('gopher://127.0.0.1/', permissive, {
      lookup: resolverForbidden,
    });
    expect(denial(verdict).code).toBe('protocol_not_allowed');
  });

  it('still refuses credentials in the URL', async () => {
    const verdict = await assertUrlAllowed('http://user:pass@127.0.0.1:3000/', permissive, {
      lookup: resolverForbidden,
    });
    expect(denial(verdict).code).toBe('credentials_in_url');
  });

  it('still refuses a disallowed port', async () => {
    const verdict = await assertUrlAllowed('http://127.0.0.1:22/', permissive, {
      lookup: resolverForbidden,
    });
    expect(denial(verdict).code).toBe('port_not_allowed');
  });

  it('still refuses an unparseable URL', async () => {
    const verdict = await assertUrlAllowed('http://', permissive, { lookup: resolverForbidden });
    expect(verdict.allowed).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Policy plumbing                                                             */
/* -------------------------------------------------------------------------- */

describe('allowedProtocols', () => {
  it('honours an explicit list', async () => {
    const policy: SsrfPolicy = { allowPrivateNetwork: false, allowedProtocols: ['https:'] };
    const denied = await assertUrlAllowed('http://example.com/', policy, {
      lookup: resolverForbidden,
    });
    expect(denial(denied).code).toBe('protocol_not_allowed');

    const allowed = await assertUrlAllowed('https://example.com/', policy, {
      lookup: resolvesTo('93.184.216.34'),
    });
    expect(allowed.allowed).toBe(true);
  });
});
