import { describe, expect, it } from 'vitest';
import { sumPortfolioTotals } from './portfolioTotals';

describe('sumPortfolioTotals', () => {
  it('sums day/total over every account and realized/fees over offline accounts only (AC-30)', () => {
    const totals = sumPortfolioTotals(
      [
        {
          accountId: 'acc-1',
          equity: 16300,
          cash: 0,
          buyingPower: 0,
          dayPnl: 300,
          totalPnl: 1300,
          realizedPnl: 600,
          realizedPnlLifetime: 900,
          feesSinceSnapshot: 3,
          feesLifetime: 4.5,
        },
        {
          accountId: 'alp-1',
          equity: 10120,
          cash: 5000,
          buyingPower: 10000,
          dayPnl: 120,
          totalPnl: 500,
          realizedPnl: 50,
        },
      ],
      (id) => id === 'acc-1',
    );
    expect(totals).toEqual({
      equity: 26420,
      cash: 5000,
      buyingPower: 10000,
      dayPnl: 420,
      totalPnl: 1800,
      realizedSince: 600,
      realizedLifetime: 900,
      feesSince: 3,
      feesLifetime: 4.5,
    });
  });

  it('treats unset optionals as 0', () => {
    const totals = sumPortfolioTotals(
      [{ accountId: 'acc-2', equity: 0, cash: 0, buyingPower: 0, dayPnl: 0, totalPnl: 0 }],
      () => true,
    );
    expect(totals.realizedSince).toBe(0);
    expect(totals.feesLifetime).toBe(0);
  });
});
