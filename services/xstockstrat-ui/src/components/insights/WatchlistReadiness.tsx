'use client';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConditionState } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { WatchlistEntrySource } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { analysisClient } from '@/lib/browserClients/analysisClient';
import { isFiring, rollupReadiness, readinessState } from '@/lib/readinessRollup';
import { EnumBadge } from '@/lib/opportunityShared';
import { READINESS_CUE, IN_QUEUE_CUE } from '@/lib/readinessCue';
import { UNBOUND, toApiStrategyId } from '@/hooks/useWatchlists';

type EvaluateReadinessResult = Awaited<ReturnType<typeof analysisClient.evaluateReadiness>>;
type Readiness = EvaluateReadinessResult['readiness'][number];
type Binding = { symbol: string; strategyId: string; source?: number };
type StrategyDef = { strategyId: string; displayName?: string; liveEnabled: boolean };

/**
 * Provenance badge: a "Signal" tag on an entry the agent auto-added from an
 * ingest_signal(direction="watchlist"). Manual/unspecified entries render nothing.
 */
function SignalSourceBadge({ source }: { source?: number }) {
  if (source !== WatchlistEntrySource.SIGNAL) return null;
  return (
    <Badge variant="info" data-testid="signal-source-badge">
      Signal
    </Badge>
  );
}

/** buy = firing (all pass), paper = partway, sell = none pass, muted = no data. */
function barVariant(r: Readiness): 'buy' | 'paper' | 'sell' | 'muted' {
  switch (readinessState(r)) {
    case 'firing':
      return 'buy';
    case 'watching':
      return 'paper';
    case 'quiet':
      return 'sell';
    case 'nodata':
      return 'muted';
  }
}

/** The first not-yet-passing condition — what's holding the signal back. */
function blockingCondition(r: Readiness): string {
  const c = r.conditions.find((x) => x.state !== ConditionState.PASS);
  if (!c) return '—';
  return `${c.refName} ${c.fn} ${c.threshold.toFixed(2)}`;
}

/** Per-symbol state label: firing / N away / quiet / no data. Derived from readinessState so the
 * text always agrees with the cue icon. */
function stateLabel(r: Readiness): string {
  switch (readinessState(r)) {
    case 'firing':
      return 'firing';
    case 'watching':
      return `${r.totalConditions - r.passingConditions} away`;
    case 'quiet':
      return 'quiet';
    case 'nodata':
      return 'no data';
  }
}

/**
 * Remove + rebind controls for one readiness row. Offers live strategies (+ the currently-bound one
 * even if non-live); onRebind translates the UNBOUND sentinel to the wire-level '' strategyId.
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
    <div className="flex shrink-0 items-center gap-2">
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
 * Per-watchlist readiness overlay. Each symbol is evaluated against its own bound strategy (one
 * EvaluateReadiness per distinct strategy); an unbound symbol is shown "not evaluated", never faked.
 */
