/**
 * `@toolgraph/mcp-client` — every outbound MCP connection toolgraph makes.
 *
 * Nothing else in the monorepo talks to a third-party server directly. Routing
 * it all through here means the SSRF guard and the timeouts are not something a
 * caller can forget to apply.
 */

export {
  connectMcpServer,
  introspectServer,
  McpClientError,
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  type ConnectedMcpClient,
  type ConnectOptions,
  type McpClientErrorCode,
} from './client';

export {
  createGuardedFetch,
  requireUrlAllowed,
  SsrfBlockedError,
  type GuardedFetchOptions,
} from './guarded-fetch';

export {
  assertUrlAllowed,
  blockedRangeFor,
  checkHostnameLiteral,
  isBlockedAddress,
  isIpLiteral,
  parseIpv4,
  parseIpv6,
  type AssertUrlOptions,
  type DnsLookupFn,
  type DnsLookupResult,
  type SsrfDenyCode,
  type SsrfPolicy,
  type UrlVerdict,
} from './ssrf';

export {
  DEFAULT_CONNECT_TIMEOUT_MS,
  DEFAULT_TOOL_CALL_TIMEOUT_MS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  TimeoutError,
  withTimeout,
} from './timeouts';
