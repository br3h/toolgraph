import 'server-only';

/**
 * On-chain payment verification.
 *
 * A user tells us a transaction hash. This module goes and looks. Nothing a
 * user says about their payment is taken on trust — not the amount, not the
 * recipient, not whether it happened.
 *
 * Server-side only, and keyless: Blockstream's public API for Bitcoin, a public
 * JSON-RPC node for Ethereum. No credentials to leak, and no account whose
 * expiry silently breaks billing.
 *
 * Two decisions shape the whole file.
 *
 * `retryable` is the difference between "come back in a minute" and "this will
 * never work". A transaction that has not reached the node yet, a node that is
 * down, a Bitcoin transaction still in the mempool — all retryable, and the UI
 * says wait. A hash that pays somebody else's address, a failed transaction, a
 * malformed hash — not retryable, and the UI says so plainly. Getting this
 * backwards means either telling someone their real payment is invalid, or
 * spinning forever on one that never was.
 *
 * And this module does not judge the amount. It reports what the chain said and
 * stops. Sufficiency is compared against the live price by the caller, above
 * both this module and `./price`, so that a price-feed outage can never quietly
 * reject a payment that actually arrived.
 */

import { getPaymentAddress, type CryptoCurrency } from './plan';
import { getUsdRate } from './price';

export type VerificationOutcome =
  | { ok: true; amount: string; usdValue: number | null }
  | { ok: false; reason: string; retryable: boolean };

