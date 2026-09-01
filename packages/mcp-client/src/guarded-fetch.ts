/**
 * A `fetch` that re-runs the SSRF guard on every hop, including redirects.
 *
 * Vetting the URL once before the transport is built is not sufficient on its
 * own. Two holes remain, and both are reachable by anyone who can name a server:
 *
 *  - **Redirects.** The attacker's own server answers the first request with
 *    `302 Location: http://169.254.169.254/latest/meta-data/`. The platform
 *    `fetch` follows that silently and hands the metadata document back to the
 *    MCP layer, which surfaces it to the user. So redirects are followed here,
 *    by hand, with the guard applied to every target.
 *  - **DNS rebinding.** The name that resolved to a public address during the
 *    pre-flight check resolves to a loopback address by the time the request
 *    goes out. Re-checking per request narrows that window to the gap between
 *    our resolution and the platform's, which is as far as a userland client
 *    can close it without pinning the socket to an address.
 */

import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { assertUrlAllowed, type DnsLookupFn, type SsrfDenyCode, type SsrfPolicy } from './ssrf';

/** Thrown when the guard refuses a URL. Carries the machine-readable code. */
export class SsrfBlockedError extends Error {
  readonly code: SsrfDenyCode;

  constructor(code: SsrfDenyCode, reason: string) {
    super(reason);
    this.name = 'SsrfBlockedError';
    this.code = code;
  }
}

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface GuardedFetchOptions {
  policy: SsrfPolicy;
  lookup?: DnsLookupFn;
  /** Overridable for tests; defaults to the platform `fetch`. */
  fetchImpl?: typeof fetch;
}

/** Runs the guard and throws `SsrfBlockedError` on a denial. */
export async function requireUrlAllowed(
  rawUrl: string,
  policy: SsrfPolicy,
  lookup?: DnsLookupFn,
): Promise<URL> {
  const verdict = await assertUrlAllowed(rawUrl, policy, lookup ? { lookup } : {});
  if (!verdict.allowed) throw new SsrfBlockedError(verdict.code, verdict.reason);
  return verdict.url;
}

export function createGuardedFetch(options: GuardedFetchOptions): FetchLike {
  const { policy, lookup } = options;
  const impl = options.fetchImpl ?? fetch;

  return async (input, init) => {
    let target = typeof input === 'string' ? input : input.href;
    let method = init?.method ?? 'GET';
    let body = init?.body;

    for (let hop = 0; ; hop += 1) {
      const url = await requireUrlAllowed(target, policy, lookup);

      const response = await impl(url, {
        ...init,
        method,
        ...(body === undefined ? {} : { body }),
        // Redirects are followed below so that each target goes through the
        // guard; handing them to the platform would skip it.
        redirect: 'manual',
      });

      const location = REDIRECT_STATUSES.has(response.status)
        ? response.headers.get('location')
        : null;
      if (location === null) return response;

      if (init?.redirect === 'error') {
        throw new Error(`The server at ${url.host} redirected, which this request does not allow.`);
      }
      if (hop >= MAX_REDIRECTS) {
        throw new Error(`The server at ${url.host} redirected more than ${MAX_REDIRECTS} times.`);
      }

      // 303 always becomes a GET; 301 and 302 do too for anything but GET/HEAD,
      // which is what every user agent does in practice. 307 and 308 preserve
      // the method and body.
      if (
        response.status === 303 ||
        (response.status < 303 && method !== 'GET' && method !== 'HEAD')
      ) {
        method = 'GET';
        body = undefined;
      }

      try {
        target = new URL(location, url).href;
      } catch {
        throw new Error(`The server at ${url.host} sent an unparseable redirect target.`);
      }
    }
  };
}
