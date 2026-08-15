'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/insights/AppShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { OPPORTUNITY_ACTION, EnumBadge } from '@/lib/opportunityShared';
import { useOpportunities, useSetOpportunityAction } from '@/hooks/useOpportunities';
import { insightsPortfolioClient } from '@/lib/browserClients/insightsPortfolioClient';
import { SectionRenderer } from '@/components/mobile/SectionRenderer';
import type { Section } from '@/components/mobile/sections';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatTile } from '@/components/shared/StatTile';

type SortKey = 'conviction' | 'expiry';
const NINETY_MIN_MS = 90 * 60 * 1000;

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

  // Stable server-issued key (FR-4): survives an ENTER→ADD action flip, so a snooze/dismiss keyed
  // on it is stable too. Replaces the old `${symbol}-${source}` key.
  const key = (o: Opportunity) => o.opportunityKey;

  const rows = useMemo(() => {
    const filtered = opportunities.filter(
      (o) =>
        // feature 132: a muted (deny-listed) row carries conviction 0 by design and must never be
        // filtered out by the min-conviction slider — the mute is the signal, not a low score
        // (mirrors the backend read-filter exemption; FR-5 "must not silently disappear").
        (o.muted || o.conviction >= minConviction) &&
        (activeSources.length === 0 || activeSources.includes(o.source)) &&
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
  }, [opportunities, minConviction, activeSources, actionFilter, sortKey]);

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
      ? `/insights/market/${o.symbol}?strategy=${o.strategyId}`
      : `/insights/market/${o.symbol}`;

  // Mobile 1:1 of the queue (FR-16) — the same rows as one `signal` section each.
  const mobileSections: Section[] = rows.map((o) => ({
    kind: 'signal',
    symbol: o.symbol,
    badge: OPPORTUNITY_ACTION[o.action],
    conviction: o.conviction,
    caption: o.thesis || o.source || undefined,
    href: reviewHref(o),
    muted: o.muted, // feature 132 — deny-listed row renders a "Muted" marker on mobile too
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
              aria-pressed={activeSources.length === 0}
              className={sourceFilterPillClass(activeSources.length === 0)}
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
              onChange={(e) => setMinConviction(Number(e.target.value) / 100)}
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
            rows.map((o) => (
              <OpportunityCard
                key={key(o)}
                o={o}
                onSnooze={() => act(o, OpportunityAction.SNOOZE)}
                onDismiss={() => act(o, OpportunityAction.DISMISS)}
                onTake={() => act(o, OpportunityAction.TAKE)}
                href={reviewHref(o)}
              />
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

function OpportunityCard({
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
  // feature 132: a muted (deny-listed) row is informational — distinct styling, no action buttons,
  // and a link back to the deny-list editor (the symbol's market page carries the mute control).
  const muted = o.muted;
  return (
    <div
      data-testid="opportunity-card"
      data-muted={muted || undefined}
      className={
        muted
          ? 'flex gap-4 rounded-lg border border-dashed border-border bg-muted/30 p-4 opacity-75'
          : 'flex gap-4 rounded-lg border border-border bg-card p-4'
      }
    >
      {/* Left: conviction / conditions */}
      <div className="flex w-16 shrink-0 flex-col items-center justify-center border-r border-border pr-4">
        <span className="font-mono text-3xl font-semibold tabular-nums text-primary">{conv}</span>
        {o.totalConditions > 0 ? (
          <span className="mt-0.5 font-mono text-xs text-muted-foreground">
            {o.passingConditions}/{o.totalConditions}
          </span>
        ) : (
          <span className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.13em] text-muted-foreground">
            conv
          </span>
        )}
      </div>

      {/* Main */}
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-semibold">{o.symbol}</span>
          {muted ? (
            <Badge
              variant="outline"
              className="text-[11px]"
              data-testid={`muted-badge-${o.symbol}`}
            >
              Muted
            </Badge>
          ) : (
            <EnumBadge render={OPPORTUNITY_ACTION[o.action]} />
          )}
          {o.source && (
            <Badge variant="outline" className="text-[11px] text-muted-foreground">
              {o.source}
            </Badge>
          )}
          {o.strategyId && (
            <span className="font-mono text-xs text-muted-foreground">{o.strategyId}</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">{o.thesis || '—'}</p>
      </div>

      {/* Right: expiry + actions */}
      <div className="flex shrink-0 flex-col items-end justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          expires {expiresLabel(o.validUntil)}
        </span>
        {muted ? (
          // No Snooze/Dismiss/Review on a muted row — only a link back to the deny-list editor.
          <Button asChild size="sm" variant="outline" data-testid={`manage-deny-${o.symbol}`}>
            <Link href={href}>Manage deny list</Link>
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button asChild size="sm" onClick={onTake}>
              <Link href={href}>Review &amp; add</Link>
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onSnooze}
              data-testid={`snooze-${o.symbol}`}
            >
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
    </div>
  );
}
