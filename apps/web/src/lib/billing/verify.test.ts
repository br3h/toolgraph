/**
 * Verification tests.
 *
 * Every one of these injects `fetchImpl`. Nothing here touches the network:
 * the stub throws on any URL a test did not explicitly account for, so a
 * request that escapes to a real node fails the test rather than passing it
 * slowly and flakily.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { clearPriceCache } from './price';
import { verifyPayment } from './verify';

const ETH_ADDRESS = '0xD0AD4519F1525314924836C41FD0F2744Cf63e59';
const BTC_ADDRESS = 'bc1qs5mzd7lrjwr6u34r7ucqlxtn6n5959nt6kq6uu';
const USDT_CONTRACT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const OTHER_ETH_ADDRESS = '0x1111111111111111111111111111111111111111';
/** Real contract, wrong token: USDC, which has 6 decimals like USDT. */
const USDC_CONTRACT = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const ETH_HASH = `0x${'ab'.repeat(32)}`;
const BTC_TXID = 'cd'.repeat(32);

const BLOCKSTREAM = 'https://blockstream.info/api/tx/';
const RPC = 'https://ethereum-rpc.publicnode.com';
const COINGECKO = 'https://api.coingecko.com/';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** A JSON-RPC quantity: minimal hex. */
const quantity = (value: bigint) => `0x${value.toString(16)}`;
/** A 32-byte ABI word: left-padded hex. */
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
/** An address as it appears in an indexed log topic. */
const addressTopic = (address: string) => `0x${address.slice(2).toLowerCase().padStart(64, '0')}`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const rpcResult = (result: unknown) => json({ jsonrpc: '2.0', id: 1, result });

interface Stubs {
  btc?: () => Response;
  rpc?: (method: string) => Response;
  /** Defaults to a price feed that is down, so usdValue comes back null. */
  price?: () => Response;
}

function createFetch(stubs: Stubs) {
  const calls: { url: string; method: string | null }[] = [];

  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    const parsedBody =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as { method?: string }) : null;
    calls.push({ url, method: parsedBody?.method ?? null });

    if (url.startsWith(COINGECKO)) return stubs.price?.() ?? json({}, 503);

    if (url.startsWith(BLOCKSTREAM)) {
      if (!stubs.btc) throw new Error(`unexpected Bitcoin request: ${url}`);
      return stubs.btc();
    }

    if (url === RPC) {
      if (!stubs.rpc) throw new Error('unexpected Ethereum RPC request');
      return stubs.rpc(parsedBody?.method ?? '');
    }

    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;

  return { impl, calls };
}

const btcTx = (outputs: { scriptpubkey_address: string; value: number }[], confirmed = true) => ({
  txid: BTC_TXID,
  status: { confirmed, block_height: confirmed ? 800_000 : null },
  vout: outputs,
});

const transferLog = (contract: string, to: string, units: bigint) => ({
  address: contract,
  topics: [TRANSFER_TOPIC, addressTopic(OTHER_ETH_ADDRESS), addressTopic(to)],
  data: word(units),
});

beforeEach(() => {
  // The price cache is module state; a rate cached by one test must not leak
  // into the next one's expectations.
  clearPriceCache();
});

/* -------------------------------------------------------------------------- */
/* Bitcoin                                                                     */
/* -------------------------------------------------------------------------- */

