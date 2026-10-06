import { ConnectError, Code } from '@connectrpc/connect';

// Shared strategy-score display helpers — the grade colours + rating→badge mapping in one place
// (DRY guard rail, C-10).

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

// Trading days per year — mirrors the literal `252` in the analysis engine's `_compute_metrics`.
// A domain constant, deliberately duplicated rather than plumbed through config.
export const TRADING_DAYS_PER_YEAR = 252;

// Render an evidence-days count as human-readable "symbol-years" (trading days / trading year),
// e.g. 2100 days → "8.3 symbol-years".
export function formatSymbolYears(days: number): string {
  return `${(days / TRADING_DAYS_PER_YEAR).toFixed(1)} symbol-years`;
}

// feature 199 — render the per-opportunity composite_score as a fixed 3-decimal string; a NULL/absent
// score is an em-dash at the call site, never 0.000. It is a ranking ordinal, not a probability.
export function formatComposite(score: number): string {
  return score.toFixed(3);
}

// feature 221 — the composite is a k=1 shrinkage toward 0.5 (reachable ≈0.25–0.83), so it gets
// centred diverging bands, not the strategy-grade scoreColor thresholds.
export const COMPOSITE_NEUTRAL = 0.5;
export const COMPOSITE_NEUTRAL_BAND = 0.08;

export function compositeColor(score: number): string {
  if (score > COMPOSITE_NEUTRAL + COMPOSITE_NEUTRAL_BAND) return 'text-buy';
  if (score < COMPOSITE_NEUTRAL - COMPOSITE_NEUTRAL_BAND) return 'text-sell';
  return 'text-muted-foreground';
}

// True only for a gRPC NOT_FOUND — used by retry predicates so an unscored strategy (answered
// NOT_FOUND) is not retried. Pure fn, unit-testable without React Query.
export function isNotFoundError(err: unknown): boolean {
  return err instanceof ConnectError && err.code === Code.NotFound;
}