export function WatchlistReadiness({
  bindings,
  inQueue,
  strategies,
  onRemoveSymbol,
  onRebindSymbol,
  disabled = false,
  selected,
  onSelectionChange,
}: {
  bindings: Binding[];
  inQueue?: Set<string>;
  strategies: StrategyDef[];
  onRemoveSymbol: (symbol: string) => void;
  onRebindSymbol: (symbol: string, strategyId: string) => void;
  disabled?: boolean;
  // When onSelectionChange is provided, rows grow checkboxes and the parent owns the Set; absent →
  // no checkboxes (backward-compatible for other callers).
  selected?: Set<string>;
  onSelectionChange?: (next: Set<string>) => void;
}) {
  const selectable = Boolean(onSelectionChange);
  const sel = selected ?? new Set<string>();
  const toggleOne = (symbol: string) => {
    if (!onSelectionChange) return;
    const next = new Set(sel);
    if (next.has(symbol)) next.delete(symbol);
    else next.add(symbol);
    onSelectionChange(next);
  };
  // Leading checkbox cell for a row, rendered only in selection mode.
  const rowCheckbox = (symbol: string) =>
    selectable ? (
      <Checkbox
        className="shrink-0"
        checked={sel.has(symbol)}
        onCheckedChange={() => toggleOne(symbol)}
        disabled={disabled}
        aria-label={`Select ${symbol}`}
        data-testid={`select-${symbol}`}
      />
    ) : null;
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
      // feature 177 FR-2: a per-query staleTime (aligned to the 30s Opportunities cadence + 15s
      // poll) so a remount within the window reuses the cache instead of refetching. Per-query, not
      // a QueryClient default — a default would force a whole-list refetch (@AC-6/167).
      staleTime: 30_000,
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

  // Symbols in render order (bound evaluated rows first, then unbound) — the set "Select all" spans.
  const renderedSymbols = [
    ...evaluatedRows.map((x) => x.binding.symbol),
    ...unbound.map((b) => b.symbol),
  ];
  const allSelected = renderedSymbols.length > 0 && renderedSymbols.every((s) => sel.has(s));
  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? new Set<string>() : new Set(renderedSymbols));
  };

  return (
    <div className="mt-3 border-t border-border pt-3" data-testid="watchlist-readiness">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {selectable && (
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              disabled={disabled}
              aria-label="Select all symbols"
              data-testid="select-all"
            />
          )}
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

      {/* Rows carry several fixed-width controls; let them scroll within the card on a narrow
          pane instead of forcing the whole page to scroll horizontally. */}
      <div className="overflow-x-auto">
        <ul className="min-w-[22rem] divide-y divide-border rounded-md border border-border">
          {[...evaluatedRows]
            .sort((a, b) => b.r.conviction - a.r.conviction)
            .map(({ binding, r }) => {
              const queued = inQueue?.has(r.symbol.toUpperCase()) ?? false;
              const state = readinessState(r);
              const firing = isFiring(r);
              return (
                <li
                  key={binding.symbol}
                  className="flex items-center gap-3 px-3 py-2 text-xs"
                  data-testid={`readiness-row-${binding.symbol}`}
                >
                  {rowCheckbox(binding.symbol)}
                  <span className="w-14 shrink-0 font-mono font-semibold">{r.symbol}</span>
                  <SignalSourceBadge source={binding.source} />
                  <div className="flex shrink-0 items-center gap-2">
                    <Progress
                      value={Math.round(r.conviction * 100)}
                      className="h-1.5 w-20"
                      variant={barVariant(r)}
                    />
                    {/* Icon + color + text state cue — the dynamic label overrides the map's fallback;
                        icon is never the sole differentiator. */}
                    <EnumBadge
                      render={{ ...READINESS_CUE[state], label: stateLabel(r) }}
                      testId={`readiness-cue-${state}`}
                    />
                  </div>
                  {/* Reserve the badge column on every row so the blocking-condition and control
                      columns start at the same x whether or not this symbol is in queue. */}
                  <span className="w-20 shrink-0">
                    {queued && <EnumBadge render={IN_QUEUE_CUE} testId="in-queue" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                    {blockingCondition(r)}
                  </span>
                  {/* A firing row jumps to the symbol's detail; non-firing rows show nothing. */}
                  {firing && (
                    <Link
                      href={`/trader/positions/${r.symbol}?strategy=${binding.strategyId}`}
                      aria-label={`Open ${r.symbol} detail`}
                      data-testid={`jump-${binding.symbol}`}
                      className="shrink-0 font-medium text-primary hover:underline"
                    >
                      Review
                    </Link>
                  )}
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

          {/* Unbound symbols — shown as not-evaluated, never given a fabricated binding. */}
          {unbound.map((b) => (
            <li
              key={b.symbol}
              className="flex items-center gap-3 px-3 py-2 text-xs"
              data-testid={`readiness-row-${b.symbol}`}
            >
              {rowCheckbox(b.symbol)}
              <span className="w-14 shrink-0 font-mono font-semibold">{b.symbol}</span>
              <SignalSourceBadge source={b.source} />
              <span
                className="min-w-0 flex-1 truncate text-muted-foreground/60"
                data-testid={`unbound-${b.symbol}`}
              >
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
    </div>
  );
}
