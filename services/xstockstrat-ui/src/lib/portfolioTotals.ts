// Combined-view totals over a user's account portfolios (Book page + PortfolioPanel, DRY).

export interface PortfolioFigures {
  accountId: string;
  equity: number;
  cash: number;
  buyingPower: number;
  dayPnl: number;
  totalPnl: number;
  realizedPnl?: number;
  realizedPnlLifetime?: number;
  feesSinceSnapshot?: number;
  feesLifetime?: number;
  offlineStateUnavailable?: boolean;
}

/** Shown in place of a Day/Total P&L figure the backend zeroed because offline state was unreadable. */
export const PNL_UNAVAILABLE_LABEL = 'P&L unavailable';

export interface PortfolioTotals {
  equity: number;
  cash: number;
  buyingPower: number;
  dayPnl: number;
  totalPnl: number;
  realizedSince: number;
  realizedLifetime: number;
  feesSince: number;
  feesLifetime: number;
  /** True when any summed account is degraded: its Day/Total/realized/fees are left out of the sums. */
  incomplete: boolean;
}

/** Sums every account's balances and Day/Total P&L; realized and fees exist on offline accounts only. */
export function sumPortfolioTotals(
  portfolios: readonly PortfolioFigures[],
  isOffline: (accountId: string) => boolean,
): PortfolioTotals {
  const totals: PortfolioTotals = {
    equity: 0,
    cash: 0,
    buyingPower: 0,
    dayPnl: 0,
    totalPnl: 0,
    realizedSince: 0,
    realizedLifetime: 0,
    feesSince: 0,
    feesLifetime: 0,
    incomplete: false,
  };
  for (const p of portfolios) {
    totals.equity += Number(p.equity ?? 0);
    totals.cash += Number(p.cash ?? 0);
    totals.buyingPower += Number(p.buyingPower ?? 0);
    if (p.offlineStateUnavailable) {
      totals.incomplete = true;
      continue;
    }
    totals.dayPnl += Number(p.dayPnl ?? 0);
    totals.totalPnl += Number(p.totalPnl ?? 0);
    if (isOffline(p.accountId)) {
      totals.realizedSince += Number(p.realizedPnl ?? 0);
      totals.realizedLifetime += Number(p.realizedPnlLifetime ?? 0);
      totals.feesSince += Number(p.feesSinceSnapshot ?? 0);
      totals.feesLifetime += Number(p.feesLifetime ?? 0);
    }
  }
  return totals;
}
