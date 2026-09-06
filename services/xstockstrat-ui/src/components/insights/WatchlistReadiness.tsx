'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { X, TriangleAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConditionState, ReadinessState } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { WatchlistEntrySource } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { isFiring, rollupReadiness, readinessState } from '@/lib/readinessRollup';
import { EnumBadge } from '@/lib/opportunityShared';
import { READINESS_CUE, IN_QUEUE_CUE } from '@/lib/readinessCue';
import { UNBOUND, toApiStrategyId } from '@/hooks/useWatchlists';
import {
  useWatchlistReadiness,
  readinessRowMap,
  readinessRowKey,
  decodePairToken,
  WATCHLIST_READINESS_PAGE_SIZE,
  type WatchlistReadinessRow,
} from '@/hooks/useWatchlistReadiness';

type Readiness = NonNullable<WatchlistReadinessRow['readiness']>;
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

// Total order over the bound pairs matching the server's (symbol ASC, strategy_id ASC) keyset.
function comparePairs(a: Binding, b: Binding): number {
  if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
  if (a.strategyId === b.strategyId) return 0;
  return a.strategyId < b.strategyId ? -1 : 1;
}

/**
 * Per-watchlist readiness overlay (feature 181). Rows render IMMEDIATELY from the `['watchlists']`
 * bindings; each bound row's verdict is decorated by one page-bounded `GetWatchlistReadiness` call
 * (no client N+1 fan-out). PENDING → Skeleton, UNKNOWN → icon+text error, RESOLVED → the verdict.
 * The bound rows are keyset-paginated to match the server's page; unbound symbols follow, unpaged.
 */
export function WatchlistReadiness({
  watchlistId,
  bindings,
  inQueue,
  strategies,
  onRemoveSymbol,
  onRebindSymbol,
  disabled = false,
  selected,
  onSelectionChange,
}: {
  watchlistId: string;
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

  // Keyset pagination state. A page token stack lets Prev walk back (mirrors trader/positions).
  const [pageToken, setPageToken] = useState('');
  const [pageStack, setPageStack] = useState<string[]>([]);
  // Reset paging when the selected watchlist changes.
  useEffect(() => {
    setPageToken('');
    setPageStack([]);
  }, [watchlistId]);

  const bound = bindings.filter((b) => b.strategyId).sort(comparePairs);
  const unbound = bindings.filter((b) => !b.strategyId);

  // Slice this page from the bound pairs using the same keyset cursor the server issued.
  const cursor = decodePairToken(pageToken);
  const afterCursor = cursor
    ? bound.filter((b) => comparePairs(b, { symbol: cursor[0], strategyId: cursor[1] }) > 0)
    : bound;
  const pageBound = afterCursor.slice(0, WATCHLIST_READINESS_PAGE_SIZE);

  const { data, error } = useWatchlistReadiness(
    watchlistId,
    pageToken,
    pageBound.map((b) => ({ symbol: b.symbol, strategyId: b.strategyId })),
  );
  const byPair = readinessRowMap(data?.rows);
  const nextToken = data?.page?.nextPageToken ?? '';

  const resolved = pageBound
    .map((b) => byPair.get(readinessRowKey(b.symbol, b.strategyId)))
    .filter((rr): rr is WatchlistReadinessRow => !!rr && rr.state === ReadinessState.RESOLVED)
    .map((rr) => rr.readiness)
    .filter((r): r is Readiness => !!r);
  const counts = rollupReadiness(
    resolved,
    pageBound.map((b) => b.symbol.toUpperCase()),
  );

  if (bindings.length === 0) return null;

  const renderedSymbols = [...pageBound.map((b) => b.symbol), ...unbound.map((b) => b.symbol)];
  const allSelected = renderedSymbols.length > 0 && renderedSymbols.every((s) => sel.has(s));
  const toggleAll = () => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? new Set<string>() : new Set(renderedSymbols));
  };

  const goNext = () => {
    if (!nextToken) return;
    setPageStack((s) => [...s, pageToken]);
    setPageToken(nextToken);
  };
  const goPrev = () => {
    setPageStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      setPageToken(prev);
      return s.slice(0, -1);
    });
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
          {pageBound.length > 0 && (
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
          {pageBound.map((binding) => {
            const rr = byPair.get(readinessRowKey(binding.symbol, binding.strategyId));
            const state = rr?.state ?? ReadinessState.PENDING;
            const r = rr?.readiness;
            const queued = inQueue?.has(binding.symbol.toUpperCase()) ?? false;
            const cueState = r ? readinessState(r) : 'nodata';
            const firing = state === ReadinessState.RESOLVED && r ? isFiring(r) : false;
            return (
              <li
                key={`${binding.symbol}|${binding.strategyId}`}
                className="flex items-center gap-3 px-3 py-2 text-xs"
                data-testid={`readiness-row-${binding.symbol}`}
              >
                {rowCheckbox(binding.symbol)}
                <span className="w-14 shrink-0 font-mono font-semibold">{binding.symbol}</span>
                <SignalSourceBadge source={binding.source} />
                {/* Verdict cell — per-row state via the canonical C-17 primitives. */}
                {state === ReadinessState.RESOLVED && r ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Progress
                      value={Math.round(r.conviction * 100)}
                      className="h-1.5 w-20"
                      variant={barVariant(r)}
                    />
                    <EnumBadge
                      render={{ ...READINESS_CUE[cueState], label: stateLabel(r) }}
                      testId={`readiness-cue-${cueState}`}
                    />
                  </div>
                ) : state === ReadinessState.UNKNOWN ? (
                  <span
                    className="flex shrink-0 items-center gap-1 text-destructive"
                    role="status"
                    data-testid={`readiness-unknown-${binding.symbol}`}
                  >
                    <TriangleAlert className="h-3 w-3" aria-hidden="true" />
                    <QueryStateMessages error errorText="unavailable" />
                  </span>
                ) : (
                  <Skeleton
                    className="h-4 w-40 shrink-0 rounded"
                    role="status"
                    aria-busy="true"
                    aria-label={`Readiness loading for ${binding.symbol}`}
                    data-testid={`readiness-loading-${binding.symbol}`}
                  />
                )}
                {/* Reserve the badge column on every row so downstream columns start at the same x. */}
                <span className="w-20 shrink-0">
                  {queued && <EnumBadge render={IN_QUEUE_CUE} testId="in-queue" />}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                  {state === ReadinessState.RESOLVED && r ? blockingCondition(r) : ''}
                </span>
                {firing && r && (
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

      {/* Keyset pagination — keyboard-operable, labeled (FR-7). Shown when a page boundary exists. */}
      {(pageStack.length > 0 || nextToken) && (
        <div
          className="mt-2 flex items-center justify-end gap-2"
          data-testid="readiness-pagination"
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={goPrev}
            disabled={pageStack.length === 0}
            aria-label="Previous page of watchlist rows"
          >
            Prev
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={goNext}
            disabled={!nextToken}
            aria-label="Next page of watchlist rows"
          >
            Next
          </Button>
        </div>
      )}

      {error ? (
        <div className="mt-2">
          <QueryStateMessages error errorText="Couldn't load readiness for this page." />
        </div>
      ) : null}
    </div>
  );
}