export interface VerifyPaymentOptions {
  /** Injected by tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                   */
/* -------------------------------------------------------------------------- */

const BLOCKSTREAM_TX_URL = 'https://blockstream.info/api/tx/';
const ETHEREUM_RPC_URL = 'https://ethereum-rpc.publicnode.com';

/** Tether on Ethereum mainnet. Any other contract is a different token. */
const USDT_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

/** keccak256('Transfer(address,address,uint256)'). */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const BTC_DECIMALS = 8;
const ETH_DECIMALS = 18;
/**
 * USDT has SIX decimals, not the eighteen that most ERC-20 tokens use. Dividing
 * by 1e18 here would make every real payment look a million times too small and
 * every genuine subscriber would be told they underpaid.
 */
const USDT_DECIMALS = 6;

const ETHEREUM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const BITCOIN_TX_ID = /^[0-9a-fA-F]{64}$/;

const REQUEST_TIMEOUT_MS = 6_000;

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

function fail(reason: string, retryable: boolean): VerificationOutcome {
  return { ok: false, reason, retryable };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? (value as unknown[]) : null;
}

/**
 * Exact decimal string from a base-unit integer.
 *
 * BigInt in and string out, with no float anywhere between: 0.1 has no exact
 * binary representation, and an amount that has been through a double is an
 * amount that has been rounded. This value is compared against a price and
 * written to the audit trail, so it stays exact.
 */
function formatUnits(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals).replace(/0+$/, '');
  const sign = negative ? '-' : '';
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`;
}

/** Parses a `0x`-prefixed quantity. Returns null for anything else. */
function hexToBigInt(value: unknown): bigint | null {
  if (typeof value !== 'string') return null;
  if (!/^0x[0-9a-fA-F]*$/.test(value)) return null;
  if (value.length === 2) return 0n; // bare '0x', which BigInt() rejects
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Ethereum addresses are compared case-insensitively.
 *
 * EIP-55 encodes a checksum in the *capitalisation* of the hex digits, so the
 * same address is written several ways depending on which wallet or node
 * produced it. A case-sensitive compare would reject perfectly valid payments
 * from every client that does not happen to match our own spelling.
 */
function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** An address as it appears in a 32-byte indexed log topic: left-padded. */
function topicForAddress(address: string): string {
  return `0x${address.replace(/^0x/i, '').toLowerCase().padStart(64, '0')}`;
}

/**
 * Bech32 addresses are compared case-insensitively too. Blockstream returns
 * them lowercase, but the encoding permits an all-uppercase rendering, and a
 * literal compare against one would silently miss a real payment.
 */
function sameBitcoinAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/* -------------------------------------------------------------------------- */
/* Transport                                                                   */
/* -------------------------------------------------------------------------- */

type FetchResult =
  | { kind: 'json'; body: unknown }
  /** The chain does not know this transaction — yet, or ever. Retryable. */
  | { kind: 'notFound' }
  /** We could not ask. Says nothing about the transaction. Retryable. */
  | { kind: 'unavailable' };

async function requestJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });

    if (response.status === 404) return { kind: 'notFound' };
    // Every other non-2xx is treated as "we could not ask", including a 429.
    // The safe direction is retryable: a rate limit must never be reported to a
    // user as their payment being invalid.
    if (!response.ok) return { kind: 'unavailable' };

    return { kind: 'json', body: (await response.json()) as unknown };
  } catch {
    // Abort, DNS, TLS, connection reset, a body that is not JSON.
    return { kind: 'unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

/** One JSON-RPC call. `result: null` is surfaced as `notFound`. */
async function rpcCall(
  method: string,
  params: readonly string[],
  fetchImpl: typeof fetch,
): Promise<FetchResult> {
  const result = await requestJson(
    ETHEREUM_RPC_URL,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    fetchImpl,
  );

  if (result.kind !== 'json') return result;

  const envelope = asRecord(result.body);
  if (!envelope) return { kind: 'unavailable' };
  // A JSON-RPC error is a fault on our side of the conversation, not a verdict
  // about the transaction, so it must not be reported as a bad payment.
  if (envelope.error != null) return { kind: 'unavailable' };
  if (envelope.result == null) return { kind: 'notFound' };

  return { kind: 'json', body: envelope.result };
}

/* -------------------------------------------------------------------------- */
/* Wording                                                                     */
/* -------------------------------------------------------------------------- */

const NOT_SEEN_YET =
  'That transaction has not reached the network yet. If you have just sent it, wait a moment and check again.';

const NODE_UNREACHABLE =
  'The blockchain could not be reached just now. Your payment is unaffected — check again shortly.';

const UNREADABLE_RESPONSE =
  'The blockchain returned a response we could not read. Check again shortly.';

/* -------------------------------------------------------------------------- */
/* Bitcoin                                                                     */
/* -------------------------------------------------------------------------- */

async function verifyBitcoin(
  txHash: string,
  fetchImpl: typeof fetch,
): Promise<VerificationOutcome> {
  const { address } = getPaymentAddress('BTC');

  const result = await requestJson(
    `${BLOCKSTREAM_TX_URL}${txHash}`,
    { method: 'GET', headers: { accept: 'application/json' } },
    fetchImpl,
  );

  if (result.kind === 'notFound') return fail(NOT_SEEN_YET, true);
  if (result.kind === 'unavailable') return fail(NODE_UNREACHABLE, true);

  const tx = asRecord(result.body);
  const outputs = tx ? asArray(tx.vout) : null;
  if (!tx || !outputs) return fail(UNREADABLE_RESPONSE, true);

  // Summed rather than taken from the first match: one transaction may pay the
  // same address in several outputs, and counting only one would under-report a
  // payment that was in fact large enough.
  let satoshis = 0n;
  let paysUs = false;
  for (const entry of outputs) {
    const out = asRecord(entry);
    if (!out) continue;
    const recipient = out.scriptpubkey_address;
    if (typeof recipient !== 'string' || !sameBitcoinAddress(recipient, address)) continue;

    paysUs = true;
    const value = out.value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      satoshis += BigInt(value);
    }
  }

  if (!paysUs) {
    return fail(
      'That transaction does not pay the Bitcoin address shown on this page. Check that you copied the right transaction id.',
      false,
    );
  }

  // Checked after the recipient because an unconfirmed transaction to the wrong
  // address is permanently wrong, not merely early.
  const status = asRecord(tx.status);
  if (!status || status.confirmed !== true) {
    return fail(
      'That transaction has not been confirmed yet. It is in the mempool — check again once it has been included in a block.',
      true,
    );
  }

  return { ok: true, amount: formatUnits(satoshis, BTC_DECIMALS), usdValue: null };
}

/* -------------------------------------------------------------------------- */
/* Ether                                                                       */
/* -------------------------------------------------------------------------- */

async function verifyEther(txHash: string, fetchImpl: typeof fetch): Promise<VerificationOutcome> {
  const { address } = getPaymentAddress('ETH');

  const result = await rpcCall('eth_getTransactionByHash', [txHash], fetchImpl);
  if (result.kind === 'notFound') return fail(NOT_SEEN_YET, true);
  if (result.kind === 'unavailable') return fail(NODE_UNREACHABLE, true);

  const tx = asRecord(result.body);
  if (!tx) return fail(UNREADABLE_RESPONSE, true);

  // `to` is null for a contract creation, which pays nobody.
  const to = tx.to;
  if (typeof to !== 'string' || !sameAddress(to, address)) {
    return fail(
      'That transaction does not pay the Ethereum address shown on this page. Check that you copied the right hash.',
      false,
    );
  }

  // A transaction with no block is still in the mempool. It can be replaced or
  // dropped, so it is not a payment — but it very likely will be, so it is
  // retryable rather than a rejection.
  if (tx.blockNumber == null) {
    return fail(
      'That transaction is still pending — it has not been included in a block yet. Check again in a minute.',
      true,
    );
  }

  const wei = hexToBigInt(tx.value);
  if (wei === null) return fail(UNREADABLE_RESPONSE, true);

  return { ok: true, amount: formatUnits(wei, ETH_DECIMALS), usdValue: null };
}

/* -------------------------------------------------------------------------- */
/* USDT                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A USDT payment moves no ether, so there is nothing to read off the
 * transaction itself. The evidence is a Transfer event in the receipt, and all
 * three parts of it have to line up: the log must come from the USDT contract,
 * its first topic must be the Transfer signature, and its third topic — the
 * indexed recipient — must be our address.
 */
async function verifyUsdt(txHash: string, fetchImpl: typeof fetch): Promise<VerificationOutcome> {
  const { address } = getPaymentAddress('USDT');

  const result = await rpcCall('eth_getTransactionReceipt', [txHash], fetchImpl);
  if (result.kind === 'notFound') return fail(NOT_SEEN_YET, true);
  if (result.kind === 'unavailable') return fail(NODE_UNREACHABLE, true);

  const receipt = asRecord(result.body);
  if (!receipt) return fail(UNREADABLE_RESPONSE, true);

  // Parsed rather than compared to the literal '0x1' so a node that pads to
  // '0x01' is still read correctly. A reverted transaction moved nothing, and
  // no amount of waiting changes that.
  if (hexToBigInt(receipt.status) !== 1n) {
    return fail(
      'That transaction failed on chain, so no USDT was transferred. Nothing was taken from your wallet beyond the gas fee.',
      false,
    );
  }

  const logs = asArray(receipt.logs);
  if (!logs) return fail(UNREADABLE_RESPONSE, true);

  const recipientTopic = topicForAddress(address);

  let units = 0n;
  let matched = false;
  let transferFromAnotherToken = false;

  for (const entry of logs) {
    const log = asRecord(entry);
    if (!log) continue;

    const topics = asArray(log.topics) ?? [];
    const signature = topics[0];
    if (typeof signature !== 'string' || signature.toLowerCase() !== TRANSFER_TOPIC) continue;

    const contract = log.address;
    if (typeof contract !== 'string' || !sameAddress(contract, USDT_CONTRACT)) {
      // A Transfer from some other contract. Worth distinguishing, because
      // sending the wrong stablecoin is a mistake people actually make.
      transferFromAnotherToken = true;
      continue;
    }

    const recipient = topics[2];
    if (typeof recipient !== 'string' || recipient.toLowerCase() !== recipientTopic) continue;

    // `matched` is tracked separately from `units` so that a genuine transfer of
    // zero is reported as a zero payment rather than as the wrong recipient.
    matched = true;
    units += hexToBigInt(log.data) ?? 0n;
  }

  if (!matched) {
    return fail(
      transferFromAnotherToken
        ? 'That transaction transfers a token, but not USDT on Ethereum mainnet. USDT sent on another network, or a different stablecoin, cannot be credited here.'
        : 'That transaction does not transfer USDT to the address shown on this page. Check that you copied the right hash, and that you sent ERC-20 USDT on Ethereum mainnet.',
      false,
    );
  }

  return { ok: true, amount: formatUnits(units, USDT_DECIMALS), usdValue: null };
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Best-effort USD value of a verified amount, for the audit trail.
 *
 * Informational only. It never gates the outcome — a price feed that is down
 * leaves this null and the payment still verifies.
 */
async function usdValueOf(
  currency: CryptoCurrency,
  amount: string,
  fetchImpl: typeof fetch | undefined,
): Promise<number | null> {
  const rate = await getUsdRate(currency, { fetchImpl });
  if (rate === null) return null;

  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return null;

  return numeric * rate;
}

/**
 * Verifies that `txHash` is a real, settled payment to our address on the chain
 * `currency` belongs to.
 *
 * Reports the amount the chain says arrived. Says nothing about whether that
 * amount is enough — see the note at the top of the file.
 */
export async function verifyPayment(
  currency: CryptoCurrency,
  txHash: string,
  opts?: VerifyPaymentOptions,
): Promise<VerificationOutcome> {
  const fetchImpl = opts?.fetchImpl ?? globalThis.fetch;
  const hash = txHash.trim();

  // The shape is checked before anything leaves the process. A malformed hash
  // is the user's typo, answerable without a request, and refusing to forward
  // it keeps arbitrary user input out of a URL we build.
  let outcome: VerificationOutcome;

  if (currency === 'BTC') {
    if (!BITCOIN_TX_ID.test(hash)) {
      return fail(
        'That is not a Bitcoin transaction id. It should be 64 hexadecimal characters with no 0x prefix.',
        false,
      );
    }
    outcome = await verifyBitcoin(hash, fetchImpl);
  } else {
    if (!ETHEREUM_TX_HASH.test(hash)) {
      return fail(
        'That is not an Ethereum transaction hash. It should be 0x followed by 64 hexadecimal characters.',
        false,
      );
    }
    outcome =
      currency === 'ETH' ? await verifyEther(hash, fetchImpl) : await verifyUsdt(hash, fetchImpl);
  }

  if (!outcome.ok) return outcome;

  return {
    ok: true,
    amount: outcome.amount,
    usdValue: await usdValueOf(currency, outcome.amount, opts?.fetchImpl),
  };
}
