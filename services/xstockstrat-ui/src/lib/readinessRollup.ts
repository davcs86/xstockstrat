// Watchlist readiness roll-up helpers (feature 097).
//
// Readiness is the traced evaluation of a strategy's entry rule over a watchlist's symbols
// (analysis EvaluateReadiness). These pure helpers bucket each symbol so the Watchlists detail can
// show a "<N> ready · <N> watching · <N> quiet · <N> no-data" head-line and each row its state.
//
// Params are structural (not the React-Query-inferred `Readiness` type) so this module stays pure
// and unit-testable under the vitest `src/lib/**` coverage scope.

/** A firing signal: at least one condition and every condition passing. */
export function isFiring(r: { passingConditions: number; totalConditions: number }): boolean {
  return r.totalConditions > 0 && r.passingConditions === r.totalConditions;
}

export interface ReadinessCounts {
  ready: number; // all conditions pass (firing)
  watching: number; // some conditions pass, not all
  quiet: number; // no conditions pass, but the rule was evaluated
  nodata: number; // the rule could not be evaluated for this symbol (no conditions)
}

/**
 * Bucket each requested symbol into ready / watching / quiet / no-data.
 *
 * `nodata` (`totalConditions === 0`) is the honest mapping of the evaluator's per-symbol
 * empty-readiness fallback (bar-fetch failure) — an un-evaluable symbol is "no data", never folded
 * into "quiet" (which would read as "not close to firing").
 *
 * The count is reconciled against `requestedSymbols`: a requested symbol with no matching readiness
 * row is also counted as `nodata`, so `ready + watching + quiet + nodata === requestedSymbols.length`
 * holds even if the producer returns fewer rows than requested (defends the count-parity invariant
 * beyond the current 1:1 producer guarantee).
 */
export function rollupReadiness(
  readiness: Array<{ symbol: string; passingConditions: number; totalConditions: number }>,
  requestedSymbols: string[],
): ReadinessCounts {
  const counts: ReadinessCounts = { ready: 0, watching: 0, quiet: 0, nodata: 0 };
  const bySymbol = new Map(readiness.map((r) => [r.symbol, r]));

  for (const symbol of requestedSymbols) {
    const r = bySymbol.get(symbol);
    if (!r || r.totalConditions === 0) {
      counts.nodata += 1;
    } else if (isFiring(r)) {
      counts.ready += 1;
    } else if (r.passingConditions > 0) {
      counts.watching += 1;
    } else {
      counts.quiet += 1;
    }
  }
  return counts;
}
