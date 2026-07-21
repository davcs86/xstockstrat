import { ConnectError, Code } from '@connectrpc/connect';

// Shared strategy-score display helpers (feature 065). Extracted from the three render surfaces
// that each duplicated ratingVariant/scoreColor (strategies list, strategy detail, insights
// dashboard) so the grade colours + rating→badge mapping live in one place (DRY guard rail, C-10).

export function ratingVariant(rating: string): 'buy' | 'info' | 'warning' | 'destructive' {
  if (rating === 'A') return 'buy';
  if (rating === 'B') return 'info';
  if (rating === 'C') return 'warning';
  return 'destructive';
}

export function scoreColor(score: number): string {
  if (score >= 0.8) return 'text-buy';
  if (score >= 0.6) return 'text-paper';
  return 'text-destructive';
}

// Trading days per year — mirrors the literal `252` in the analysis engine's `_compute_metrics`
// (services/xstockstrat-analysis/app/handlers/servicer.py). It is a domain constant, not a config
// value, so it is duplicated with this comment rather than plumbed through config.
export const TRADING_DAYS_PER_YEAR = 252;

// Render an evidence-days count as human-readable "symbol-years" (feature 065). Evidence breadth
// is measured in trading days across symbols; dividing by the trading year makes it legible, e.g.
// 2100 days → "8.3 symbol-years".
export function formatSymbolYears(days: number): string {
  return `${(days / TRADING_DAYS_PER_YEAR).toFixed(1)} symbol-years`;
}

// True only for a gRPC NOT_FOUND — used by the strategy-report retry predicate so an unscored
// strategy (which the derived-grade backend now answers with NOT_FOUND) is not retried, and by the
// detail page to render the cleared-grade empty state. Exported as a pure fn so it is unit-testable
// without mounting React Query.
export function isNotFoundError(err: unknown): boolean {
  return err instanceof ConnectError && err.code === Code.NotFound;
}
