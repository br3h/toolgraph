/**
 * The paid plan, and the addresses it is paid to.
 *
 * Toolgraph sells exactly one plan and takes exactly one form of payment. There
 * is no card processor, which means there is no webhook telling us money
 * arrived: the user sends funds to a fixed address, reports the transaction
 * hash, and the server reads the chain (see `./verify`).
 *
 * The addresses below are the site owner's own receiving addresses. They are
 * transcribed character for character and must stay that way. A single wrong
 * character does not produce an error anyone can recover from — it produces a
 * payment that lands somewhere else, permanently. Nothing here is derived,
 * interpolated, checksummed at runtime or built from parts, because every one
 * of those is a way for a typo to hide.
 */

export const PLAN_PRICE_USD = 15;
export const PLAN_INTERVAL_DAYS = 30;

export type CryptoCurrency = 'ETH' | 'USDT' | 'BTC';

export interface PaymentAddress {
  currency: CryptoCurrency;
  /** Human name for the asset, e.g. 'Ethereum'. */
  label: string;
  /** The chain the funds must travel on, e.g. 'Ethereum mainnet'. */
  network: string;
  address: string;
  /**
   * What the user must send, and on which network. Static guidance only — the
   * live amount is a separate concern, because a price feed can be down and a
   * guessed amount is worse than no amount. `getCryptoAmountForUsd` in
   * `./price` returns the figure, or null when no live price is known, and the
   * UI shows the address without an amount in that case.
   */
  note: string;
}

/**
 * USDT deliberately repeats the ETH address rather than referencing it. They
 * are the same string today because a USDT balance is an entry in a contract on
 * Ethereum and is credited to an ordinary Ethereum address; writing it out
 * twice means changing one never silently changes the other.
 */
export const PAYMENT_ADDRESSES: readonly PaymentAddress[] = [
  {
    currency: 'ETH',
    label: 'Ethereum',
    network: 'Ethereum mainnet',
    address: '0xD0AD4519F1525314924836C41FD0F2744Cf63e59',
    note: 'Send native ETH on Ethereum mainnet. Do not send from an exchange account that pays out on a different network, such as Arbitrum, Base or BNB Smart Chain.',
  },
  {
    currency: 'USDT',
    label: 'Tether',
    network: 'Ethereum mainnet (ERC-20)',
    address: '0xD0AD4519F1525314924836C41FD0F2744Cf63e59',
    note: 'Send ERC-20 USDT on Ethereum mainnet, to the same address as ETH above. Check the network before you send: USDT also exists on Tron (TRC-20), BNB Smart Chain and several others, and USDT sent on any of those is sent to an address that does not exist there and cannot be recovered. If your wallet or exchange offers a network choice, it must say Ethereum or ERC-20.',
  },
  {
    currency: 'BTC',
    label: 'Bitcoin',
    network: 'Bitcoin mainnet',
    address: 'bc1qs5mzd7lrjwr6u34r7ucqlxtn6n5959nt6kq6uu',
    note: 'Send BTC on Bitcoin mainnet to this bech32 address. Not Lightning, and not a wrapped form of Bitcoin on another chain.',
  },
];

/** The receiving address for one currency. Total over `CryptoCurrency`. */
export function getPaymentAddress(currency: CryptoCurrency): PaymentAddress {
  const found = PAYMENT_ADDRESSES.find((entry) => entry.currency === currency);
  if (!found) {
    // Unreachable while PAYMENT_ADDRESSES covers the union, and a throw rather
    // than a fallback because there is no safe address to fall back to.
    throw new Error(`No payment address is configured for ${currency}.`);
  }
  return found;
}
