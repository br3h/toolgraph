/**
 * Plan pricing.
 *
 * The reason these exist: `priceUsd` is the single definition of what a
 * purchase costs, read by the pricing page, the checkout panel and the payment
 * verifier alike. If it ever disagrees with itself between those three, a user
 * is shown one number and charged another — which, with an irreversible crypto
 * transfer, is somebody losing money with no chargeback to fall back on.
 */

import { describe, expect, it } from 'vitest';

import {
  ANNUAL_INTERVAL_DAYS,
  PLANS,
  PLAN_INTERVAL_DAYS,
  annualSavingPercent,
  formatPrice,
  intervalDays,
  priceUsd,
  type BillingInterval,
  type PlanId,
} from './plan';

describe('priceUsd', () => {
  it('prices Pro monthly and annually', () => {
    expect(priceUsd('pro', 'monthly')).toBe(15);
    expect(priceUsd('pro', 'annual')).toBe(150);
  });

  it('makes annual a real saving, not a presentation of the monthly price', () => {
    const monthlyOverAYear = PLANS.pro.monthlyUsd * 12;
    expect(priceUsd('pro', 'annual')).toBeLessThan(monthlyOverAYear);
    // Two months free, exactly — which is what the pricing copy claims.
    expect(monthlyOverAYear - (priceUsd('pro', 'annual') as number)).toBe(PLANS.pro.monthlyUsd * 2);
  });

  it('multiplies Team by seats', () => {
    expect(priceUsd('team', 'monthly', 2)).toBe(24);
    expect(priceUsd('team', 'monthly', 10)).toBe(120);
    expect(priceUsd('team', 'annual', 10)).toBe(1200);
  });

  it('refuses the free plan rather than returning zero', () => {
    // Zero would be indistinguishable from "this costs nothing to buy", and a
    // caller would happily record a payment of $0 as a purchase.
    expect(priceUsd('free', 'monthly')).toBeNull();
    expect(priceUsd('free', 'annual')).toBeNull();
  });

  it('refuses a seat count outside the plan range', () => {
    expect(priceUsd('team', 'monthly', 1)).toBeNull();
    expect(priceUsd('team', 'monthly', PLANS.team.maxSeats + 1)).toBeNull();
    // Pro is a single-seat plan; asking for two is not a discount, it is a bug.
    expect(priceUsd('pro', 'monthly', 2)).toBeNull();
  });

  it('refuses a non-integer or negative seat count', () => {
    expect(priceUsd('team', 'monthly', 2.5)).toBeNull();
    expect(priceUsd('team', 'monthly', -3)).toBeNull();
    expect(priceUsd('team', 'monthly', Number.NaN)).toBeNull();
  });

  it('never returns a price that is not a positive finite number', () => {
    const plans: PlanId[] = ['free', 'pro', 'team'];
    const intervals: BillingInterval[] = ['monthly', 'annual'];

    for (const plan of plans) {
      for (const interval of intervals) {
        for (const seats of [1, 2, 5, 50]) {
          const price = priceUsd(plan, interval, seats);
          if (price === null) continue;
          expect(Number.isFinite(price)).toBe(true);
          expect(price).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('intervalDays', () => {
  it('gives a genuinely longer period for annual', () => {
    expect(intervalDays('monthly')).toBe(PLAN_INTERVAL_DAYS);
    expect(intervalDays('annual')).toBe(ANNUAL_INTERVAL_DAYS);
    expect(intervalDays('annual')).toBeGreaterThan(intervalDays('monthly') * 11);
  });
});

describe('annualSavingPercent', () => {
  it('is derived from the two prices rather than asserted', () => {
    // The pricing page renders this number next to the toggle. Deriving it means
    // it cannot claim a discount the prices do not actually give.
    expect(annualSavingPercent('pro')).toBe(17);
    expect(annualSavingPercent('team')).toBe(17);
  });

  it('is zero for a plan with no monthly price', () => {
    expect(annualSavingPercent('free')).toBe(0);
  });
});

describe('formatPrice', () => {
  it('says per seat only for the plan that is sold per seat', () => {
    expect(formatPrice('pro', 'monthly')).toBe('$15 / month');
    expect(formatPrice('pro', 'annual')).toBe('$150 / year');
    expect(formatPrice('team', 'monthly')).toBe('$12 / seat / month');
    expect(formatPrice('team', 'annual')).toBe('$120 / seat / year');
    expect(formatPrice('free', 'monthly')).toBe('Free');
  });
});

describe('plan definitions', () => {
  it('keeps Team above its minimum and Pro single-seat', () => {
    expect(PLANS.team.minSeats).toBeGreaterThan(1);
    expect(PLANS.pro.minSeats).toBe(1);
    expect(PLANS.pro.maxSeats).toBe(1);
  });

  it('prices Team below Pro per seat, which is what makes it a team plan', () => {
    expect(PLANS.team.monthlyUsd).toBeLessThan(PLANS.pro.monthlyUsd);
  });

  it('describes every plan it sells', () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.name.length).toBeGreaterThan(0);
      expect(plan.tagline.length).toBeGreaterThan(0);
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });
});
