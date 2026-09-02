/**
 * The plans, the intervals, and the addresses they are paid to.
 *
 * Toolgraph has no card processor, which shapes everything below. There is no
 * webhook telling us money arrived: the user sends funds to a fixed address,
 * reports the transaction hash, and the server reads the chain (see `./verify`).
 *
 * That model already handles annual and per-seat billing honestly, because a
 * payment is just "an amount of USD-equivalent, which buys a period for a number
 * of seats". Annual is not the monthly price rendered twelve times — it is a
 * different amount that buys a different period. Team is not a label — it is a
 * per-seat amount that buys seats on a workspace, counted by
 * `public.workspace_paid_seats()`.
 *
 * The addresses at the bottom are the site owner's own receiving addresses.
 * They are transcribed character for character and must stay that way. A single
 * wrong character does not produce an error anyone can recover from — it
 * produces a payment that lands somewhere else, permanently. Nothing here is
 * derived, interpolated, checksummed at runtime or built from parts, because
 * every one of those is a way for a typo to hide.
 */

/* -------------------------------------------------------------------------- */
/* Plans and intervals                                                         */
/* -------------------------------------------------------------------------- */

export type PlanId = 'free' | 'pro' | 'team';
export type BillingInterval = 'monthly' | 'annual';

/** Plans that can actually be bought. `free` is the absence of a payment. */
export type PaidPlanId = Exclude<PlanId, 'free'>;

export const PLAN_INTERVAL_DAYS = 30;
export const ANNUAL_INTERVAL_DAYS = 365;

/** Kept for the pricing copy and for anything still importing the old name. */
export const PLAN_PRICE_USD = 15;

export interface PlanDefinition {
  id: PlanId;
  name: string;
  /** One line, on the card, above the price. */
  tagline: string;
  /** USD per month, per seat. 0 for free. */
  monthlyUsd: number;
  /**
   * USD per YEAR, per seat — an independent number, not `monthlyUsd * 12`
   * with a discount applied at render time. Writing it out is what makes
   * "two months free" a fact about the price rather than a claim in the copy.
   */
  annualUsd: number;
  /** Fewest seats that can be bought. Team is pointless at one. */
  minSeats: number;
  maxSeats: number;
  features: readonly string[];
}

export const PLANS: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: 'free',
    name: 'Free',
    tagline: 'The whole product. No trial, no feature held back.',
    monthlyUsd: 0,
    annualUsd: 0,
    minSeats: 1,
    maxSeats: 1,
    features: [
      'Unlimited graphs on the canvas',
      "Every connection type-checked against the tools' real JSON Schemas",
      'Connect your own MCP servers over streamable HTTP or SSE',
      'Saved, reusable connections with stored credentials',
      'Export to TypeScript or Python you own outright',
      'Hosted test-runs, at the standard rate limit',
      'Self-host the whole thing — it is MIT licensed',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tagline: 'The same product, with a higher ceiling on the hosted runner.',
    monthlyUsd: 15,
    // $150 a year against $180 monthly: two months free, exactly.
    annualUsd: 150,
    minSeats: 1,
    maxSeats: 1,
    features: [
      'Everything in Free',
      'Hosted test-runs at a higher rate limit',
      'Longer run history',
      'Directly funds the work on Toolgraph',
    ],
  },
  team: {
    id: 'team',
    name: 'Team',
    tagline: 'Shared graphs and shared connections, for a group that ships together.',
    monthlyUsd: 12,
    // $120 per seat per year against $144 monthly: two months free, per seat.
    annualUsd: 120,
    minSeats: 2,
    maxSeats: 50,
    features: [
      'Everything in Pro, for every member',
      'A shared workspace with graphs everyone can open and edit',
      'Shared connections — a credential is stored once, and members use it without seeing it',
      'Owner, admin and member roles',
      'Invite by email; remove, leave and transfer ownership',
      'Per-seat billing, monthly or annual',
    ],
  },
} as const;

/** Days a payment on this interval buys. */
export function intervalDays(interval: BillingInterval): number {
  return interval === 'annual' ? ANNUAL_INTERVAL_DAYS : PLAN_INTERVAL_DAYS;
}

/**
 * What a purchase costs, in USD.
 *
 * THE one place this is computed. The pricing page, the checkout panel and the
 * payment verifier all call it, so a price shown to a user and a price required
 * of them cannot disagree — which is the failure mode that turns a billing bug
 * into somebody losing money.
 *
 * Returns null for an unbuyable combination (free, or seats outside the plan's
 * range) rather than a zero or a guess, so a caller has to handle it.
 */
export function priceUsd(plan: PlanId, interval: BillingInterval, seats = 1): number | null {
  const definition = PLANS[plan];
  if (!definition || plan === 'free') return null;

  if (!Number.isInteger(seats) || seats < definition.minSeats || seats > definition.maxSeats) {
    return null;
  }

  const perSeat = interval === 'annual' ? definition.annualUsd : definition.monthlyUsd;
  if (perSeat <= 0) return null;

  return perSeat * seats;
}

/**
 * What the annual price saves against paying monthly for a year, as a whole
 * percentage. Rendered on the pricing toggle.
 *
 * Derived from the two prices rather than stored, so it cannot claim a discount
 * the prices do not actually give.
 */
export function annualSavingPercent(plan: PlanId): number {
  const definition = PLANS[plan];
  const monthlyYear = definition.monthlyUsd * 12;
  if (monthlyYear <= 0) return 0;
  return Math.round(((monthlyYear - definition.annualUsd) / monthlyYear) * 100);
}

/** "$15 / month" or "$120 / seat / year". */
export function formatPrice(plan: PlanId, interval: BillingInterval): string {
  const definition = PLANS[plan];
  if (plan === 'free') return 'Free';
  const amount = interval === 'annual' ? definition.annualUsd : definition.monthlyUsd;
  const per = plan === 'team' ? ' / seat' : '';
  return `$${amount}${per} / ${interval === 'annual' ? 'year' : 'month'}`;
}

/* -------------------------------------------------------------------------- */
/* Payment addresses                                                           */
/* -------------------------------------------------------------------------- */

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
