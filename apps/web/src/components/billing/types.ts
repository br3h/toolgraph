/**
 * The wire contract between the billing API routes and the billing UI.
 *
 * It lives here, rather than in either route file, so that the client panel can
 * import the response shapes without pulling a route module — and everything
 * it holds is a type, so the import is erased entirely at build time and no
 * server code follows it into the browser bundle.
 */

import type { CryptoCurrency } from '@/lib/billing/plan';
import type { SubscriptionState } from '@/lib/billing/subscription';

/** What the client sends to `POST /api/billing/submit`. */
export interface BillingSubmitRequest {
  currency: CryptoCurrency;
  txHash: string;
}

/**
 * The payment was found on-chain and is worth the plan price. This is the only
 * shape that means the subscription is on — nothing else in this file does.
 */
export interface BillingVerifiedResponse {
  status: 'verified';
  daysRemaining: number | null;
  currentPeriodEnd: string | null;
}

/**
 * Recorded, not yet decided. Returned when the chain says yes but the price
 * feed could not be reached, or when activation did not complete. Never
 * presented as an active subscription.
 */
export interface BillingPendingResponse {
  status: 'pending';
  message: string;
}

/** A normal outcome, not an HTTP error: the chain did not back the claim. */
export interface BillingRejectedResponse {
  status: 'rejected';
  reason: string;
  /** True when submitting the same hash again could still succeed. */
  retryable: boolean;
}

export type BillingSubmitResponse =
  BillingVerifiedResponse | BillingPendingResponse | BillingRejectedResponse;

/** Every non-2xx body the billing routes produce. */
export interface BillingErrorResponse {
  error:
    | 'forbidden'
    | 'unauthenticated'
    | 'rate_limited'
    | 'payload_too_large'
    | 'invalid_request'
    | 'already_submitted'
    | 'server_error';
  message: string;
  retryAfterSeconds?: number;
}

/** A live quote, taken on the server so the browser makes no third-party call. */
export interface PaymentQuote {
  /** How much of the currency $15 buys, at `rateUsd`. */
  amount: number;
  /** One unit of the currency, in dollars. */
  rateUsd: number;
  /** ISO timestamp, so the panel can say how fresh the number is. */
  quotedAt: string;
}

/** `GET /api/billing/status` returns the caller's subscription state verbatim. */
export type BillingStatusResponse = SubscriptionState;
