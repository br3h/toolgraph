/**
 * `POST /api/billing/submit` — claim a subscription with an on-chain payment.
 *
 * There is no card processor and therefore no webhook: the user pays to a fixed
 * address and then tells us the transaction hash, and this route asks the chain
 * whether that is true. Everything here follows from that.
 *
 * Two orderings in this file are load-bearing and should not be rearranged:
 *
 *   1. The rate limit runs before anything that touches a third-party API.
 *      Chain and price lookups are made on our behalf, with our keys and our
 *      quota; without a per-user limit one account can spend all of it.
 *   2. The row is inserted as `pending` BEFORE verification. The unique
 *      (currency, tx_hash) index is what rejects a replay, and it can only do
 *      that if the insert happens first. Verifying first and inserting after
 *      leaves a window in which the same hash is verified twice concurrently
 *      and activates twice.
 *
 * Runs on the Node runtime: the verifier talks to chain RPCs, and the admin
 * Supabase client needs the secret key, neither of which belongs on the edge.
 *
 * The `subscription submitted` analytics event is fired by the panel, not here.
 * `@/lib/analytics` is a `'use client'` module: imported into a route handler it
 * resolves to a client reference, and calling it would throw inside the very
 * request that has just taken someone's money. The payload is unchanged — the
 * currency and the outcome, both enumerated, and nothing that could carry a
 * hash, an amount or an address.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createAdminClient, createClient, getCurrentUser } from '@/lib/supabase/server';
import { limitAuthAttempt } from '@/lib/rate-limit';
import { publicEnv } from '@/lib/public-env';
import { PLAN_INTERVAL_DAYS, PLAN_PRICE_USD, type CryptoCurrency } from '@/lib/billing/plan';
import { getCryptoAmountForUsd } from '@/lib/billing/price';
import { verifyPayment, type VerificationOutcome } from '@/lib/billing/verify';
import {
  activateSubscription,
  getSubscriptionState,
  setSubscriptionStatus,
} from '@/lib/billing/subscription';
import type { BillingSubmitResponse } from '@/components/billing/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The table this route writes. Columns it relies on:
 *
 *   owner uuid, currency text, tx_hash text, status text
 *   ('pending' | 'verified' | 'rejected'), reason text, usd_value numeric,
 *   reviewed_at timestamptz, plus `unique (currency, tx_hash)`.
 *
 * RLS: the caller may insert and select their own rows; NOBODY may update
 * theirs. The status transitions below all go through the service key, so a
 * user cannot mark their own submission verified.
 */
const SUBMISSIONS_TABLE = 'payment_submissions';

/** A hash and a three-letter currency. Anything larger is not a payment claim. */
const MAX_BODY_BYTES = 4_096;

/** Postgres unique_violation. The replay guard, and the only expected DB error. */
const UNIQUE_VIOLATION = '23505';

/**
 * Exchange rates move between the moment we quote an amount and the moment the
 * transaction lands, and a wallet's own rounding moves it again. 2% is the
 * slippage we absorb rather than take someone's money and refuse them.
 */
const PRICE_TOLERANCE = 0.02;

const ETHEREUM_TX = /^0x[0-9a-f]{64}$/i;
const BITCOIN_TX = /^[0-9a-f]{64}$/i;

const bodySchema = z
  .object({
    currency: z.enum(['ETH', 'USDT', 'BTC']),
    txHash: z.string().trim().min(1, 'Paste the transaction hash.').max(200),
  })
  .superRefine((value, ctx) => {
    // Shape-checking here keeps obvious junk from ever reaching a chain API,
    // which is the resource the rate limit above is protecting.
    const valid = value.currency === 'BTC' ? BITCOIN_TX : ETHEREUM_TX;
    if (valid.test(value.txHash)) return;

    ctx.addIssue({
      code: 'custom',
      path: ['txHash'],
      message:
        value.currency === 'BTC'
          ? 'A Bitcoin transaction id is 64 hexadecimal characters.'
          : 'An Ethereum transaction hash is 0x followed by 64 hexadecimal characters.',
    });
  });

/**
 * Explicit same-origin check, copied from `/api/export`.
 *
 * Route handlers get none of the protection a server action has, and this one
 * both spends third-party quota and switches a subscription on.
 */
function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return process.env.NODE_ENV !== 'production';

  const allowed = new Set<string>();
  try {
    allowed.add(new URL(publicEnv.siteUrl).origin);
  } catch {
    /* a malformed configured URL contributes nothing */
  }

  const host = request.headers.get('host');
  if (host) {
    allowed.add(`https://${host}`);
    if (process.env.NODE_ENV !== 'production') allowed.add(`http://${host}`);
  }
  if (process.env.VERCEL_URL) allowed.add(`https://${process.env.VERCEL_URL}`);

  return allowed.has(origin);
}

