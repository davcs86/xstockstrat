'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
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
import { OPPORTUNITY_ACTION, IN_QUEUE_CUE, EnumBadge } from '@/lib/opportunityShared';
import { readinessState } from '@/lib/readinessRollup';
import { useOpportunities, useSetOpportunityAction } from '@/hooks/useOpportunities';
import { insightsPortfolioClient } from '@/lib/browserClients/insightsPortfolioClient';
import { SectionRenderer } from '@/components/mobile/SectionRenderer';
import type { Section } from '@/components/mobile/sections';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatTile } from '@/components/shared/StatTile';

type SortKey = 'conviction' | 'expiry';
const NINETY_MIN_MS = 90 * 60 * 1000;
// Persist the min-conviction floor so it survives a reload / navigation away and back.
const MIN_CONVICTION_KEY = 'opportunities.minConviction';

/** Readiness bar color: firing (all pass) = buy, partway = paper, none = sell, no data = muted.
 * Derived from the shared `readinessState` bucketer (feature 155) — one 4-way decision site. */
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

/** Shared pill styling for the source-filter row ("All sources" + each `ToggleGroupItem`, FR-8). */
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

/** Compact USD (e.g. $312k) for the Deployable stat. */
function compactUsd(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

/**
 * Decide → Opportunities (feature 083, FR-5). The ranked opportunity queue over
 * analysis.ListOpportunities, rendered as the handoff's conviction cards: a left edge/conviction
 * number, an action tag, thesis, source + strategy, expiry, and Review/Snooze. Conviction is a
 * defined value (never a fabricated %); rich fields the backend does not return (live price/
 * change, sparkline, per-condition values, R:R) are intentionally omitted rather than faked.
 */
export default function OpportunitiesPage() {
  const { data, isLoading, error } = useOpportunities(0);
  const opportunities = useMemo(() => data?.opportunities ?? [], [data]);

  const [minConviction, setMinConviction] = useState(0);
  const [activeSources, setActiveSources] = useState<string[]>([]);
  const [actionFilter, setActionFilter] = useState<string>('any');
  const [sortKey, setSortKey] = useState<SortKey>('conviction');
  // feature 097 — snooze/dismiss/take are now server-persisted (SetOpportunityAction). The read
  // is filtered server-side, so acting on a row + invalidating drops it on the next fetch; no
  // transient client-side `Set` (which lost state on reload / didn't sync across devices).
  const setAction = useSetOpportunityAction();

  // Hydrate the persisted min-conviction floor once on mount (client-only — reading it in the
  // initial state would mismatch the SSR render, so do it in an effect).
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

  // Deployable = real broker buying power (summed across accounts). Best-effort: on any error the
  // stat renders "—" rather than a fabricated figure.
  const { data: deployable } = useQuery({
    queryKey: ['opportunities-buying-power'],
    queryFn: async () => {
      const resp = await insightsPortfolioClient.listPortfolios({});
      return resp.portfolios.reduce((s, p) => s + Number(p.buyingPower ?? 0), 0);
    },
    retry: 0,
    staleTime: 30_000,
  });

  const sources = useMemo(
    () => Array.from(new Set(opportunities.map((o) => o.source).filter(Boolean))).sort(),
    [opportunities],
  );

  // feature 155 (FR-5): the *effective* source filter is the stored selection intersected with the
  // sources that still exist in the current (possibly refetched) queue. `sources` is derived from the
  // live `opportunities`, and `useOpportunities` refetches on an interval — so a selected source that
  // vanishes from a later fetch would otherwise leave `activeSources` referencing a source with no
  // visible pill, silently filtering the queue to empty. Intersecting at render time drops that stale
  // constraint (falling back to showing the available rows) while leaving the *stored* selection
  // untouched, so a vanished-then-returning source re-activates. No mutating `useEffect` (design.md
  // Rejected Alternatives — an effect loops on the refetch and wipes the selection on a transient empty).
  const effectiveSources = useMemo(
    () => activeSources.filter((s) => sources.includes(s)),
    [activeSources, sources],
  );

  const rows = useMemo(() => {
    const filtered = opportunities.filter(
      (o) =>
        // feature 132: a muted (deny-listed) row carries conviction 0 by design and must never be
        // filtered out by the min-conviction slider — the mute is the signal, not a low score
        // (mirrors the backend read-filter exemption; FR-5 "must not silently disappear").
        (o.muted || o.conviction >= minConviction) &&
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

  // Stat-row values (handoff framing), all computed from real queue data.
  const expiringSoon = rows.filter((o) => {
    const ms = msUntil(o.validUntil);
    return ms !== null && ms > 0 && ms <= NINETY_MIN_MS;
  });
  const exitFlags = rows.filter((o) => o.action === OpportunityActionTag.REDUCE);
  const freshEntries = rows.filter((o) => o.source && o.source !== 'portfolio');
  const tickers = (list: Opportunity[]) =>
    list
      .slice(0, 3)
      .map((o) => o.symbol)
      .join(', ') || '—';

  // Persist a disposition against the stable server key; the invalidated read then drops the row.
  const act = (o: Opportunity, action: OpportunityAction) =>
    setAction.mutate({ opportunityKey: o.opportunityKey, action });

  const reviewHref = (o: Opportunity) =>
    o.strategyId
      ? `/trader/positions/${o.symbol}?strategy=${o.strategyId}`
      : `/trader/positions/${o.symbol}`;

  // Desktop: group the ranked rows by symbol into one card each (item 14). `rows` is already
  // sorted, so a symbol's card position follows its first (highest-ranked) row.
  const symbolGroups = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const o of rows) {
      const arr = map.get(o.symbol);
      if (arr) arr.push(o);
      else map.set(o.symbol, [o]);
    }
    return [...map.entries()].map(([symbol, opps]) => ({ symbol, opps }));
  }, [rows]);

  // Mobile parity (FR-4, AC-9/10): one `signalGroup` per symbol — grouped like the desktop
  // `SymbolGroupCard` — each signal now carrying the strategy id, provenance/source chips, and
  // expiry the flat mobile row used to omit.
  const mobileSections: Section[] = symbolGroups.map((g) => ({
    kind: 'signalGroup',
    symbol: g.symbol,
    href: `/trader/positions/${g.symbol}`,
    signals: g.opps.map((o) => ({
      symbol: o.symbol,
      badge: OPPORTUNITY_ACTION[o.action],
      conviction: o.conviction,
      readiness: { passing: o.passingConditions, total: o.totalConditions },
      caption: o.thesis || undefined,
      href: reviewHref(o),
      muted: o.muted, // feature 132 — deny-listed row renders a "Muted" marker on mobile too
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

        {/* 5-stat row (handoff framing) */}
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-5">
          <StatTile
            label="Actionable now"
            value={rows.length}
            tone="accent"
            sub={`of ${opportunities.length} evaluated · conv ≥ ${Math.round(minConviction * 100)}`}
          />
          <StatTile
            label="Expiring < 90m"
            value={expiringSoon.length}
            tone="paper"
            sub={tickers(expiringSoon)}
          />
          <StatTile
            label="Exit / trim flags"
            value={exitFlags.length}
            tone="loss"
            sub={tickers(exitFlags)}
          />
          <StatTile
            label="Fresh entries"
            value={freshEntries.length}
            tone="gain"
            sub="from watchlists & screener"
          />
          <StatTile
            label="Deployable"
            value={deployable === undefined ? '—' : compactUsd(deployable)}
            sub="broker buying power"
          />
        </div>

        {/* Filters */}
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
            <ToggleGroup type="multiple" value={activeSources} onValueChange={setActiveSources}>
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

        {/* Queue — mobile: shared SectionRenderer (1:1, FR-16); desktop: conviction cards. */}
        <div className="sm:hidden">
          {isLoading ? (
            <div className="space-y-2" data-testid="opportunities-loading">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : error ? (
            <p className="text-sm text-sell">Failed to load opportunities.</p>
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
                onSnooze={(o) => act(o, OpportunityAction.SNOOZE)}
                onDismiss={(o) => act(o, OpportunityAction.DISMISS)}
                onTake={(o) => act(o, OpportunityAction.TAKE)}
                reviewHref={reviewHref}
              />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

/**
 * One symbol's card: a header (symbol + signal count) over one row per opportunity. Each row
 * carries its direction, a conviction meter, a strategy-readiness meter, provenance chips, and its
 * own act controls — so multiple signals on the same symbol (e.g. two strategies) read as a single
 * grouped unit instead of repeating the ticker down the queue. `data-muted` marks a card whose
 * every row is deny-listed (the e2e keys off it).
 */
function SymbolGroupCard({
  symbol,
  opps,
  onSnooze,
  onDismiss,
  onTake,
  reviewHref,
}: {
  symbol: string;
  opps: Opportunity[];
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
          {/* Every listed opportunity is in the ranked queue — the shared in-queue cue (icon + info
              color + text), the same render the Watchlists panel uses (feature 155, FR-1/AC-3). */}
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
  href,
  onSnooze,
  onDismiss,
  onTake,
}: {
  o: Opportunity;
  href: string;
  onSnooze: () => void;
  onDismiss: () => void;
  onTake: () => void;
}) {
  const conv = Math.round(o.conviction * 100);
  const hasReadiness = o.totalConditions > 0;
  const readyPct = hasReadiness ? Math.round((o.passingConditions / o.totalConditions) * 100) : 0;
  // feature 132: a muted (deny-listed) row is informational — no act buttons, only a link back to
  // the deny-list editor (the symbol's market page carries the mute control).
  const muted = o.muted;
  const chips = opportunityChips(o);
  return (
    <div className="space-y-2 px-4 py-3">
      {/* Direction + strategy + provenance/source chips + expiry */}
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

      {/* Conviction + strategy-readiness meters */}
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
          {hasReadiness ? (
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