describe('verifyPayment — BTC', () => {
  it('accepts a confirmed transaction paying the Bitcoin address', async () => {
    const { impl, calls } = createFetch({
      btc: () => json(btcTx([{ scriptpubkey_address: BTC_ADDRESS, value: 42_000 }])),
    });

    const outcome = await verifyPayment('BTC', BTC_TXID, { fetchImpl: impl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    // 42,000 satoshis is 0.00042 BTC — eight decimals, trailing zeros trimmed.
    expect(outcome.amount).toBe('0.00042');
    expect(outcome.usdValue).toBeNull();
    expect(calls[0]?.url).toBe(`${BLOCKSTREAM}${BTC_TXID}`);
  });

  it('sums every output that pays us, not just the first', async () => {
    const { impl } = createFetch({
      btc: () =>
        json(
          btcTx([
            { scriptpubkey_address: BTC_ADDRESS, value: 42_000 },
            { scriptpubkey_address: OTHER_ETH_ADDRESS, value: 999_999 },
            { scriptpubkey_address: BTC_ADDRESS, value: 63_000 },
          ]),
        ),
    });

    const outcome = await verifyPayment('BTC', BTC_TXID, { fetchImpl: impl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.amount).toBe('0.00105');
  });

  it('rejects a transaction that pays a different address, and does not offer a retry', async () => {
    const { impl } = createFetch({
      btc: () =>
        json(
          btcTx([
            { scriptpubkey_address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', value: 500_000 },
          ]),
        ),
    });

    const outcome = await verifyPayment('BTC', BTC_TXID, { fetchImpl: impl });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('a payment to another address must not verify');
    expect(outcome.retryable).toBe(false);
    expect(outcome.reason).toContain('Bitcoin address');
  });

  it('rejects an unconfirmed transaction but marks it retryable', async () => {
    const { impl } = createFetch({
      btc: () => json(btcTx([{ scriptpubkey_address: BTC_ADDRESS, value: 42_000 }], false)),
    });

    const outcome = await verifyPayment('BTC', BTC_TXID, { fetchImpl: impl });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('an unconfirmed transaction is not a payment');
    expect(outcome.retryable).toBe(true);
    expect(outcome.reason).toContain('confirmed');
  });

  it('treats an unknown transaction as not indexed yet', async () => {
    const { impl } = createFetch({
      btc: () => new Response('Transaction not found', { status: 404 }),
    });

    const outcome = await verifyPayment('BTC', BTC_TXID, { fetchImpl: impl });

    expect(outcome).toMatchObject({ ok: false, retryable: true });
  });
});

/* -------------------------------------------------------------------------- */
/* Ether                                                                       */
/* -------------------------------------------------------------------------- */

describe('verifyPayment — ETH', () => {
  const minedTx = (to: string, wei: bigint) => ({
    to,
    value: quantity(wei),
    blockNumber: '0x1234',
  });

  it('accepts a mined transaction paying the Ethereum address', async () => {
    const { impl, calls } = createFetch({
      rpc: () => rpcResult(minedTx(ETH_ADDRESS, 5_000_000_000_000_000n)),
    });

    const outcome = await verifyPayment('ETH', ETH_HASH, { fetchImpl: impl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    // 5e15 wei is 0.005 ETH at eighteen decimals.
    expect(outcome.amount).toBe('0.005');
    expect(calls[0]?.method).toBe('eth_getTransactionByHash');
  });

  it('matches the recipient case-insensitively, since EIP-55 capitalisation varies', async () => {
    for (const spelling of [
      ETH_ADDRESS.toLowerCase(),
      `0x${ETH_ADDRESS.slice(2).toUpperCase()}`,
      ETH_ADDRESS,
    ]) {
      const { impl } = createFetch({ rpc: () => rpcResult(minedTx(spelling, 10n ** 18n)) });

      const outcome = await verifyPayment('ETH', ETH_HASH, { fetchImpl: impl });

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error(`${spelling} was rejected: ${outcome.reason}`);
      expect(outcome.amount).toBe('1');
    }
  });

  it('reports the USD value when a live rate is available', async () => {
    const { impl } = createFetch({
      rpc: () => rpcResult(minedTx(ETH_ADDRESS, 5_000_000_000_000_000n)),
      price: () => json({ ethereum: { usd: 4000 }, bitcoin: { usd: 60000 }, tether: { usd: 1 } }),
    });

    const outcome = await verifyPayment('ETH', ETH_HASH, { fetchImpl: impl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.usdValue).toBeCloseTo(20, 6);
  });

  it('rejects a transaction paying someone else', async () => {
    const { impl } = createFetch({
      rpc: () => rpcResult(minedTx(OTHER_ETH_ADDRESS, 10n ** 18n)),
    });

    const outcome = await verifyPayment('ETH', ETH_HASH, { fetchImpl: impl });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('a payment to another address must not verify');
    expect(outcome.retryable).toBe(false);
    expect(outcome.reason).toContain('Ethereum address');
  });

  it('rejects a pending transaction with a null blockNumber, and marks it retryable', async () => {
    const { impl } = createFetch({
      rpc: () => rpcResult({ to: ETH_ADDRESS, value: quantity(10n ** 18n), blockNumber: null }),
    });

    const outcome = await verifyPayment('ETH', ETH_HASH, { fetchImpl: impl });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('a mempool transaction is not a payment');
    expect(outcome.retryable).toBe(true);
    expect(outcome.reason).toContain('pending');
  });

  it('treats an unknown hash as not seen yet', async () => {
    const { impl } = createFetch({ rpc: () => rpcResult(null) });

    const outcome = await verifyPayment('ETH', ETH_HASH, { fetchImpl: impl });

    expect(outcome).toMatchObject({ ok: false, retryable: true });
  });
});

/* -------------------------------------------------------------------------- */
/* USDT                                                                        */
/* -------------------------------------------------------------------------- */

describe('verifyPayment — USDT', () => {
  const receipt = (logs: unknown[], status = '0x1') => ({ status, logs, blockNumber: '0x1234' });

  it('decodes a transfer at six decimals, not eighteen', async () => {
    const { impl, calls } = createFetch({
      // 15_250_000 base units. At USDT's six decimals that is 15.25 USDT; read
      // as eighteen it would be 0.00000000001525 and every real payment would
      // look like an underpayment.
      rpc: () => rpcResult(receipt([transferLog(USDT_CONTRACT, ETH_ADDRESS, 15_250_000n)])),
    });

    const outcome = await verifyPayment('USDT', ETH_HASH, { fetchImpl: impl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.amount).toBe('15.25');
    expect(calls[0]?.method).toBe('eth_getTransactionReceipt');
  });

  it('decodes the smallest unit as 0.000001', async () => {
    const { impl } = createFetch({
      rpc: () => rpcResult(receipt([transferLog(USDT_CONTRACT, ETH_ADDRESS, 1n)])),
    });

    const outcome = await verifyPayment('USDT', ETH_HASH, { fetchImpl: impl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.amount).toBe('0.000001');
  });

  it('rejects a Transfer emitted by a different token contract', async () => {
    const { impl } = createFetch({
      rpc: () => rpcResult(receipt([transferLog(USDC_CONTRACT, ETH_ADDRESS, 15_000_000n)])),
    });

    const outcome = await verifyPayment('USDT', ETH_HASH, { fetchImpl: impl });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('a transfer of another token must not verify');
    expect(outcome.retryable).toBe(false);
    expect(outcome.reason).toContain('not USDT');
  });

  it('rejects a USDT transfer to a different recipient', async () => {
    const { impl } = createFetch({
      rpc: () => rpcResult(receipt([transferLog(USDT_CONTRACT, OTHER_ETH_ADDRESS, 15_000_000n)])),
    });

    const outcome = await verifyPayment('USDT', ETH_HASH, { fetchImpl: impl });

    expect(outcome).toMatchObject({ ok: false, retryable: false });
  });

  it('ignores a log whose first topic is not the Transfer signature', async () => {
    const approval = {
      address: USDT_CONTRACT,
      topics: [`0x${'11'.repeat(32)}`, addressTopic(OTHER_ETH_ADDRESS), addressTopic(ETH_ADDRESS)],
      data: word(15_000_000n),
    };
    const { impl } = createFetch({ rpc: () => rpcResult(receipt([approval])) });

    const outcome = await verifyPayment('USDT', ETH_HASH, { fetchImpl: impl });

    expect(outcome).toMatchObject({ ok: false, retryable: false });
  });

  it('rejects a reverted transaction', async () => {
    const { impl } = createFetch({
      rpc: () => rpcResult(receipt([transferLog(USDT_CONTRACT, ETH_ADDRESS, 15_000_000n)], '0x0')),
    });

    const outcome = await verifyPayment('USDT', ETH_HASH, { fetchImpl: impl });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('a reverted transaction transfers nothing');
    expect(outcome.retryable).toBe(false);
    expect(outcome.reason).toContain('failed on chain');
  });

  it('treats a missing receipt as not mined yet', async () => {
    const { impl } = createFetch({ rpc: () => rpcResult(null) });

    const outcome = await verifyPayment('USDT', ETH_HASH, { fetchImpl: impl });

    expect(outcome).toMatchObject({ ok: false, retryable: true });
  });
});

/* -------------------------------------------------------------------------- */
/* Hash shape                                                                  */
/* -------------------------------------------------------------------------- */

describe('verifyPayment — malformed hashes', () => {
  const cases = [
    { currency: 'ETH' as const, hash: 'not-a-hash' },
    { currency: 'ETH' as const, hash: 'ab'.repeat(32) }, // no 0x prefix
    { currency: 'USDT' as const, hash: `0x${'ab'.repeat(31)}` }, // too short
    { currency: 'USDT' as const, hash: `0x${'zz'.repeat(32)}` }, // not hex
    { currency: 'BTC' as const, hash: `0x${'cd'.repeat(32)}` }, // 0x is not Bitcoin
    { currency: 'BTC' as const, hash: '' },
  ];

  it.each(cases)('rejects $currency hash "$hash" without a request', async ({ currency, hash }) => {
    const { impl, calls } = createFetch({});

    const outcome = await verifyPayment(currency, hash, { fetchImpl: impl });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('a malformed hash must never verify');
    // The point of the shape check: a typo is answered locally, so no user
    // input is ever interpolated into a URL or forwarded to a node.
    expect(calls).toHaveLength(0);
    expect(outcome.retryable).toBe(false);
  });

  it('tolerates surrounding whitespace on an otherwise valid hash', async () => {
    const { impl } = createFetch({
      rpc: () => rpcResult({ to: ETH_ADDRESS, value: quantity(10n ** 18n), blockNumber: '0x1' }),
    });

    const outcome = await verifyPayment('ETH', `  ${ETH_HASH}\n`, { fetchImpl: impl });

    expect(outcome.ok).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Transport failures                                                          */
/* -------------------------------------------------------------------------- */

describe('verifyPayment — transport failures', () => {
  it('marks a network failure retryable rather than blaming the payment', async () => {
    const { impl } = createFetch({
      btc: () => {
        throw new TypeError('fetch failed');
      },
    });

    const outcome = await verifyPayment('BTC', BTC_TXID, { fetchImpl: impl });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('an unreachable node cannot confirm anything');
    expect(outcome.retryable).toBe(true);
  });

  it('marks a rate-limited node retryable', async () => {
    const { impl } = createFetch({ rpc: () => json({ message: 'slow down' }, 429) });

    const outcome = await verifyPayment('ETH', ETH_HASH, { fetchImpl: impl });

    expect(outcome).toMatchObject({ ok: false, retryable: true });
  });

  it('marks a JSON-RPC error retryable, since it says nothing about the transaction', async () => {
    const { impl } = createFetch({
      rpc: () => json({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'busy' } }),
    });

    const outcome = await verifyPayment('USDT', ETH_HASH, { fetchImpl: impl });

    expect(outcome).toMatchObject({ ok: false, retryable: true });
  });

  it('does not fail a verified payment when the price feed is down', async () => {
    const { impl } = createFetch({
      btc: () => json(btcTx([{ scriptpubkey_address: BTC_ADDRESS, value: 100_000 }])),
      price: () => {
        throw new TypeError('fetch failed');
      },
    });

    const outcome = await verifyPayment('BTC', BTC_TXID, { fetchImpl: impl });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error(outcome.reason);
    expect(outcome.amount).toBe('0.001');
    expect(outcome.usdValue).toBeNull();
  });
});
