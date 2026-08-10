'use client';
import { useQueries } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { cn } from '@/components/ui/utils';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConditionState } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { isFiring, rollupReadiness } from '@/lib/readinessRollup';
import { UNBOUND, toApiStrategyId } from '@/hooks/useWatchlists';

type EvaluateReadinessResult = Awaited<ReturnType<typeof analysisClient.evaluateReadiness>>;
type Readiness = EvaluateReadinessResult['readiness'][number];
type Binding = { symbol: string; strategyId: string };
type StrategyDef = { strategyId: string; displayName?: string; liveEnabled: boolean };

const hasData = (r: Readiness) => r.totalConditions > 0;

/** Green = firing (all pass), paper = partway, sell = none pass, muted = no data (feature 083/097). */
function barVariant(r: Readiness): 'buy' | 'paper' | 'sell' | 'muted' {
  if (!hasData(r)) return 'muted';
  if (isFiring(r)) return 'buy';
  if (r.passingConditions > 0) return 'paper';
  return 'sell';
}

/** The first not-yet-passing condition — what's holding the signal back. */
function blockingCondition(r: Readiness): string {
  const c = r.conditions.find((x) => x.state !== ConditionState.PASS);
  if (!c) return '—';
  return `${c.refName} ${c.fn} ${c.threshold.toFixed(2)}`;
}

/** Per-symbol state label: firing / N away / no data (an un-evaluable symbol). */
function stateLabel(r: Readiness): string {
  if (!hasData(r)) return 'no data';
  if (isFiring(r)) return 'firing';
  return `${r.totalConditions - r.passingConditions} away`;
}

/**
 * Remove + rebind controls for one readiness row (feature 110, FR-1/FR-2) — shared by the bound
 * and unbound row branches below. Stateless (no internal `useState`, matches this file's own
 * "never a fabricated binding" discipline). `strategies` is the full, unfiltered list; this
 * component replicates the live-strategy filter (+ keep the currently-bound strategy visible even
 * if it's gone non-live) that `WatchlistDetail.tsx`'s own `strategyOptions()` already applies to
 * the chip row this replaces, so relocating the control doesn't silently drop that behavior.
 * `onRebind`'s `onValueChange` is the ONE place the Select's UNBOUND sentinel is translated to the
 * wire-level '' strategyId before calling back up.
 */
