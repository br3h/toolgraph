'use client';

/**
 * The billing panel.
 *
 * Paying here means moving money by hand to a fixed address, so the panel is
 * written around the two ways that goes wrong: sending the wrong amount, and
 * sending USDT on the wrong network. The address is never truncated, the amount
 * is spelled out, and the network warning sits between the address and the form
 * where it cannot be scrolled past.
 *
 * The other rule this file keeps: a subscription is active only once the server
 * has said `verified`. A submitted hash is a claim, not a payment, and every
 * intermediate state here says so in words.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  InfoIcon,
  SuccessIcon,
  WarningIcon,
  cn,
  type IconProps,
} from '@toolgraph/ui';

import { captureEvent, type AnalyticsEvent } from '@/lib/analytics';
import type { CryptoCurrency, PaymentAddress } from '@/lib/billing/plan';
import type { SubscriptionState } from '@/lib/billing/subscription';
import type { BillingSubmitRequest, PaymentQuote } from '@/components/billing/types';

export interface BillingPanelProps {
  /**
   * Null when the state could not be read. Deliberately not defaulted to
   * `none`: "we do not know" and "you have no subscription" are different
   * things to tell someone who may have just paid.
   */
  initialState: SubscriptionState | null;
  addresses: readonly PaymentAddress[];
  /** Server-side quotes, one per currency; null where the feed was unavailable. */
  quotes: Partial<Record<CryptoCurrency, PaymentQuote | null>>;
  priceUsd: number;
  intervalDays: number;
}

/**
 * `subscription submitted` is not yet a member of the AnalyticsEvent union in
 * `@/lib/analytics`, and that file is not this task's to edit. The assertion is
 * the seam until the member is added. What matters is the payload: two enums,
 * and nothing else — never the hash, never the amount, never the address.
 */
const SUBSCRIPTION_SUBMITTED = 'subscription submitted' as unknown as AnalyticsEvent;

type SubmitOutcome =
  'verified' | 'pending' | 'rejected' | 'duplicate' | 'rate_limited' | 'invalid' | 'error';

type PanelResult =
  | { kind: 'verified'; daysRemaining: number | null; currentPeriodEnd: string | null }
  | { kind: 'pending'; message: string }
  | { kind: 'rejected'; reason: string; retryable: boolean }
  | { kind: 'duplicate'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'error'; message: string };

/* -------------------------------------------------------------------------- */
/* Small readers: the wire is untrusted, so nothing is assumed about its shape. */
/* -------------------------------------------------------------------------- */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