const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' } as const;

function fail(
  error: string,
  message: string,
  status: number,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json({ error, message }, { status, headers: { ...NO_STORE, ...headers } });
}

function outcomeJson(body: BillingSubmitResponse): NextResponse {
  return NextResponse.json(body, { status: 200, headers: NO_STORE });
}

/**
 * Move a submission to a decided state. Service key, because the RLS policies
 * deliberately give the owner no UPDATE — otherwise a user could write
 * `verified` onto their own row and skip the chain entirely.
 */
async function markSubmission(
  id: string,
  status: 'verified' | 'rejected',
  reason: string | null,
  usdValue?: number,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const patch: Record<string, unknown> = {
      status,
      reason,
      reviewed_at: new Date().toISOString(),
    };
    if (usdValue !== undefined) patch.usd_value = Number(usdValue.toFixed(2));

    const { error } = await admin.from(SUBMISSIONS_TABLE).update(patch).eq('id', id);
    if (error) {
      console.error(`billing: submission ${id} could not be marked ${status}: ${error.message}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(
      `billing: submission ${id} could not be marked ${status}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    return false;
  }
}

/** Subscription bookkeeping must never be what turns a good payment into a 500. */
async function markSubscriptionPending(userId: string): Promise<void> {
  try {
    await setSubscriptionStatus(userId, 'pending');
  } catch (error) {
    console.error(
      `billing: could not set the subscription to pending: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
  }
}

/**
 * Re-open a submission the user's own earlier attempt left `rejected`.
 *
 * A rejection is frequently transient — "not confirmed yet" is the common one —
 * and without this the unique index would make the retry the UI offers
 * impossible: the second attempt at the same hash would collide forever.
 *
 * The `status = 'rejected'` predicate is what makes it safe under concurrency.
 * Postgres locks the row for the UPDATE, so of two simultaneous retries exactly
 * one sees a rejected row and gets it back; the other matches nothing and falls
 * through to the 409. `id` came from an RLS-scoped select, so it is provably the
 * caller's own row even though the service key does the write.
 */
async function reopenSubmission(id: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from(SUBMISSIONS_TABLE)
      .update({ status: 'pending', reason: null, reviewed_at: null })
      .eq('id', id)
      .eq('status', 'rejected')
      .select('id')
      .maybeSingle();

    return !error && data !== null;
  } catch {
    return false;
  }
}

type Claim = { ok: true; id: string } | { ok: false; response: NextResponse };

/**
 * Record the claim before checking it, and let the database decide whether this
 * hash is already spoken for.
 */
async function claimSubmission(
  userId: string,
  currency: CryptoCurrency,
  txHash: string,
): Promise<Claim> {
  // The RLS-scoped client, so the insert is subject to the owner policy and the
  // unique index rather than to a check written here.
  const supabase = await createClient();

  const { data, error } = await supabase
    .from(SUBMISSIONS_TABLE)
    .insert({ owner: userId, currency, tx_hash: txHash, status: 'pending' })
    .select('id')
    .single();

  if (!error && data) return { ok: true, id: String(data.id) };

  if (error?.code !== UNIQUE_VIOLATION) {
    console.error(`billing: submission could not be recorded: ${error?.message ?? 'no row'}`);
    return {
      ok: false,
      response: fail(
        'server_error',
        'That transaction could not be recorded just now. Nothing was submitted — try again in a moment.',
        500,
      ),
    };
  }

  // Somebody has claimed this hash. RLS means the select below can only ever
  // return the caller's own row, so a hash claimed by another account is simply
  // invisible and falls through to the 409 — as it should.
  const { data: existing } = await supabase
    .from(SUBMISSIONS_TABLE)
    .select('id, status')
    .eq('currency', currency)
    .eq('tx_hash', txHash)
    .maybeSingle();

  if (existing && String(existing.status) === 'rejected') {
    const id = String(existing.id);
    if (await reopenSubmission(id)) return { ok: true, id };
  }

  return {
    ok: false,
    response: fail('already_submitted', 'That transaction has already been submitted.', 409),
  };
}

export async function POST(request: NextRequest) {
  if (!originAllowed(request)) {
    return fail('forbidden', 'This request could not be verified.', 403);
  }

  const user = await getCurrentUser();
  if (!user) {
    return fail('unauthenticated', 'Sign in to submit a payment.', 401);
  }

  // Before the body is even read: everything past this point can reach a chain
  // API, and the account is the thing to attribute that spend to.
  const verdict = await limitAuthAttempt(`billing:${user.id}`);
  if (!verdict.allowed) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `Too many payment checks. Try again in ${verdict.retryAfterSeconds} seconds — your transaction is safe on-chain either way.`,
        retryAfterSeconds: verdict.retryAfterSeconds,
      },
      {
        status: 429,
        headers: { ...NO_STORE, 'Retry-After': String(verdict.retryAfterSeconds) },
      },
    );
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return fail('payload_too_large', 'That request body is too large.', 413);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return fail('invalid_request', 'The request body was not valid JSON.', 400);
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues[0]?.message ?? 'That payment claim was not valid.';
    return fail('invalid_request', detail, 400);
  }

  const { currency } = parsed.data;
  // Both chains write hashes in hex, and both are case-insensitive about it.
  // Normalising means a re-cased hash still collides with its own earlier
  // submission instead of slipping past the unique index as a fresh claim.
  const txHash = parsed.data.txHash.toLowerCase();

  const claim = await claimSubmission(user.id, currency, txHash);
  if (!claim.ok) return claim.response;

  let outcome: VerificationOutcome;
  try {
    outcome = await verifyPayment(currency, txHash);
  } catch (error) {
    console.error(
      `billing: verification threw for submission ${claim.id}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );

    // Rejected rather than left pending, and retryable: a rejected row is one
    // the user can resubmit (see reopenSubmission), and a lookup that never
    // completed is exactly the case where they should.
    const reason =
      'We could not reach the chain to check that transaction. Your payment is not affected — try again in a moment.';
    await markSubmission(claim.id, 'rejected', reason);
    return outcomeJson({ status: 'rejected', reason, retryable: true });
  }

  if (!outcome.ok) {
    // A failed verification is a normal answer, not a server error. The row
    // keeps the reason so a human reviewing it later sees what happened.
    await markSubmission(claim.id, 'rejected', outcome.reason);
    return outcomeJson({
      status: 'rejected',
      reason: outcome.reason,
      retryable: outcome.retryable,
    });
  }

  // --- The payment exists. Is it worth $15? -------------------------------

  let quote: { amount: number; rateUsd: number } | null = null;
  try {
    quote = await getCryptoAmountForUsd(currency, PLAN_PRICE_USD);
  } catch (error) {
    console.error(
      `billing: price lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }

  const paidAmount = Number(outcome.amount);
  const usdPaid =
    outcome.usdValue ?? (quote && Number.isFinite(paidAmount) ? paidAmount * quote.rateUsd : null);

  if (usdPaid === null) {
    // Our price feed being down is our problem, not the payer's. The row stays
    // pending for review and the subscription says pending — which is the truth.
    await markSubscriptionPending(user.id);
    return outcomeJson({
      status: 'pending',
      message:
        'Your transaction was found on-chain, but the live price could not be fetched, so the amount has not been checked yet. It is recorded and will be reviewed by hand — do not send it again.',
    });
  }

  if (usdPaid < PLAN_PRICE_USD * (1 - PRICE_TOLERANCE)) {
    const reason = `That transaction is worth about $${usdPaid.toFixed(2)}, and the plan is $${PLAN_PRICE_USD} a month. Send the difference as a new transaction and submit that hash.`;
    await markSubmission(claim.id, 'rejected', reason, usdPaid);
    return outcomeJson({ status: 'rejected', reason, retryable: false });
  }

  // --- Paid in full. Switch the subscription on. --------------------------

  const recorded = await markSubmission(claim.id, 'verified', null, usdPaid);
  if (recorded) {
    try {
      await activateSubscription(user.id, PLAN_INTERVAL_DAYS);
    } catch (error) {
      console.error(
        `billing: activation failed after verifying submission ${claim.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return outcomeJson({
        status: 'pending',
        message:
          'Your payment was confirmed on-chain, but the subscription could not be switched on automatically. It is recorded and will be finished by hand — do not send it again.',
      });
    }
  } else {
    // The chain says paid, but we could not write the decision down. Claiming
    // an active subscription on top of that would be a claim we cannot back.
    return outcomeJson({
      status: 'pending',
      message:
        'Your payment was confirmed on-chain, but it could not be recorded automatically. It will be finished by hand — do not send it again.',
    });
  }

  let daysRemaining: number | null = PLAN_INTERVAL_DAYS;
  let currentPeriodEnd: string | null = null;
  try {
    const state = await getSubscriptionState(user.id);
    daysRemaining = state.daysRemaining;
    currentPeriodEnd = state.currentPeriodEnd;
  } catch {
    // The subscription is on; only the summary of it is missing.
  }

  return outcomeJson({ status: 'verified', daysRemaining, currentPeriodEnd });
}
