// Watchlist readiness roll-up helpers. Readiness is the traced evaluation of a strategy's entry rule
// over a watchlist's symbols (analysis EvaluateReadiness).
//
// Params are structural (not the React-Query-inferred `Readiness` type) so this module stays pure and
// unit-testable under the vitest `src/lib/**` coverage scope.

/** A firing signal: at least one condition and every condition passing. */
export function isFiring(r: { passingConditions: number; totalConditions: number }): boolean {
  return r.totalConditions > 0 && r.passingConditions === r.totalConditions;
}

/** The five readiness states a symbol can be in against its strategy. */
export type ReadinessState = 'firing' | 'watching' | 'quiet' | 'nodata' | 'unreadable';

/**
 * The single source of the firing/watching/quiet/no-data decision — counts, Progress variants, row
 * labels, and the READINESS_CUE lookup all derive from it, rather than re-branching inline. `nodata`
 * (`totalConditions === 0`) is an un-evaluable symbol, never folded into `quiet`. `unreadable` is checked
 * first: a marked row is 0/0 and must never read as `nodata`.
 */
export function readinessState(r: {
  passingConditions: number;
  totalConditions: number;
  formulaUnreadable: boolean;
}): ReadinessState {
  if (r.formulaUnreadable) return 'unreadable';
  if (r.totalConditions === 0) return 'nodata';
  if (isFiring(r)) return 'firing';
  if (r.passingConditions > 0) return 'watching';
  return 'quiet';
}

export interface ReadinessCounts {
  ready: number; // all conditions pass (firing)
  watching: number; // some conditions pass, not all
  quiet: number; // no conditions pass, but the rule was evaluated
  nodata: number; // the rule could not be evaluated for this symbol (no conditions)
  unreadable: number; // a formula in the strategy is not readable by the caller (feature 289)
}

/**
 * Bucket each requested symbol into ready / watching / quiet / no-data / unreadable. A requested
 * symbol with no matching readiness row is counted as `nodata`, so `ready + watching + quiet +
 * nodata + unreadable === requestedSymbols.length` holds even if the producer returns fewer rows.
 */
export function rollupReadiness(
  readiness: Array<{
    symbol: string;
    passingConditions: number;
    totalConditions: number;
    formulaUnreadable: boolean;
  }>,
  requestedSymbols: string[],
): ReadinessCounts {
  const counts: ReadinessCounts = { ready: 0, watching: 0, quiet: 0, nodata: 0, unreadable: 0 };
  const bySymbol = new Map(readiness.map((r) => [r.symbol, r]));

  for (const symbol of requestedSymbols) {
    const r = bySymbol.get(symbol);
    if (!r) {
      counts.nodata += 1;
    } else if (r.formulaUnreadable) {
      counts.unreadable += 1;
    } else if (r.totalConditions === 0) {
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
