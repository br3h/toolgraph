/**
 * Outbound URL guard.
 *
 * Every MCP server toolgraph talks to is a URL some user typed into a form, so
 * the hosted engine is one careless fetch away from being a proxy into its own
 * private network — cloud metadata endpoints, the Supabase pooler, anything on
 * the VPC. This module is the single choke point that decides whether an
 * address may be dialled at all.
 *
 * Two properties matter more than anything else here:
 *
 *  - Ranges are matched numerically. String prefix matching ("starts with 127.")
 *    is trivially bypassed by `0177.0.0.1`, `2130706433` or `::ffff:127.0.0.1`,
 *    so every literal is normalised to a number (IPv4) or a BigInt (IPv6) first.
 *  - The hostname is resolved and *every* returned address is checked. Checking
 *    only the hostname string loses to DNS rebinding: an attacker controls the
 *    zone and points a perfectly innocent name at 169.254.169.254.
 */

import { lookup as nodeLookup } from 'node:dns/promises';

/* -------------------------------------------------------------------------- */
/* Public types                                                                */
/* -------------------------------------------------------------------------- */

export interface SsrfPolicy {
  /** When true, private/loopback destinations are permitted. Local dev only. */
  allowPrivateNetwork: boolean;
  /** Protocols permitted. Default ['https:', 'http:']. */
  allowedProtocols?: string[];
}

export type SsrfDenyCode =
  | 'invalid_url'
  | 'protocol_not_allowed'
  | 'credentials_in_url'
  | 'blocked_hostname'
  | 'blocked_ip'
  | 'dns_resolution_failed'
  | 'port_not_allowed';

export type UrlVerdict =
  | { allowed: true; url: URL; resolvedAddresses: string[] }
  | { allowed: false; reason: string; code: SsrfDenyCode };

/** One address as returned by a resolver. Matches Node's `LookupAddress`. */
export interface DnsLookupResult {
  address: string;
  family: number;
}

/**
 * The slice of `dns/promises`.lookup the guard depends on. Injectable so tests
 * can exercise the rebinding paths without a network or a real zone.
 */
export type DnsLookupFn = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<DnsLookupResult[]>;

export interface AssertUrlOptions {
  /** Defaults to `dns/promises`.lookup. */
  lookup?: DnsLookupFn;
}

/* -------------------------------------------------------------------------- */
/* IPv4                                                                        */
/* -------------------------------------------------------------------------- */

const ip4 = (a: number, b: number, c: number, d: number): number =>
  ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;

const mask4 = (bits: number): number => (bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0);

interface Ipv4Range {
  base: number;
  bits: number;
  label: string;
}

const IPV4_BLOCKED: readonly Ipv4Range[] = [
  { base: ip4(0, 0, 0, 0), bits: 8, label: '0.0.0.0/8 (this network)' },
  { base: ip4(10, 0, 0, 0), bits: 8, label: '10.0.0.0/8 (private)' },
  { base: ip4(100, 64, 0, 0), bits: 10, label: '100.64.0.0/10 (carrier-grade NAT)' },
  { base: ip4(127, 0, 0, 0), bits: 8, label: '127.0.0.0/8 (loopback)' },
  { base: ip4(169, 254, 0, 0), bits: 16, label: '169.254.0.0/16 (link-local, cloud metadata)' },
  { base: ip4(172, 16, 0, 0), bits: 12, label: '172.16.0.0/12 (private)' },
  { base: ip4(192, 0, 0, 0), bits: 24, label: '192.0.0.0/24 (IETF protocol assignments)' },
  { base: ip4(192, 0, 2, 0), bits: 24, label: '192.0.2.0/24 (documentation)' },
  { base: ip4(192, 88, 99, 0), bits: 24, label: '192.88.99.0/24 (6to4 relay anycast)' },
  { base: ip4(192, 168, 0, 0), bits: 16, label: '192.168.0.0/16 (private)' },
  { base: ip4(198, 18, 0, 0), bits: 15, label: '198.18.0.0/15 (benchmarking)' },
  { base: ip4(198, 51, 100, 0), bits: 24, label: '198.51.100.0/24 (documentation)' },
  { base: ip4(203, 0, 113, 0), bits: 24, label: '203.0.113.0/24 (documentation)' },
  { base: ip4(224, 0, 0, 0), bits: 4, label: '224.0.0.0/4 (multicast)' },
  { base: ip4(240, 0, 0, 0), bits: 4, label: '240.0.0.0/4 (reserved)' },
  { base: ip4(255, 255, 255, 255), bits: 32, label: '255.255.255.255 (broadcast)' },
];

