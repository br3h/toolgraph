/**
 * Live crypto prices, for turning $15 into an amount to send.
 *
 * CoinGecko's keyless endpoint, cached in-module for ten minutes and abandoned
 * after six seconds. Every failure path returns null and none of them throws.
 *
 * That is the whole contract, and it is deliberate: the caller must degrade
 * rather than guess. A stale or invented rate shown next to a payment address
 * is a user sending the wrong amount of money, so when we do not know the
 * price, we say so and show the address without a figure.
 *
 * Nothing here decides whether a payment was sufficient. Verification reads the
 * chain (`./verify`) and the comparison happens above both modules, so a price
 * outage can never cause a real payment to be rejected.
 */

import type { CryptoCurrency } from './plan';

const ENDPOINT =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin,tether&vs_currencies=usd';

const CACHE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 6_000;

/** CoinGecko's ids for the three assets we take. */
const COINGECKO_IDS: Record<CryptoCurrency, string> = {
  ETH: 'ethereum',
  BTC: 'bitcoin',
  USDT: 'tether',
};

export interface CryptoAmount {
  /** How much of `currency` to send. */
  amount: number;
  /** The USD price of one unit that `amount` was derived from. */
  rateUsd: number;
}

export interface PriceFetchOptions {
  /** Injected in tests. When set, the result is not cached — see below. */
  fetchImpl?: typeof fetch;
}

type Rates = Partial<Record<CryptoCurrency, number>>;

let cache: { at: number; rates: Rates } | null = null;

/**
 * Collapses concurrent misses onto one request. Three currencies rendered on
 * one page would otherwise open three identical connections on a cold cache.
 */
let inFlight: Promise<Rates | null> | null = null;

function isFreshRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Reads `{ ethereum: { usd: 1234.5 }, ... }` without trusting any of it. */
function parseRates(body: unknown): Rates | null {
  if (typeof body !== 'object' || body === null) return null;
  const root = body as Record<string, unknown>;

  const rates: Rates = {};
  for (const currency of Object.keys(COINGECKO_IDS) as CryptoCurrency[]) {
    const entry = root[COINGECKO_IDS[currency]];
    if (typeof entry !== 'object' || entry === null) continue;
    const usd = (entry as Record<string, unknown>).usd;
    if (isFreshRate(usd)) rates[currency] = usd;
  }

  // A response that parsed but carried no usable rate is a failure, not an
  // empty success — caching it would suppress retries for ten minutes.
  return Object.keys(rates).length > 0 ? rates : null;
}

async function requestRates(fetchImpl: typeof fetch): Promise<Rates | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetchImpl(ENDPOINT, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return parseRates(await response.json());
  } catch {
    // Timeout, DNS, TLS, rate limit, malformed JSON. All the same to the
    // caller: we do not know the price.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getRates(options?: PriceFetchOptions): Promise<Rates | null> {
  const injected = options?.fetchImpl;

  // An injected fetch never reads or writes the module cache. A test stub must
  // not be able to leave a fabricated rate behind for production code to serve,
  // and a cached real rate must not make a test silently skip its own stub.
  if (injected) return requestRates(injected);

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rates;

  inFlight ??= requestRates(globalThis.fetch)
    .then((rates) => {
      if (rates) cache = { at: Date.now(), rates };
      return rates;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * The USD price of one unit of `currency`, or null when it is not known.
 *
 * Exposed separately from `getCryptoAmountForUsd` so verification can record
 * what a received amount was worth without inverting a division.
 */
export async function getUsdRate(
  currency: CryptoCurrency,
  options?: PriceFetchOptions,
): Promise<number | null> {
  const rates = await getRates(options);
  const rate = rates?.[currency];
  return isFreshRate(rate) ? rate : null;
}

/**
 * How much of `currency` is worth `usd` right now, or null if we cannot say.
 *
 * Null is a normal outcome, not an exception: CoinGecko rate-limits keyless
 * callers and the caller is expected to render the address without an amount.
 */
export async function getCryptoAmountForUsd(
  currency: CryptoCurrency,
  usd: number,
  options?: PriceFetchOptions,
): Promise<CryptoAmount | null> {
  if (!Number.isFinite(usd) || usd <= 0) return null;

  const rateUsd = await getUsdRate(currency, options);
  if (rateUsd === null) return null;

  return { amount: usd / rateUsd, rateUsd };
}

/** Drops the cached rates. For tests and for an admin-triggered refresh. */
export function clearPriceCache(): void {
  cache = null;
  inFlight = null;
}
