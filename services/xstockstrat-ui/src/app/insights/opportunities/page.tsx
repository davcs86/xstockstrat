'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/insights/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/components/ui/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  OpportunityActionTag,
  OpportunityAction,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';
import type { Opportunity } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import {
  OPPORTUNITY_ACTION,
  EnumBadge,
  blockingCondition,
  ConditionChip,
} from '@/lib/opportunityShared';
import { OhlcBlock } from '@/components/shared/OhlcBlock';
import { fmtUsd, fmtPct, pnlClass } from '@/lib/money';
import { IN_QUEUE_CUE } from '@/lib/readinessCue';
import { readinessState } from '@/lib/readinessRollup';
import { useOpportunities, useSetOpportunityAction } from '@/hooks/useOpportunities';
import { useOhlcBars } from '@/hooks/useOhlcBars';
import type { OhlcData } from '@/hooks/useOhlcBars';
import { SectionRenderer } from '@/components/mobile/SectionRenderer';
import type { Section } from '@/components/mobile/sections';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { TriangleAlert } from 'lucide-react';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';

type SortKey = 'conviction' | 'expiry';
// Persist the min-conviction floor so it survives a reload / navigation away and back.
const MIN_CONVICTION_KEY = 'opportunities.minConviction';

/** Readiness bar color: firing (all pass) = buy, partway = paper, none = sell, no data = muted. */
function readinessVariant(passing: number, total: number): 'buy' | 'paper' | 'sell' | 'muted' {
  switch (readinessState({ passingConditions: passing, totalConditions: total })) {
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

/** Distinct provenance/source chips for a row (Signal source + Live/Watchlist tags), de-duped. */
function opportunityChips(o: Opportunity): string[] {
  return Array.from(new Set([o.source, ...(o.provenance ?? [])].filter(Boolean)));
}

/** Shared pill styling for the source-filter row ("All sources" + each `ToggleGroupItem`). */
function sourceFilterPillClass(active: boolean): string {
  return cn(
    'rounded-full border px-3 py-1 text-xs transition-colors',
    active
      ? 'border-primary bg-primary/20 text-foreground'
      : 'border-border text-muted-foreground hover:text-foreground',
  );
}

/** `HH:MM` local expiry from a protobuf-es Timestamp ({ seconds: bigint }); `—` when unset. */
function expiresLabel(validUntil: { seconds: bigint } | undefined): string {
  if (!validUntil || !validUntil.seconds) return '—';
  const d = new Date(Number(validUntil.seconds) * 1000);
  return d.toTimeString().slice(0, 5);
}

function msUntil(validUntil: { seconds: bigint } | undefined): number | null {
  if (!validUntil || !validUntil.seconds) return null;
  return Number(validUntil.seconds) * 1000 - Date.now();
}

/**
 * The ranked opportunity queue over analysis.ListOpportunities, as conviction cards. Conviction is
 * a defined value (never a fabricated %); live-market stats are shown only when present, never faked.
 */
export default function OpportunitiesPage() {
  const { data, isLoading, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useOpportunities(0);
  const opportunities = useMemo(() => data?.pages.flatMap((p) => p.opportunities) ?? [], [data]);

  const [minConviction, setMinConviction] = useState(0);
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState<string>('any');
  const [sortKey, setSortKey] = useState<SortKey>('conviction');
  // Actions are server-persisted (SetOpportunityAction) and the read is filtered server-side, so
  // acting on a row + invalidating drops it on the next fetch.
  const setAction = useSetOpportunityAction();

  // Hydrate persisted floor in an effect, not initial state — reading it there mismatches SSR.
  useEffect(() => {
    const stored = window.localStorage.getItem(MIN_CONVICTION_KEY);
    if (stored === null) return;
    const n = Number(stored);
    if (Number.isFinite(n)) setMinConviction(Math.min(1, Math.max(0, n)));
  }, []);

  // Persist on every change (the slider is the only writer) so the floor survives a reload.
  const updateMinConviction = (v: number) => {
    setMinConviction(v);
    try {
      window.localStorage.setItem(MIN_CONVICTION_KEY, String(v));
    } catch {
      // localStorage may be unavailable (private mode) — the in-memory value still applies.
    }
  };

  const sources = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.source).filter(Boolean))).sort(),
    [opportunities],
  );

  // Effective filter = stored selection ∩ sources still in the queue, intersected at render (not a
  // mutating effect): a vanished source can't silently empty the queue, and the selection survives.
  const effectiveSources = useMemo(
    () => activeSources.filter((s) => sources.includes(s)),
    [activeSources, sources],
  );

  const rows = useMemo(() => {
    const filtered = opportunities.filter(
      (o) =>
        // A muted (deny-listed) row and a data-unavailable row (feature 185) each carry conviction 0
        // by design and must bypass the min-conviction filter — the mute / the unavailable sentinel
        // IS the signal, not a low score. Exempt at every layer (mirrors the backend read floor,
        // fails.md:1547) so raising the slider never silently hides an unavailable row.
        (o.muted || o.dataUnavailable || o.conviction >= minConviction) &&
        (effectiveSources.length === 0 || effectiveSources.includes(o.source)) &&
        (actionFilter === 'any' || String(o.action) === actionFilter),
    );
    const sorted = [...filtered];
    if (sortKey === 'conviction') {
      sorted.sort((a, b) => b.conviction - a.conviction);
    } else {
      sorted.sort(
        (a, b) => (msUntil(a.validUntil) ?? Infinity) - (msUntil(b.validUntil) ?? Infinity),
      );
    }
    return sorted;
  }, [opportunities, minConviction, effectiveSources, actionFilter, sortKey]);

  const act = (o: Opportunity, action: OpportunityAction) =>
    setAction.mutate({ opportunityKey: o.opportunityKey, action });

  const reviewHref = (o: Opportunity) =>
    o.strategyId
      ? `/trader/positions/${o.symbol}?strategy=${o.strategyId}`
      : `/trader/positions/${o.symbol}`;

  // rows is already sorted, so each symbol's card position follows its highest-ranked row.
  const symbolGroups = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const o of rows) {
      const arr = map.get(o.symbol);
      if (arr) arr.push(o);
      else map.set(o.symbol, [o]);
    }
    return [...map.entries()].map(([symbol, opps]) => ({ symbol, opps }));
  }, [rows]);

  // OHLC bars fetched async per-symbol — decoupled from the ListOpportunities read path.
  const ohlcSymbols = useMemo(() => symbolGroups.map((g) => g.symbol), [symbolGroups]);
  const ohlcBars = useOhlcBars(ohlcSymbols);

  // Mobile parity: one `signalGroup` per symbol, grouped like the desktop `SymbolGroupCard`.
  const mobileSections: Section[] = symbolGroups.map((g) => ({
    kind: 'signalGroup',
    symbol: g.symbol,
    href: `/trader/positions/${g.symbol}`,
    signals: g.opps.map((o) => ({
      symbol: o.symbol,
      badge: OPPORTUNITY_ACTION[o.action],
      conviction: o.conviction,
      readiness: { passing: o.passingConditions, total: o.totalConditions },
      dataUnavailable: o.dataUnavailable,
      caption: o.thesis || undefined,
      href: reviewHref(o),
      muted: o.muted,
      strategyId: o.strategyId || undefined,
      chips: opportunityChips(o),
      expiry: expiresLabel(o.validUntil),
    })),
  }));

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Opportunities</h1>
          <p className="text-sm text-muted-foreground">
            Explained buy / trim / exit signals, ranked by conviction. The broker owns the ledger —
            you act with one confirmation.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveSources([])}
              aria-pressed={effectiveSources.length === 0}
              className={sourceFilterPillClass(effectiveSources.length === 0)}
            >
              All sources
            </button>
            <ToggleGroup
              type="multiple"
              value={activeSources}
              onValueChange={setActiveSources}
              className="max-w-full flex-wrap"
            >
              {sources.map((s) => (
                <ToggleGroupItem
                  key={s}
                  value={s}
                  className={sourceFilterPillClass(activeSources.includes(s))}
                >
                  {s}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="ml-auto flex items-center gap-2">
              <Select value={actionFilter} onValueChange={setActionFilter}>
                <SelectTrigger className="h-8 w-[130px]" aria-label="action filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any action</SelectItem>
                  <SelectItem value={String(OpportunityActionTag.ENTER)}>Enter</SelectItem>
                  <SelectItem value={String(OpportunityActionTag.ADD)}>Add</SelectItem>
                  <SelectItem value={String(OpportunityActionTag.REDUCE)}>Reduce</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                <SelectTrigger className="h-8 w-[150px]" aria-label="sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conviction">Sort · Conviction</SelectItem>
                  <SelectItem value="expiry">Sort · Soonest expiry</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            min conviction
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(minConviction * 100)}
              onChange={(e) => updateMinConviction(Number(e.target.value) / 100)}
              className="accent-primary"
              aria-label="Minimum conviction"
            />
            <span className="w-8 font-mono tabular-nums text-foreground">
              {Math.round(minConviction * 100)}
            </span>
          </label>
        </div>

        <div className="sm:hidden">
          {isLoading ? (
            <div className="space-y-2" data-testid="opportunities-loading">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-sell">Failed to load opportunities.</p>
          ) : data?.pages[0]?.computeFailed ? (
            // feature 185 FR-4 — a persistently-failing compute is a terminal error, not an
            // infinite spinner nor a silently-empty queue.
            <p className="text-sm text-sell" data-testid="opportunities-compute-failed">
              Couldn&apos;t compute your opportunities. This usually clears on its own — try again
              shortly.
            </p>
          ) : data?.pages[0]?.computing ? (
            // feature 185 FR-4 — a cold (never-materialized) queue is still computing; the 15s poll
            // resolves it. Distinct from a legitimately-empty universe (below).
            <div className="space-y-2" data-testid="opportunities-computing">
              <p className="text-sm text-muted-foreground">Computing your opportunities…</p>
              <Skeleton className="h-14 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No opportunities match the filter"
              description="Loosen the min-conviction slider or clear the source chips to see more."
            />
          ) : (
            <SectionRenderer sections={mobileSections} />
          )}
        </div>

        <div className="hidden space-y-3 sm:block">
          {isLoading ? (
            <div className="space-y-3" data-testid="opportunities-loading-desktop">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-sell">Failed to load opportunities.</p>
          ) : data?.pages[0]?.computeFailed ? (
            <p className="text-sm text-sell" data-testid="opportunities-compute-failed-desktop">
              Couldn&apos;t compute your opportunities. This usually clears on its own — try again
              shortly.
            </p>
          ) : data?.pages[0]?.computing ? (
            <div className="space-y-3" data-testid="opportunities-computing-desktop">
              <p className="text-sm text-muted-foreground">Computing your opportunities…</p>
              <Skeleton className="h-28 w-full" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No opportunities match the filter"
              description="Loosen the min-conviction slider or clear the source chips to see more."
            />
          ) : (
            symbolGroups.map((g) => (
              <SymbolGroupCard
                key={g.symbol}
                symbol={g.symbol}
                opps={g.opps}
                ohlcData={ohlcBars.get(g.symbol)}
                onSnooze={(o) => act(o, OpportunityAction.SNOOZE)}
                onDismiss={(o) => act(o, OpportunityAction.DISMISS)}
                onTake={(o) => act(o, OpportunityAction.TAKE)}
                reviewHref={reviewHref}
              />
            ))
          )}
        </div>

        {hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              data-testid="load-more-opportunities"
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

/**
 * One symbol's card: a header over one row per opportunity, grouping multiple signals on the same
 * symbol. `data-muted` marks a card whose every row is deny-listed (the e2e keys off it).
 */
function SymbolGroupCard({
  symbol,
  opps,
  ohlcData,
  onSnooze,
  onDismiss,
  onTake,
  reviewHref,
}: {
  symbol: string;
  opps: Opportunity[];
  ohlcData?: OhlcData | undefined;
  onSnooze: (o: Opportunity) => void;
  onDismiss: (o: Opportunity) => void;
  onTake: (o: Opportunity) => void;
  reviewHref: (o: Opportunity) => string;
}) {
  const allMuted = opps.every((o) => o.muted);
  return (
    <div
      data-testid="opportunity-card"
      data-muted={allMuted || undefined}
      className={cn(
        'overflow-hidden rounded-lg border',
        allMuted ? 'border-dashed border-border bg-muted/30 opacity-75' : 'border-border bg-card',
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href={`/trader/positions/${symbol}`}
            className="font-mono text-base font-semibold hover:underline"
          >
            {symbol}
          </Link>
          {!allMuted && <EnumBadge render={IN_QUEUE_CUE} testId="opportunity-in-queue" />}
        </div>
        <span className="text-xs text-muted-foreground">
          {opps.length} {opps.length === 1 ? 'signal' : 'signals'}
        </span>
      </div>
      <div className="divide-y divide-border">
        {opps.map((o) => (
          <OpportunityRow
            key={o.opportunityKey}
            o={o}
            ohlcData={ohlcData}
            href={reviewHref(o)}
            onSnooze={() => onSnooze(o)}
            onDismiss={() => onDismiss(o)}
            onTake={() => onTake(o)}
          />
        ))}
      </div>
    </div>
  );
}

/** A single opportunity within its symbol card: direction + meters + chips + act controls. */
function OpportunityRow({
  o,
  ohlcData,
  href,
  onSnooze,
  onDismiss,
  onTake,
}: {
  o: Opportunity;
  ohlcData?: OhlcData | undefined;
  href: string;
  onSnooze: () => void;
  onDismiss: () => void;
  onTake: () => void;
}) {
  const conv = Math.round(o.conviction * 100);
  const hasReadiness = o.totalConditions > 0;
  const readyPct = hasReadiness ? Math.round((o.passingConditions / o.totalConditions) * 100) : 0;
  // A muted (deny-listed) row is informational — no act buttons, only a deny-list link.
  const muted = o.muted;
  const chips = opportunityChips(o);
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {muted ? (
          <Badge variant="outline" className="text-[11px]" data-testid={`muted-badge-${o.symbol}`}>
            Muted
          </Badge>
        ) : (
          <EnumBadge render={OPPORTUNITY_ACTION[o.action]} />
        )}
        {o.strategyId && (
          <span className="font-mono text-xs text-muted-foreground">{o.strategyId}</span>
        )}
        {chips.map((c) => (
          <Badge key={c} variant="outline" className="text-[11px] text-muted-foreground">
            {c}
          </Badge>
        ))}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          expires {expiresLabel(o.validUntil)}
        </span>
      </div>

      <div className="grid gap-x-6 gap-y-1.5 sm:max-w-md sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            Conviction
          </span>
          <Progress value={conv} variant="default" className="h-1.5 flex-1" />
          <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">
            {conv}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
            Readiness
          </span>
          {o.dataUnavailable ? (
            // feature 185 FR-2 — a terminal data-unavailable row: an explicit "unavailable" cue via
            // the shared C-17 primitives (mirrors the watchlist readiness UNKNOWN cell), never a
            // "quiet" 0/0 verdict and never a silent reclass of an evaluated row.
            <span
              className="flex flex-1 items-center gap-1 text-destructive"
              role="status"
              data-testid={`opportunity-unavailable-${o.symbol}`}
            >
              <TriangleAlert className="h-3 w-3" aria-hidden="true" />
              <QueryStateMessages error errorText="unavailable" />
            </span>
          ) : hasReadiness ? (
            <>
              <Progress
                value={readyPct}
                variant={readinessVariant(o.passingConditions, o.totalConditions)}
                className="h-1.5 flex-1"
              />
              <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {o.passingConditions}/{o.totalConditions}
              </span>
            </>
          ) : (
            <span className="flex-1 text-xs text-muted-foreground/70">no conditions</span>
          )}
        </div>
      </div>

      {/* Live-market enrichment: each stat omitted when its field is unset, never faked. */}
      {(o.livePrice !== undefined || ohlcData !== undefined || o.conditions.length > 0) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {o.livePrice !== undefined && (
            <div className="flex items-baseline gap-2">
              <span
                className="font-mono text-sm tabular-nums text-foreground"
                data-testid={`opp-live-price-${o.symbol}`}
              >
                {fmtUsd(o.livePrice)}
              </span>
              {o.changePct !== undefined && (
                <span
                  className={cn('font-mono text-xs tabular-nums', pnlClass(o.changePct))}
                  data-testid={`opp-change-${o.symbol}`}
                >
                  {fmtPct(o.changePct)}
                </span>
              )}
            </div>
          )}
          <OhlcBlock data={ohlcData} testId={`opp-ohlc-${o.symbol}`} />
          {(() => {
            const c = blockingCondition(o.conditions);
            return c ? <ConditionChip c={c} testId={`opp-condition-${o.symbol}`} /> : null;
          })()}
        </div>
      )}

      {o.thesis && <p className="text-sm text-muted-foreground">{o.thesis}</p>}

      {muted ? (
        <Button asChild size="sm" variant="outline" data-testid={`manage-deny-${o.symbol}`}>
          <Link href={href}>Manage deny list</Link>
        </Button>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" onClick={onTake}>
            <Link href={href}>Review &amp; add</Link>
          </Button>
          <Button size="sm" variant="outline" onClick={onSnooze} data-testid={`snooze-${o.symbol}`}>
            Snooze
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onDismiss}
            data-testid={`dismiss-${o.symbol}`}
          >
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}