const DECIMAL_DIGITS = /^[0-9]+$/;
const OCTAL_DIGITS = /^[0-7]+$/;
const HEX_DIGITS = /^[0-9a-fA-F]+$/;

/**
 * Parses one component of an IPv4 literal using the same radix rules as
 * `inet_aton`, which is what the platform resolver ultimately applies: a `0x`
 * prefix is hex, a bare leading zero is octal, everything else is decimal.
 */
function parseIpv4Part(part: string): number | null {
  // 12 digits is the longest legal component: `037777777777` is 4294967295 in octal.
  if (part.length === 0 || part.length > 12) return null;

  let radix = 10;
  let digits = part;
  if (part.length > 2 && (part.startsWith('0x') || part.startsWith('0X'))) {
    radix = 16;
    digits = part.slice(2);
  } else if (part.length > 1 && part.startsWith('0')) {
    radix = 8;
    digits = part.slice(1);
  }

  const pattern = radix === 16 ? HEX_DIGITS : radix === 8 ? OCTAL_DIGITS : DECIMAL_DIGITS;
  if (!pattern.test(digits)) return null;

  const value = Number.parseInt(digits, radix);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * Parses every IPv4 spelling a resolver would accept — dotted quad, but also
 * the shortened (`127.1`), decimal (`2130706433`), octal (`0177.0.0.1`) and
 * hex (`0x7f000001`) forms — into a single unsigned 32-bit number.
 */
export function parseIpv4(input: string): number | null {
  if (input.length === 0 || input.endsWith('.')) return null;

  const parts = input.split('.');
  if (parts.length > 4) return null;

  const values: number[] = [];
  for (const part of parts) {
    const value = parseIpv4Part(part);
    if (value === null) return null;
    values.push(value);
  }

  const count = values.length;
  const last = values[count - 1];
  if (last === undefined) return null;

  let result = 0;
  for (let i = 0; i < count - 1; i += 1) {
    const value = values[i];
    if (value === undefined || value > 255) return null;
    result += value * 2 ** (8 * (3 - i));
  }

  // The final component absorbs whatever bytes the earlier ones did not.
  const maxLast = 2 ** (8 * (5 - count));
  if (last >= maxLast) return null;

  return (result + last) >>> 0;
}

/** Strict dotted quad, the only IPv4 form legal inside an IPv6 literal. */
function parseDottedQuad(input: string): number | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (part.length === 0 || part.length > 3 || !DECIMAL_DIGITS.test(part)) return null;
    const value = Number.parseInt(part, 10);
    if (value > 255) return null;
    result = result * 256 + value;
  }
  return result >>> 0;
}