function BindingRowControls({
  symbol,
  strategyId,
  strategies,
  onRebind,
  onRemove,
  disabled,
}: {
  symbol: string;
  strategyId: string;
  strategies: StrategyDef[];
  onRebind: (symbol: string, strategyId: string) => void;
  onRemove: (symbol: string) => void;
  disabled: boolean;
}) {
  const liveStrategies = strategies.filter((s) => s.liveEnabled);
  const options =
    !strategyId || liveStrategies.some((s) => s.strategyId === strategyId)
      ? liveStrategies
      : [...liveStrategies, ...strategies.filter((s) => s.strategyId === strategyId)];
  return (
    <div className="flex items-center gap-2">
      <Select
        value={strategyId || UNBOUND}
        onValueChange={(v) => onRebind(symbol, toApiStrategyId(v))}
        disabled={disabled}
      >
        <SelectTrigger className="h-7 w-32 text-xs" aria-label={`Strategy for ${symbol}`}>
          <SelectValue placeholder="Bind a strategy…">
            {options.find((s) => s.strategyId === strategyId)?.displayName ||
              strategyId ||
              undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNBOUND}>Unbound</SelectItem>
          {options.map((s) => (
            <SelectItem key={s.strategyId} value={s.strategyId}>
              {s.displayName || s.strategyId}
              {!s.liveEnabled ? ' (non-live)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <button
        type="button"
        aria-label={`Remove ${symbol}`}
        onClick={() => onRemove(symbol)}
        disabled={disabled}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

/**
 * Per-watchlist readiness overlay (feature 083/098, per-symbol bindings by feature 097). Each
 * symbol is evaluated against **its own bound strategy** (FR-6) — the transient whole-list
 * `useState('')` strategy picker is gone. Symbols are grouped by their bound `strategyId` and one
 * `EvaluateReadiness` runs per distinct strategy (via `useQueries`); results merge into a per-symbol
 * map. An **unbound** symbol (`strategyId === ''`) is shown as *not evaluated* — never given a
 * fabricated binding (P-03). The ready/watching/quiet/no-data roll-up (over bound symbols) and the
 * "in queue" mark are preserved.
 */
export function WatchlistReadiness({
  bindings,
  inQueue,
  strategies,
  onRemoveSymbol,
  onRebindSymbol,
  disabled = false,
}: {
  bindings: Binding[];
  inQueue?: Set<string>;
  strategies: StrategyDef[];
  onRemoveSymbol: (symbol: string) => void;
  onRebindSymbol: (symbol: string, strategyId: string) => void;
  disabled?: boolean;
}) {
  const bound = bindings.filter((b) => b.strategyId);
  const unbound = bindings.filter((b) => !b.strategyId);

  // Group bound symbols by strategy so we issue one EvaluateReadiness per distinct strategy.
  const byStrategy = new Map<string, string[]>();
  for (const b of bound) {
    byStrategy.set(b.strategyId, [...(byStrategy.get(b.strategyId) ?? []), b.symbol]);
  }
  const groups = [...byStrategy.entries()]; // [strategyId, symbols][]

  const results = useQueries({
    queries: groups.map(([strategyId, symbols]) => ({
      queryKey: ['readiness', strategyId, [...symbols].sort()],
      queryFn: () => analysisClient.evaluateReadiness({ strategyId, symbols }),
    })),
  });

  // Merge every group's rows into one per-symbol readiness map (keyed upper-cased).
  const readinessBySymbol = new Map<string, Readiness>();
  results.forEach((res) => {
    for (const r of res.data?.readiness ?? []) {
      readinessBySymbol.set(r.symbol.toUpperCase(), r);
    }
  });

  const evaluatedRows = bound
    .map((b) => ({ binding: b, r: readinessBySymbol.get(b.symbol.toUpperCase()) }))
    .filter((x): x is { binding: Binding; r: Readiness } => Boolean(x.r));

  const counts = rollupReadiness(
    evaluatedRows.map((x) => x.r),
    bound.map((b) => b.symbol.toUpperCase()),
  );

  if (bindings.length === 0) return null;

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="watchlist-readiness">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          Readiness — each symbol against its bound strategy
          {bound.length > 0 && (
            <span className="ml-1" data-testid="readiness-rollup">
              · <span className="text-buy">{counts.ready} ready</span> · {counts.watching} watching
              · {counts.quiet} quiet
              {counts.nodata > 0 && <> · {counts.nodata} no-data</>}
            </span>
          )}
        </span>
      </div>

      <ul className="divide-y divide-border rounded-md border border-border">
        {/* Bound symbols, ranked by conviction. */}
        {[...evaluatedRows]
          .sort((a, b) => b.r.conviction - a.r.conviction)
          .map(({ binding, r }) => {
            const queued = inQueue?.has(r.symbol.toUpperCase()) ?? false;
            return (
              <li
                key={binding.symbol}
                className="flex items-center gap-3 px-3 py-2 text-xs"
                data-testid={`readiness-row-${binding.symbol}`}
              >
                <span className="w-14 font-mono font-semibold">{r.symbol}</span>
                <div className="flex items-center gap-2">
                  <Progress
                    value={Math.round(r.conviction * 100)}
                    className="h-1.5 w-20"
                    variant={barVariant(r)}
                  />
                  <span
                    className={cn(
                      'w-16 font-mono tabular-nums',
                      isFiring(r)
                        ? 'text-buy'
                        : hasData(r)
                          ? 'text-muted-foreground'
                          : 'text-muted-foreground/60',
                    )}
                  >
                    {stateLabel(r)}
                  </span>
                </div>
                {queued && (
                  <Badge variant="info" data-testid="in-queue">
                    in queue
                  </Badge>
                )}
                <span className="ml-auto truncate font-mono text-muted-foreground">
                  {blockingCondition(r)}
                </span>
                <BindingRowControls
                  symbol={binding.symbol}
                  strategyId={binding.strategyId}
                  strategies={strategies}
                  onRebind={onRebindSymbol}
                  onRemove={onRemoveSymbol}
                  disabled={disabled}
                />
              </li>
            );
          })}

        {/* Unbound symbols — shown as not-evaluated, never given a fabricated binding (P-03). */}
        {unbound.map((b) => (
          <li
            key={b.symbol}
            className="flex items-center gap-3 px-3 py-2 text-xs"
            data-testid={`readiness-row-${b.symbol}`}
          >
            <span className="w-14 font-mono font-semibold">{b.symbol}</span>
            <span className="text-muted-foreground/60" data-testid={`unbound-${b.symbol}`}>
              not evaluated — bind a strategy
            </span>
            <BindingRowControls
              symbol={b.symbol}
              strategyId={b.strategyId}
              strategies={strategies}
              onRebind={onRebindSymbol}
              onRemove={onRemoveSymbol}
              disabled={disabled}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