/** Fixed to UTC so the server and the browser render the same string. */
const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${DATE_FORMAT.format(date)} (UTC)`;
}

const AMOUNT_DECIMALS: Record<CryptoCurrency, number> = { ETH: 6, USDT: 2, BTC: 8 };

/** Trailing zeros are noise on an amount somebody is about to retype. */
function formatAmount(amount: number, currency: CryptoCurrency): string {
  const fixed = amount.toFixed(AMOUNT_DECIMALS[currency]);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

function formatUsd(value: number): string {
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}

const HASH_PLACEHOLDER: Record<CryptoCurrency, string> = {
  ETH: '0x…',
  USDT: '0x…',
  BTC: '64 hexadecimal characters',
};

const HASH_HINT: Record<CryptoCurrency, string> = {
  ETH: 'Your wallet calls this the transaction hash: 0x followed by 64 characters.',
  USDT: 'Your wallet calls this the transaction hash: 0x followed by 64 characters.',
  BTC: 'Your wallet calls this the transaction id: 64 characters, no 0x prefix.',
};

/* -------------------------------------------------------------------------- */
/* Status                                                                      */
/* -------------------------------------------------------------------------- */

interface StatusView {
  Icon: (props: IconProps) => React.ReactElement;
  title: string;
  body: string;
  /** Weight, never colour: heavier means the state matters more. */
  frame: string;
  badge: string;
}

function statusView(
  state: SubscriptionState | null,
  priceUsd: number,
  intervalDays: number,
): StatusView {
  if (!state) {
    return {
      Icon: WarningIcon,
      title: 'Status unavailable',
      body: 'Your subscription could not be read just now. Reload the page to try again — nothing you have paid is affected.',
      frame: 'border-2 border-border',
      badge: 'Unknown',
    };
  }

  const renewal = formatDate(state.currentPeriodEnd);

  switch (state.status) {
    case 'active': {
      const days =
        state.daysRemaining === null
          ? 'Your access is current.'
          : `${state.daysRemaining} ${state.daysRemaining === 1 ? 'day' : 'days'} remaining.`;
      return {
        Icon: SuccessIcon,
        title: 'Subscription active',
        body: renewal
          ? `${days} Access runs until ${renewal}. Nothing renews on its own — pay again before then to add another ${intervalDays} days.`
          : `${days} Nothing renews on its own — pay again to add another ${intervalDays} days.`,
        frame: 'border-2 border-border-strong',
        badge: 'Active',
      };
    }
    case 'pending':
      return {
        Icon: InfoIcon,
        title: 'Payment pending review',
        body: 'A payment is recorded and waiting to be confirmed. You are not subscribed until it is verified — do not send it again.',
        frame: 'border-2 border-border',
        badge: 'Pending',
      };
    case 'expired':
      return {
        Icon: WarningIcon,
        title: 'Subscription expired',
        body: renewal
          ? `Your last period ended on ${renewal}. Pay again to switch it back on.`
          : 'Your last period has ended. Pay again to switch it back on.',
        frame: 'border-2 border-border',
        badge: 'Expired',
      };
    case 'none':
    default:
      return {
        Icon: InfoIcon,
        title: 'No subscription',
        body: `You are on the free plan, and everything on the canvas works. Pro is $${formatUsd(priceUsd)} a month, supports the project, and raises the hosted test-run limit.`,
        frame: 'border border-border-subtle',
        badge: 'Free',
      };
  }
}

function StatusCard({
  state,
  priceUsd,
  intervalDays,
}: {
  state: SubscriptionState | null;
  priceUsd: number;
  intervalDays: number;
}) {
  const view = statusView(state, priceUsd, intervalDays);

  return (
    <section
      data-testid="billing-status"
      data-status={state?.status ?? 'unknown'}
      className={cn('rounded-[var(--tg-radius-lg)] bg-bg-raised p-4 sm:p-5', view.frame)}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 text-fg">
          <view.Icon size={18} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">{view.title}</h2>
            <Badge variant={state?.status === 'active' ? 'strong' : 'subtle'} uppercase>
              {view.badge}
            </Badge>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{view.body}</p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Panel                                                                       */
/* -------------------------------------------------------------------------- */

export function BillingPanel({
  initialState,
  addresses,
  quotes,
  priceUsd,
  intervalDays,
}: BillingPanelProps) {
  const first = addresses[0];
  const [currency, setCurrency] = useState<CryptoCurrency>(first ? first.currency : 'ETH');
  const [txHash, setTxHash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<PanelResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [state, setState] = useState<SubscriptionState | null>(initialState);

  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const selected = addresses.find((entry) => entry.currency === currency) ?? first ?? null;
  const quote = quotes[currency] ?? null;

  const copyAddress = useCallback(async () => {
    if (!selected) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(selected.address);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be refused outright; say so rather than pretending.
      setCopied(false);
      setCopyFailed(true);
    }
  }, [selected]);

  const submit = useCallback(async () => {
    const hash = txHash.trim();
    if (!hash || submitting) return;

    setSubmitting(true);
    setResult(null);

    let outcome: SubmitOutcome = 'error';

    try {
      const body: BillingSubmitRequest = { currency, txHash: hash };
      const response = await fetch('/api/billing/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload: unknown = await response.json().catch(() => null);
      const record = asRecord(payload);

      if (response.ok) {
        const status = readString(record, 'status');

        if (status === 'verified') {
          const daysRemaining = readNumber(record, 'daysRemaining');
          const currentPeriodEnd = readString(record, 'currentPeriodEnd');
          outcome = 'verified';
          setResult({ kind: 'verified', daysRemaining, currentPeriodEnd });
          // The server said verified, which is the only thing that may switch
          // this display to active.
          setState({ status: 'active', currentPeriodEnd, daysRemaining });
          setTxHash('');
        } else if (status === 'pending') {
          outcome = 'pending';
          setResult({
            kind: 'pending',
            message:
              readString(record, 'message') ??
              'Your transaction is recorded and waiting to be reviewed.',
          });
          setState({ status: 'pending', currentPeriodEnd: null, daysRemaining: null });
        } else if (status === 'rejected') {
          outcome = 'rejected';
          setResult({
            kind: 'rejected',
            reason: readString(record, 'reason') ?? 'That transaction could not be verified.',
            retryable: record?.retryable === true,
          });
        } else {
          setResult({ kind: 'error', message: 'The server sent an answer we did not understand.' });
        }
      } else if (response.status === 409) {
        outcome = 'duplicate';
        setResult({
          kind: 'duplicate',
          message: readString(record, 'message') ?? 'That transaction has already been submitted.',
        });
      } else if (response.status === 429) {
        outcome = 'rate_limited';
        setResult({
          kind: 'rate_limited',
          message:
            readString(record, 'message') ??
            'Too many payment checks in a row. Wait a minute and try again.',
        });
      } else if (response.status === 401) {
        setResult({
          kind: 'error',
          message: 'Your session has expired. Sign in again, then resubmit the same hash.',
        });
      } else if (response.status === 400) {
        outcome = 'invalid';
        setResult({
          kind: 'error',
          message: readString(record, 'message') ?? 'That transaction hash was not valid.',
        });
      } else {
        setResult({
          kind: 'error',
          message:
            readString(record, 'message') ??
            'That payment could not be checked just now. Your transaction is safe on-chain — try again shortly.',
        });
      }
    } catch {
      // A dropped connection, not a rejection. The money is unaffected either way.
      setResult({
        kind: 'error',
        message:
          'We could not reach the server. Your transaction is safe on-chain — try again when you are back online.',
      });
    } finally {
      setSubmitting(false);
      // Two enumerated values. Nothing here can carry a hash, an amount or an
      // address, which is the whole rule for this payload.
      captureEvent(SUBSCRIPTION_SUBMITTED, { currency, outcome });
    }
  }, [currency, submitting, txHash]);

  const refreshStatus = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch('/api/billing/status', {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return;

      const record = asRecord(await response.json().catch(() => null));
      const status = readString(record, 'status');
      if (
        status === 'none' ||
        status === 'pending' ||
        status === 'active' ||
        status === 'expired'
      ) {
        setState({
          status,
          currentPeriodEnd: readString(record, 'currentPeriodEnd'),
          daysRemaining: readNumber(record, 'daysRemaining'),
        });
      }
    } catch {
      // Leave the last known state on screen rather than replacing it with a guess.
    } finally {
      setRefreshing(false);
    }
  }, []);

  return (
    <div className="space-y-5">
      <StatusCard state={state} priceUsd={priceUsd} intervalDays={intervalDays} />

      <Card
        header={
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold tracking-tight">Pay for a month</span>
            <span className="text-xs font-normal text-fg-muted">
              ${formatUsd(priceUsd)} in crypto, {intervalDays} days of access
            </span>
          </div>
        }
      >
        <fieldset>
          <legend className="sr-only">Currency</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {addresses.map((entry) => {
              const isSelected = entry.currency === currency;
              return (
                <label
                  key={entry.currency}
                  className={cn(
                    'flex cursor-pointer flex-col gap-0.5 rounded-[var(--tg-radius-md)] p-3 transition-colors',
                    'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2',
                    isSelected
                      ? 'border-2 border-border-strong bg-bg-sunken'
                      : 'border border-border-subtle hover:bg-bg-subtle',
                  )}
                >
                  <input
                    type="radio"
                    name="billing-currency"
                    value={entry.currency}
                    checked={isSelected}
                    onChange={() => {
                      setCurrency(entry.currency);
                      setCopied(false);
                      setCopyFailed(false);
                    }}
                    className="sr-only"
                  />
                  <span className="flex items-baseline gap-1.5">
                    <span className="text-sm font-semibold tracking-tight">{entry.currency}</span>
                    <span className="text-xs text-fg-muted">{entry.label}</span>
                  </span>
                  <span className="text-xs text-fg-muted">{entry.network}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {selected ? (
          <div className="mt-4 space-y-3">
            {selected.currency === 'USDT' ? (
              <Alert variant="warning" title="Send USDT as ERC-20 on Ethereum mainnet only">
                This is an Ethereum address — the same one as ETH. USDT sent on Tron, BNB Smart
                Chain, Solana, Polygon, Arbitrum or any other network goes somewhere nobody
                controls. Those funds cannot be recovered and cannot be refunded. Check the network
                in your wallet before you confirm.
              </Alert>
            ) : null}

            <div className="rounded-[var(--tg-radius-md)] border border-border bg-bg-sunken p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-fg-subtle">
                  Send to — {selected.network}
                </p>
                <Button size="sm" onClick={() => void copyAddress()}>
                  {copied ? 'Copied' : 'Copy address'}
                </Button>
              </div>

              {/* Wraps, never truncates: a shortened address is an address that
                  can be mistyped, and a mistyped address is lost money. */}
              <p
                data-testid="payment-address"
                className="mt-2 select-all break-all font-mono text-sm leading-relaxed text-fg"
              >
                {selected.address}
              </p>

              <p className="mt-2 text-xs leading-relaxed text-fg-muted" role="status">
                {copyFailed
                  ? 'This browser refused clipboard access. Select the address above and copy it by hand, then check the first and last four characters against your wallet.'
                  : 'Check the first and last four characters in your wallet against the address above before you send.'}
              </p>
            </div>

            <p className="text-sm leading-relaxed text-fg-muted">
              {quote ? (
                <>
                  Send{' '}
                  <span className="font-mono text-fg">
                    {formatAmount(quote.amount, selected.currency)} {selected.currency}
                  </span>{' '}
                  — ${formatUsd(priceUsd)} at ${formatUsd(quote.rateUsd)} per {selected.currency}.
                  Rates move, so anything within 2 percent of ${formatUsd(priceUsd)} is accepted,
                  and a little over is safer than a little under.
                </>
              ) : (
                <>
                  Send the equivalent of ${formatUsd(priceUsd)}. The live rate could not be fetched
                  just now, so the exact amount is not shown here — the server values your
                  transaction itself when you submit the hash, and accepts anything within 2
                  percent.
                </>
              )}
            </p>

            {selected.note ? (
              <p className="text-xs leading-relaxed text-fg-subtle">{selected.note}</p>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card
        header={<span className="text-sm font-semibold tracking-tight">Submit your payment</span>}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="space-y-3"
        >
          <Input
            label="Transaction hash"
            name="txHash"
            value={txHash}
            onChange={(event) => setTxHash(event.target.value)}
            placeholder={HASH_PLACEHOLDER[currency]}
            hint={HASH_HINT[currency]}
            className="font-mono"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={submitting}
            data-testid="tx-hash-input"
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              variant="primary"
              loading={submitting}
              disabled={txHash.trim().length === 0}
              data-testid="submit-payment"
            >
              Check the chain
            </Button>
            {submitting ? (
              <p className="text-xs text-fg-muted">
                Reading the transaction from the chain. This takes a few seconds.
              </p>
            ) : null}
          </div>
        </form>

        {result ? (
          <div className="mt-4" data-testid="billing-result">
            {result.kind === 'verified' ? (
              <Alert variant="success" title="Payment verified — your subscription is active">
                {result.daysRemaining === null
                  ? 'The transaction was confirmed on-chain and your access is on.'
                  : `The transaction was confirmed on-chain. You have ${result.daysRemaining} ${
                      result.daysRemaining === 1 ? 'day' : 'days'
                    } of access${
                      formatDate(result.currentPeriodEnd)
                        ? `, until ${formatDate(result.currentPeriodEnd)}`
                        : ''
                    }.`}
              </Alert>
            ) : null}

            {result.kind === 'pending' ? (
              <Alert
                variant="info"
                title="Recorded, not yet confirmed"
                action={
                  <Button size="sm" loading={refreshing} onClick={() => void refreshStatus()}>
                    Check again
                  </Button>
                }
              >
                {result.message}
              </Alert>
            ) : null}

            {result.kind === 'rejected' ? (
              <Alert
                variant="error"
                title="That transaction was not accepted"
                action={
                  result.retryable ? (
                    <Button size="sm" loading={submitting} onClick={() => void submit()}>
                      Try again
                    </Button>
                  ) : undefined
                }
              >
                {result.reason}
                {result.retryable
                  ? ' The same hash can be submitted again once the transaction has a confirmation.'
                  : ''}
              </Alert>
            ) : null}

            {result.kind === 'duplicate' ? (
              <Alert variant="warning" title="Already submitted">
                {result.message} If it is still being reviewed, it will be applied to your account
                without you sending anything else.
              </Alert>
            ) : null}

            {result.kind === 'rate_limited' ? (
              <Alert variant="warning" title="Too many checks">
                {result.message}
              </Alert>
            ) : null}

            {result.kind === 'error' ? (
              <Alert variant="error" title="That did not go through">
                {result.message}
              </Alert>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card header={<span className="text-sm font-semibold tracking-tight">How this works</span>}>
        <ol className="space-y-3">
          {[
            {
              title: 'Send the exact amount',
              body: `Transfer the amount shown above to the address above, on the network named beside it. There is no card processor and no invoice — the transfer is the payment.`,
            },
            {
              title: 'Wait for one confirmation',
              body: 'A transaction that is still in the mempool cannot be checked. One confirmation is enough; that is usually well under a minute for Ethereum and around ten minutes for Bitcoin.',
            },
            {
              title: 'Paste the transaction hash',
              body: 'Copy it from your wallet or block explorer and submit it above. Each hash can be claimed once.',
            },
            {
              title: 'The server checks the chain itself',
              body: `We read the transaction from the chain, compare its value against $${formatUsd(
                priceUsd,
              )}, and switch the subscription on for ${intervalDays} days. Nothing is taken on trust.`,
            },
          ].map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[11px] font-semibold text-fg-muted">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium tracking-tight">{step.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-fg-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
