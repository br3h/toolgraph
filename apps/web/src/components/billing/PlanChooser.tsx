'use client';

/**
 * Choosing what to buy.
 *
 * The selection is held in the URL, not in component state, and every control
 * here is a `<Link>` or a form that navigates. That is deliberate and it is a
 * money-safety property rather than a routing preference: the amount shown next
 * to the payment address is computed on the SERVER for the exact selection in
 * the URL, so it cannot describe a different plan than the one the form will
 * submit. Holding the selection client-side would mean either shipping the
 * price table to the browser and trusting it, or quoting one plan while
 * submitting another.
 *
 * It also means the choice survives a reload, a back button and a shared link —
 * which matters when the next step is "go to your wallet and come back".
 */

import { useId } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@toolgraph/ui';

import { PLANS, annualSavingPercent, type BillingInterval, type PlanId } from '@/lib/billing/plan';

export interface PlanChooserProps {
  plan: Exclude<PlanId, 'free'>;
  interval: BillingInterval;
  seats: number;
  workspaceId: string | null;
  workspaces: readonly { id: string; name: string }[];
  /** Server-computed. Rendered, never used to compute anything else. */
  totalUsd: number;
}

/** Builds the href for one changed dimension, preserving the others. */
function hrefWith(current: URLSearchParams, patch: Record<string, string | null>): string {
  const next = new URLSearchParams(current.toString());
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/billing?${query}` : '/billing';
}

function Segment({
  href,
  selected,
  children,
}: {
  href: string;
  selected: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      // `aria-current` rather than a visual-only state, so the choice is
      // announced and not merely drawn.
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'rounded-[var(--tg-radius-sm)] px-3 py-1.5 text-xs font-medium transition-colors',
        selected ? 'bg-accent text-fg-on-accent' : 'text-fg-muted hover:bg-bg-sunken hover:text-fg',
      )}
    >
      {children}
    </Link>
  );
}

export function PlanChooser({
  plan,
  interval,
  seats,
  workspaceId,
  workspaces,
  totalUsd,
}: PlanChooserProps) {
  const params = useSearchParams();
  const router = useRouter();
  const seatsId = useId();
  const workspaceSelectId = useId();

  const current = new URLSearchParams(params?.toString() ?? '');
  const definition = PLANS[plan];
  const saving = annualSavingPercent(plan);

  return (
    <div className="rounded-[var(--tg-radius-lg)] border border-border-subtle bg-bg-raised p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-tight">What you are buying</h2>
        <p className="text-sm">
          <span className="text-2xl font-semibold tracking-tight">${totalUsd}</span>{' '}
          <span className="text-fg-muted">
            per {interval === 'annual' ? 'year' : 'month'}
            {plan === 'team' ? `, for ${seats} seat${seats === 1 ? '' : 's'}` : ''}
          </span>
        </p>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle">Plan</p>
          <div
            role="group"
            aria-label="Plan"
            className="mt-2 inline-flex gap-1 rounded-[var(--tg-radius-md)] border border-border p-1"
          >
            <Segment
              href={hrefWith(current, { plan: 'pro', seats: null })}
              selected={plan === 'pro'}
            >
              Pro
            </Segment>
            <Segment
              href={hrefWith(current, { plan: 'team', seats: String(PLANS.team.minSeats) })}
              selected={plan === 'team'}
            >
              Team
            </Segment>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle">Billing</p>
          <div
            role="group"
            aria-label="Billing interval"
            className="mt-2 inline-flex gap-1 rounded-[var(--tg-radius-md)] border border-border p-1"
          >
            <Segment
              href={hrefWith(current, { interval: 'monthly' })}
              selected={interval === 'monthly'}
            >
              Monthly
            </Segment>
            <Segment
              href={hrefWith(current, { interval: 'annual' })}
              selected={interval === 'annual'}
            >
              Annual
              {saving > 0 ? <span className="ml-1.5 opacity-80">save {saving}%</span> : null}
            </Segment>
          </div>
        </div>

        {plan === 'team' ? (
          <>
            <div>
              <label
                htmlFor={seatsId}
                className="text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle"
              >
                Seats
              </label>
              <input
                id={seatsId}
                type="number"
                inputMode="numeric"
                min={definition.minSeats}
                max={definition.maxSeats}
                defaultValue={seats}
                // Navigates on commit rather than on every keystroke, so the
                // server is not asked to re-quote for "1" on the way to "12".
                onBlur={(event) => {
                  const next = Number.parseInt(event.target.value, 10);
                  if (!Number.isInteger(next)) return;
                  const clamped = Math.min(
                    Math.max(next, definition.minSeats),
                    definition.maxSeats,
                  );
                  if (clamped === seats) return;
                  router.replace(hrefWith(current, { seats: String(clamped) }), { scroll: false });
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
                className="mt-2 w-28 rounded-[var(--tg-radius-md)] border border-border bg-bg px-3 py-1.5 text-sm text-fg"
              />
              <p className="mt-1.5 text-xs text-fg-subtle">
                {definition.minSeats}–{definition.maxSeats}. $
                {definition[interval === 'annual' ? 'annualUsd' : 'monthlyUsd']} per seat.
              </p>
            </div>

            <div>
              <label
                htmlFor={workspaceSelectId}
                className="text-xs font-medium uppercase tracking-[0.1em] text-fg-subtle"
              >
                Workspace
              </label>
              {workspaces.length === 0 ? (
                <p className="mt-2 text-sm text-fg-muted">You do not administer a workspace yet.</p>
              ) : (
                <select
                  id={workspaceSelectId}
                  value={workspaceId ?? ''}
                  onChange={(event) =>
                    router.replace(hrefWith(current, { workspace: event.target.value }), {
                      scroll: false,
                    })
                  }
                  className="mt-2 w-full rounded-[var(--tg-radius-md)] border border-border bg-bg px-3 py-1.5 text-sm text-fg"
                >
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.name}
                    </option>
                  ))}
                </select>
              )}
              <p className="mt-1.5 text-xs text-fg-subtle">Seats are counted on this workspace.</p>
            </div>
          </>
        ) : null}
      </div>

      <ul className="mt-5 space-y-1.5 border-t border-border-subtle pt-4">
        {definition.features.map((feature) => (
          <li key={feature} className="text-sm leading-relaxed text-fg-muted">
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}