/** The label of the first range containing `value`, or `null` when it is free. */
function blockedIpv4Range(value: number): string | null {
  for (const range of IPV4_BLOCKED) {
    if ((value & mask4(range.bits)) >>> 0 === range.base) return range.label;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* IPv6                                                                        */
/* -------------------------------------------------------------------------- */

const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

/** Parses an IPv6 literal, including embedded IPv4 tails, into a 128-bit BigInt. */
export function parseIpv6(input: string): bigint | null {
  if (input.length === 0 || input.length > 45) return null;

  // A zone id (`fe80::1%eth0`) names an interface, not a different address.
  const zone = input.indexOf('%');
  let text = zone === -1 ? input : input.slice(0, zone);
  if (!text.includes(':')) return null;

  // Rewrite a trailing dotted quad into the two hex groups it stands for, so
  // the rest of the parser only ever sees groups.
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const embedded = parseDottedQuad(tail);
    if (embedded === null) return null;
    const high = (embedded >>> 16).toString(16);
    const low = (embedded & 0xffff).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  let groups: string[];
  const compression = text.indexOf('::');
  if (compression === -1) {
    groups = text.split(':');
    if (groups.length !== 8) return null;
  } else {
    if (text.indexOf('::', compression + 1) !== -1) return null;
    const before = text.slice(0, compression);
    const after = text.slice(compression + 2);
    const head = before === '' ? [] : before.split(':');
    const rest = after === '' ? [] : after.split(':');
    const zeros = 8 - head.length - rest.length;
    // `::` must stand for at least one group of zeros.
    if (zeros < 1) return null;
    groups = [...head, ...Array<string>(zeros).fill('0'), ...rest];
  }

  let value = 0n;
  for (const group of groups) {
    if (!IPV6_GROUP.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

interface Ipv6Range {
  base: bigint;
  bits: number;
  label: string;
}

const mask6 = (bits: number): bigint => ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - bits)) - 1n);

const IPV6_BLOCKED: readonly Ipv6Range[] = [
  { base: 0n, bits: 128, label: ':: (unspecified)' },
  { base: 1n, bits: 128, label: '::1 (loopback)' },
  { base: 0xfc00n << 112n, bits: 7, label: 'fc00::/7 (unique local)' },
  { base: 0xfe80n << 112n, bits: 10, label: 'fe80::/10 (link-local)' },
  { base: 0xff00n << 112n, bits: 8, label: 'ff00::/8 (multicast)' },
  { base: 0x0100n << 112n, bits: 64, label: '100::/64 (discard-only)' },
  { base: 0x20010db8n << 96n, bits: 32, label: '2001:db8::/32 (documentation)' },
];

/**
 * /96 prefixes whose low 32 bits are a real IPv4 address. Each of these is a
 * way to write `127.0.0.1` that a naive IPv6 range check waves straight
 * through, so the embedded address is unwrapped and re-checked as IPv4.
 */
const EMBEDDED_IPV4_PREFIXES: readonly { high: bigint; label: string }[] = [
  { high: 0n, label: '::a.b.c.d (IPv4-compatible)' },
  { high: 0xffffn, label: '::ffff:a.b.c.d (IPv4-mapped)' },
  { high: 0xffff0000n, label: '::ffff:0:a.b.c.d (IPv4-translated)' },
  { high: 0x0064ff9b0000000000000000n, label: '64:ff9b::/96 (NAT64)' },
];

function blockedIpv6Range(value: bigint): string | null {
  const high96 = value >> 32n;
  for (const prefix of EMBEDDED_IPV4_PREFIXES) {
    if (high96 === prefix.high) {
      // The wrapper is only a spelling; the address that actually gets dialled
      // is the IPv4 one in the low 32 bits, so that is what decides the verdict.
      const embedded = blockedIpv4Range(Number(value & 0xffffffffn));
      return embedded === null ? null : `${prefix.label} wrapping ${embedded}`;
    }
  }
  for (const range of IPV6_BLOCKED) {
    if ((value & mask6(range.bits)) === range.base) return range.label;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Address and hostname checks                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Names the reserved range `ip` falls in, or `null` when the address is free to
 * dial. A string that is not an IP literal at all is not "blocked" — hostnames
 * are the business of `checkHostnameLiteral` and the resolver.
 *
 * The label is carried out to the denial message so an operator can tell a
 * misconfigured private URL apart from an actual rebinding attempt.
 */
export function blockedRangeFor(ip: string): string | null {
  const candidate = stripBrackets(ip.trim());

  const v4 = parseIpv4(candidate);
  if (v4 !== null) return blockedIpv4Range(v4);

  const v6 = parseIpv6(candidate);
  if (v6 !== null) return blockedIpv6Range(v6);

  return null;
}

/** True when `ip` is a literal address in a range that must never be dialled. */
export function isBlockedAddress(ip: string): boolean {
  return blockedRangeFor(ip) !== null;
}

/** True when the string is any IP literal, blocked or not. */
export function isIpLiteral(value: string): boolean {
  const candidate = stripBrackets(value.trim());
  return parseIpv4(candidate) !== null || parseIpv6(candidate) !== null;
}

function stripBrackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

/** Names that always mean "somewhere inside this machine or this network". */
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa'];

function normaliseHostname(hostname: string): string {
  const withoutBrackets = stripBrackets(hostname.trim()).toLowerCase();
  // A fully-qualified name may carry a trailing root dot; it addresses the same host.
  return withoutBrackets.endsWith('.') ? withoutBrackets.slice(0, -1) : withoutBrackets;
}

function deny(code: SsrfDenyCode, reason: string): UrlVerdict {
  return { allowed: false, code, reason };
}

/**
 * Checks a hostname on its own, before any resolution. Returns `null` when
 * nothing about the literal itself is disqualifying — that is not an approval,
 * only the absence of an objection.
 */
export function checkHostnameLiteral(hostname: string, policy: SsrfPolicy): UrlVerdict | null {
  const host = normaliseHostname(hostname);

  // An empty host is malformed regardless of how permissive the policy is.
  if (host.length === 0) {
    return deny('blocked_hostname', 'The URL has no hostname.');
  }

  if (policy.allowPrivateNetwork) return null;

  if (BLOCKED_HOSTNAMES.has(host) || BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return deny(
      'blocked_hostname',
      `Hostname "${host}" names a local or internal service, which this deployment may not reach.`,
    );
  }

  const literalRange = blockedRangeFor(host);
  if (literalRange !== null) {
    return deny('blocked_ip', `Hostname "${host}" is a literal address in ${literalRange}.`);
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* The URL check                                                               */
/* -------------------------------------------------------------------------- */

const DEFAULT_ALLOWED_PROTOCOLS = ['https:', 'http:'];

/** Implicit port per protocol, for URLs that do not spell one out. */
const DEFAULT_PORTS = new Map<string, number>([
  ['http:', 80],
  ['https:', 443],
  ['ws:', 80],
  ['wss:', 443],
]);

/**
 * Well-known ports below 1024 are almost all infrastructure — SSH, SMTP, the
 * Redis and Postgres defaults sit above it but every classic protocol-smuggling
 * target sits below. Only the two HTTP ports are worth the exception.
 */
function isAllowedPort(port: number): boolean {
  return port === 80 || port === 443 || (port >= 1024 && port <= 65535);
}

const defaultLookup: DnsLookupFn = (hostname, options) => nodeLookup(hostname, options);

/**
 * The one function callers should reach for. Resolves the hostname and refuses
 * the URL if any address behind it is one we must not dial.
 */
export async function assertUrlAllowed(
  rawUrl: string,
  policy: SsrfPolicy,
  options: AssertUrlOptions = {},
): Promise<UrlVerdict> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return deny('invalid_url', 'The server URL could not be parsed.');
  }

  const protocol = url.protocol.toLowerCase();
  const allowedProtocols = policy.allowedProtocols ?? DEFAULT_ALLOWED_PROTOCOLS;
  if (!allowedProtocols.some((allowed) => allowed.toLowerCase() === protocol)) {
    return deny(
      'protocol_not_allowed',
      `Protocol "${protocol}" is not allowed; use ${allowedProtocols.join(' or ')}.`,
    );
  }

  // Credentials in the URL get replayed to whatever the host turns out to be,
  // and they end up in logs and error messages. Refuse them outright.
  if (url.username !== '' || url.password !== '') {
    return deny(
      'credentials_in_url',
      'The server URL contains a username or password. Send credentials as headers instead.',
    );
  }

  const port = url.port === '' ? DEFAULT_PORTS.get(protocol) : Number.parseInt(url.port, 10);
  if (port !== undefined && (!Number.isInteger(port) || !isAllowedPort(port))) {
    return deny(
      'port_not_allowed',
      `Port ${url.port === '' ? String(port) : url.port} is not allowed; use 80, 443 or a port at or above 1024.`,
    );
  }

  const literalVerdict = checkHostnameLiteral(url.hostname, policy);
  if (literalVerdict !== null) return literalVerdict;

  const hostname = normaliseHostname(url.hostname);

  // A literal address has already been through `isBlockedAddress`; a resolver
  // would only hand the same string back.
  if (isIpLiteral(hostname)) {
    return { allowed: true, url, resolvedAddresses: [hostname] };
  }

  if (policy.allowPrivateNetwork) {
    // Nothing left to enforce, so do not make local development depend on a
    // resolver being reachable.
    return { allowed: true, url, resolvedAddresses: [] };
  }

  const lookup = options.lookup ?? defaultLookup;
  let records: DnsLookupResult[];
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return deny('dns_resolution_failed', `Hostname "${hostname}" could not be resolved.`);
  }

  if (!Array.isArray(records) || records.length === 0) {
    return deny('dns_resolution_failed', `Hostname "${hostname}" resolved to no addresses.`);
  }

  const resolvedAddresses: string[] = [];
  for (const record of records) {
    const address = typeof record?.address === 'string' ? record.address : '';
    // Anything the resolver returns that is not parseable as an address is
    // treated as hostile rather than ignored.
    if (!isIpLiteral(address)) {
      return deny(
        'blocked_ip',
        `Hostname "${hostname}" resolved to an address that could not be parsed.`,
      );
    }
    const range = blockedRangeFor(address);
    if (range !== null) {
      return deny(
        'blocked_ip',
        `Hostname "${hostname}" resolves to ${address}, which is in ${range}.`,
      );
    }
    resolvedAddresses.push(address);
  }

  return { allowed: true, url, resolvedAddresses };
}
