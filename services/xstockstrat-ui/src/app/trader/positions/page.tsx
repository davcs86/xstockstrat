'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { JsonObject } from '@bufbuild/protobuf';
import type { ColumnDef } from '@tanstack/react-table';
import { AppShell } from '@/components/trader/AppShell';
import { useAccountContext } from '@/context/AccountContext';
import { usePositions } from '@/hooks/usePortfolio';
import { useReconciliationStatus } from '@/hooks/useReconciliationStatus';
import { POSITION_RISK_FLAG, HALT_SOURCE, EnumBadge } from '@/lib/opportunityShared';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatTile } from '@/components/shared/StatTile';
import { Eyebrow } from '@/components/shared/Eyebrow';
import { fmtUsd, fmtSignedUsd, fmtPct, pnlClass } from '@/lib/money';
import { formatLastRun } from '@/lib/formatLastRun';
import { usePositionLineage } from '@/hooks/usePositionLineage';
import { openR, fmtR, sideLabel, isExitFlag } from '@/lib/positionRisk';
import { traderConfigClient } from '@/lib/browserClients/traderConfigClient';
import { PositionSide } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import type { Position } from '@xstockstrat/proto/portfolio/v1/portfolio_pb';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DataTable } from '@/components/ui/data-table';

type TradingMode = 'paper' | 'live';
type PnlFilter = 'all' | 'winners' | 'losers';

export default function PositionsPage() {
  const { selectedAccountId, environmentMode, accounts } = useAccountContext();
  // Trading mode is fixed by the deployment environment — not user-selectable.
  const mode: TradingMode = environmentMode ?? 'paper';
  const [symbol, setSymbol] = useState('');
  const [side, setSide] = useState<PositionSide>(PositionSide.UNSPECIFIED);
  const [pnlFilter, setPnlFilter] = useState<PnlFilter>('all');
  const [pageToken, setPageToken] = useState('');
  const [pageStack, setPageStack] = useState<string[]>([]);
  const [selected, setSelected] = useState<Position | null>(null);

  // Any filter change resets keyset pagination back to the first page.
  function resetPaging() {
    setPageToken('');
    setPageStack([]);
  }

  const { data, error, isLoading } = usePositions(mode, selectedAccountId, {
    symbol: symbol.trim().toUpperCase(),
    side,
    pageToken,
  });

  const rawPositions = data?.positions ?? [];
  // Winners/losers filter is client-side. Wrapped in useMemo — TanStack Table requires a
  // referentially-stable `data` array, else a fresh .filter() array every render churns it.
  const positions = useMemo(
    () =>
      rawPositions.filter((p) => {
        const pnl = Number(p.unrealizedPnl ?? 0);
        if (pnlFilter === 'winners') return pnl > 0;
        if (pnlFilter === 'losers') return pnl < 0;
        return true;
      }),
    [rawPositions, pnlFilter],
  );
  const nextPageToken = data?.page?.nextPageToken ?? '';

  // Exposure risk aggregates (all from the loaded Position risk fields; weight is share of the
  // loaded page's gross market value — an approximation of portfolio weight).
  const totalGrossMV = positions.reduce((s, p) => s + Math.abs(Number(p.marketValue ?? 0)), 0);
  const weight = (p: Position) =>
    totalGrossMV ? Math.abs(Number(p.marketValue ?? 0)) / totalGrossMV : 0;
  const totalRiskAtStops = positions.reduce((s, p) => s + Number(p.riskAtStop ?? 0), 0);
  const factorWeights = new Map<string, number>();
  for (const p of positions) {
    const f = p.factor || 'Unclassified';
    factorWeights.set(f, (factorWeights.get(f) ?? 0) + weight(p));
  }
  const largestFactor = [...factorWeights.entries()].sort((a, b) => b[1] - a[1])[0];
  const largestFactorTickers = positions
    .filter((p) => (p.factor || 'Unclassified') === (largestFactor?.[0] ?? ''))
    .slice(0, 3)
    .map((p) => p.symbol)
    .join(' · ');
  const pastTarget = positions.filter((p) => {
    const r = openR(p);
    return r !== null && r >= 2;
  });
  const stopsWithin2 = positions.filter((p) => {
    const d = Number(p.stopDistancePct ?? 0);
    return p.stopPrice && d > 0 && d <= 0.02;
  });
  const exitFlagCount = positions.filter(isExitFlag).length;

  const lineage = usePositionLineage(
    selected?.symbol ?? null,
    selected?.accountId ?? selectedAccountId,
    mode,
  );

  // Reconciliation status + halt display.
  const reconciliationStatus = useReconciliationStatus(selectedAccountId);
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  // Platform-wide trading_state, checked first — the one restriction display derives from whichever
  // mechanism is active, never both.
  const platformTradingState = useQuery({
    queryKey: ['platform-trading-state'],
    queryFn: async () => {
      const resp = await traderConfigClient.getConfig({ namespace: 'platform' });
      return resp.values['trading_state']?.value.case === 'stringVal'
        ? resp.values['trading_state'].value.value
        : null;
    },
    refetchInterval: 30_000,
  });
  const platformRestricted =
    platformTradingState.data === 'REDUCE_ONLY' || platformTradingState.data === 'HALTED';

  // Exposure table columns. meta.className is static per-column, so sign-dependent pnlClass colors go
  // on an inner <span> in the cell, not the TableCell.
  const columns = useMemo<ColumnDef<Position>[]>(
    () => [
      {
        id: 'symbol',
        header: 'Asset',
        meta: { className: 'font-mono font-semibold' },
        cell: ({ row }) => (
          // Symbol links to the full-page Position view; the rest of the row opens the quick-peek
          // Sheet, so stopPropagation keeps this link from also opening it.
          <Link
            href={`/trader/positions/${encodeURIComponent(row.original.symbol)}`}
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.symbol}
          </Link>
        ),
      },
      {
        id: 'side',
        header: 'Side',
        meta: { className: 'text-muted-foreground' },
        cell: ({ row }) => sideLabel(row.original.qty),
      },
      {
        accessorKey: 'qty',
        header: 'Qty',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        id: 'price',
        header: 'Price',
        accessorFn: (p) => p.currentPrice,
        meta: { className: 'text-right tabular-nums' },
        cell: ({ row }) => fmtUsd(row.original.currentPrice),
      },
      {
        id: 'avgEntry',
        header: 'Avg Entry',
        accessorFn: (p) => p.avgEntryPrice,
        meta: { className: 'text-right tabular-nums hidden sm:table-cell' },
        cell: ({ row }) => fmtUsd(row.original.avgEntryPrice),
      },
      {
        id: 'costBasis',
        header: 'Cost Basis',
        accessorFn: (p) => p.costBasis,
        meta: { className: 'text-right tabular-nums hidden lg:table-cell' },
        cell: ({ row }) => fmtUsd(row.original.costBasis),
      },
      {
        id: 'marketValue',
        header: 'Market Value',
        accessorFn: (p) => p.marketValue,
        meta: { className: 'text-right tabular-nums hidden md:table-cell' },
        cell: ({ row }) => fmtUsd(row.original.marketValue),
      },
      {
        id: 'dayPnlUsd',
        header: "Today's P/L ($)",
        accessorFn: (p) => p.dayPnl,
        meta: { className: 'text-right tabular-nums font-semibold' },
        cell: ({ row }) => (
          <span className={pnlClass(row.original.dayPnl)}>{fmtSignedUsd(row.original.dayPnl)}</span>
        ),
      },
      {
        id: 'dayPnlPct',
        header: "Today's P/L (%)",
        accessorFn: (p) => p.dayPnlPct,
        meta: { className: 'text-right tabular-nums hidden sm:table-cell' },
        cell: ({ row }) => (
          <span className={pnlClass(row.original.dayPnl)}>{fmtPct(row.original.dayPnlPct)}</span>
        ),
      },
      {
        id: 'totalPnlUsd',
        header: 'Total P/L ($)',
        accessorFn: (p) => p.unrealizedPnl,
        meta: { className: 'text-right tabular-nums font-semibold' },
        cell: ({ row }) => (
          <span className={pnlClass(row.original.unrealizedPnl)}>
            {fmtSignedUsd(row.original.unrealizedPnl)}
          </span>
        ),
      },
      {
        id: 'totalPnlPct',
        header: 'Total P/L (%)',
        accessorFn: (p) => p.unrealizedPnlPct,
        meta: { className: 'text-right tabular-nums' },
        cell: ({ row }) => (
          <span className={pnlClass(row.original.unrealizedPnl)}>
            {fmtPct(row.original.unrealizedPnlPct)}
          </span>
        ),
      },
      // Exposure risk reframe (risk, not P&L).
      {
        id: 'weight',
        header: 'Weight',
        accessorFn: (p) => weight(p),
        meta: { className: 'text-right tabular-nums hidden sm:table-cell text-muted-foreground' },
        cell: ({ row }) => `${(weight(row.original) * 100).toFixed(1)}%`,
      },
      {
        id: 'openR',
        header: 'Open R',
        accessorFn: (p) => openR(p) ?? Number.NEGATIVE_INFINITY,
        meta: { className: 'text-right tabular-nums' },
        cell: ({ row }) => {
          const r = openR(row.original);
          return <span className={r === null ? '' : pnlClass(r)}>{fmtR(r)}</span>;
        },
      },
      {
        id: 'riskAtStop',
        header: 'Risk at stop',
        accessorFn: (p) => p.riskAtStop,
        meta: { className: 'text-right tabular-nums text-destructive hidden md:table-cell' },
        cell: ({ row }) => (row.original.riskAtStop ? `-${fmtUsd(row.original.riskAtStop)}` : '—'),
      },
      {
        id: 'exitRule',
        header: 'Exit rule',
        meta: { className: 'text-muted-foreground hidden lg:table-cell font-mono text-xs' },
        cell: ({ row }) => row.original.exitRule || '—',
      },
      {
        id: 'factor',
        header: 'Factor',
        meta: { className: 'text-right text-muted-foreground hidden lg:table-cell' },
        cell: ({ row }) => row.original.factor || 'Unclassified',
      },
      {
        id: 'stopDist',
        header: 'Stop dist',
        accessorFn: (p) => p.stopDistancePct,
        meta: { className: 'text-right tabular-nums hidden md:table-cell' },
        cell: ({ row }) => (row.original.stopPrice ? fmtPct(row.original.stopDistancePct) : '—'),
      },
      {
        id: 'flag',
        header: 'Flag',
        meta: { className: 'text-right hidden md:table-cell' },
        cell: ({ row }) =>
          row.original.flag ? <EnumBadge render={POSITION_RISK_FLAG[row.original.flag]} /> : '—',
      },
      {
        id: 'trade',
        header: () => <span className="sr-only">Trade</span>,
        enableSorting: false,
        meta: { className: 'text-right' },
        cell: ({ row }) => (
          // Quick-trade shortcut: opens the order ticket pre-filled with this symbol. stopPropagation
          // keeps the row's detail Sheet from also opening.
          <Button
            asChild
            size="sm"
            variant="outline"
            className="h-7"
            onClick={(e) => e.stopPropagation()}
          >
            <Link href={`/trader?symbol=${encodeURIComponent(row.original.symbol)}`}>Trade</Link>
          </Button>
        ),
      },
    ],
    [weight],
  );

  // Fill-lineage table columns — a bare sort baseline, no pagination/filter/column-visibility (a
  // single-position drill-down list inside a narrow Sheet).
  const lineageColumns = useMemo<ColumnDef<NonNullable<typeof lineage.data>[number]>[]>(
    () => [
      {
        id: 'order',
        header: 'Order',
        meta: { className: 'font-mono text-xs' },
        cell: ({ row }) => String(((row.original.payload ?? {}) as JsonObject).order_id ?? '—'),
      },
      {
        id: 'qty',
        header: 'Qty',
        meta: { className: 'text-right tabular-nums text-xs' },
        cell: ({ row }) => String(((row.original.payload ?? {}) as JsonObject).qty ?? '—'),
      },
      {
        id: 'fillPrice',
        header: 'Fill price',
        meta: { className: 'text-right tabular-nums text-xs' },
        cell: ({ row }) =>
          fmtUsd(Number(((row.original.payload ?? {}) as JsonObject).fill_price ?? 0)),
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Exposure</h1>
            <p className="text-sm text-muted-foreground mt-1">
              What each position is risking and what would trigger an exit — your broker has the
              P&amp;L.
            </p>
            {/* Renders nothing for the healthy, unrestricted case (no noise when healthy). */}
            {reconciliationStatus.data?.lastReconciledAt &&
              !reconciliationStatus.data.hasUnresolvedMismatch &&
              !platformRestricted &&
              !selectedAccount?.halted && (
                <p className="text-xs text-muted-foreground mt-1">
                  {formatLastRun(reconciliationStatus.data.lastReconciledAt, Date.now())}
                </p>
              )}
            {platformRestricted ? (
              <Badge variant="destructive" className="mt-1.5 gap-1">
                Trading {platformTradingState.data === 'HALTED' ? 'halted' : 'reduce-only'}{' '}
                platform-wide
              </Badge>
            ) : (
              selectedAccount?.halted && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-medium text-destructive">
                    Account halted: {selectedAccount.haltReason}
                  </span>
                  <EnumBadge render={HALT_SOURCE[selectedAccount.haltSource]} />
                </div>
              )
            )}
          </div>
          {exitFlagCount > 0 && (
            <Button asChild variant="outline" size="sm">
              <Link href="/insights/opportunities">
                {exitFlagCount} exit flag{exitFlagCount === 1 ? '' : 's'} in queue →
              </Link>
            </Button>
          )}
        </div>

        {/* Risk stat row — Exposure is framed as risk, not P&L. */}
        {positions.length > 0 && (
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-4">
            <StatTile
              size="md"
              label="Total risk at stops"
              value={fmtUsd(totalRiskAtStops)}
              tone="loss"
              sub="if every stop filled"
            />
            <StatTile
              size="md"
              label="Largest factor"
              value={
                largestFactor ? `${largestFactor[0]} ${(largestFactor[1] * 100).toFixed(0)}%` : '—'
              }
              tone="paper"
              sub={largestFactorTickers || undefined}
            />
            <StatTile
              size="md"
              label="Positions past target"
              value={pastTarget.length}
              tone="gain"
              sub={
                pastTarget
                  .map((p) => p.symbol)
                  .slice(0, 3)
                  .join(' · ') || undefined
              }
            />
            <StatTile
              size="md"
              label="Stops within 2%"
              value={stopsWithin2.length}
              tone="loss"
              sub={
                stopsWithin2
                  .map((p) => p.symbol)
                  .slice(0, 3)
                  .join(' · ') || undefined
              }
            />
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Open positions</CardTitle>
            <div className="flex items-end gap-2 flex-wrap pt-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground" htmlFor="symbol-filter">
                  Symbol
                </label>
                <Input
                  id="symbol-filter"
                  value={symbol}
                  onChange={(e) => {
                    setSymbol(e.target.value);
                    resetPaging();
                  }}
                  placeholder="All symbols"
                  className="w-36 h-8 font-mono"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">Side</label>
                <Select
                  value={String(side)}
                  onValueChange={(v) => {
                    setSide(Number(v) as PositionSide);
                    resetPaging();
                  }}
                >
                  <SelectTrigger className="w-32 h-8" aria-label="side filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(PositionSide.UNSPECIFIED)}>All sides</SelectItem>
                    <SelectItem value={String(PositionSide.LONG)}>Long</SelectItem>
                    <SelectItem value={String(PositionSide.SHORT)}>Short</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground">P&amp;L</label>
                <Select value={pnlFilter} onValueChange={(v) => setPnlFilter(v as PnlFilter)}>
                  <SelectTrigger className="w-32 h-8" aria-label="pnl filter">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="winners">Winners</SelectItem>
                    <SelectItem value="losers">Losers</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading && (
              <div className="space-y-2" data-testid="positions-loading">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            )}
            {error && <p className="text-sm text-destructive">Failed to load positions</p>}
            {!isLoading && !error && positions.length === 0 && (
              <EmptyState
                title={`No open ${mode} positions`}
                description={
                  selectedAccountId
                    ? 'Positions you hold in this account will show here.'
                    : 'Select an account in the header to load positions.'
                }
              />
            )}
            {positions.length > 0 && (
              <DataTable
                columns={columns}
                data={positions}
                getRowId={(p) => `${p.accountId ?? ''}-${p.symbol}`}
                onRowClick={(p) => setSelected(p)}
                rowClassName={() => 'cursor-pointer'}
              />
            )}

            <div className="flex items-center justify-between pt-3">
              <Button
                size="sm"
                variant="outline"
                disabled={pageStack.length === 0}
                onClick={() => {
                  const prev = pageStack[pageStack.length - 1] ?? '';
                  setPageStack(pageStack.slice(0, -1));
                  setPageToken(prev);
                }}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!nextPageToken}
                onClick={() => {
                  setPageStack([...pageStack, pageToken]);
                  setPageToken(nextPageToken);
                }}
              >
                Next
              </Button>
            </div>

            {!selectedAccountId && positions.length === 0 && (
              <Badge variant="secondary" className="mt-3">
                No account selected
              </Badge>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold">{selected?.symbol}</span>
              {selected && (
                <span className="text-xs font-normal text-muted-foreground">
                  {sideLabel(selected.qty)}
                  {selected.factor ? ` · ${selected.factor}` : ''}
                </span>
              )}
              {selected?.flag ? <EnumBadge render={POSITION_RISK_FLAG[selected.flag]} /> : null}
            </SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="px-4 space-y-5">
              <Button asChild variant="outline" size="sm" className="w-full min-h-[44px]">
                <Link href={`/trader/positions/${encodeURIComponent(selected.symbol)}`}>
                  Open full view →
                </Link>
              </Button>
              {/* Risk stat row — the single position is risk-framed, from the enriched Position risk
                  fields; em-dash fallbacks when there's no resting stop. */}
              <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border">
                <StatTile
                  size="md"
                  label="Open R"
                  value={fmtR(openR(selected))}
                  tone={
                    openR(selected) === null
                      ? undefined
                      : (openR(selected) as number) >= 0
                        ? 'gain'
                        : 'loss'
                  }
                  sub="P&L in units of risk"
                />
                <StatTile
                  size="md"
                  label="Risk at stop"
                  value={selected.riskAtStop ? `-${fmtUsd(selected.riskAtStop)}` : '—'}
                  tone={selected.riskAtStop ? 'loss' : undefined}
                  sub="if the stop filled"
                />
                <StatTile
                  size="md"
                  label="Stop distance"
                  value={selected.stopPrice ? fmtPct(selected.stopDistancePct) : '—'}
                  tone={selected.stopPrice ? 'paper' : undefined}
                  sub={selected.stopPrice ? `stop ${fmtUsd(selected.stopPrice)}` : 'no stop set'}
                />
                <StatTile
                  size="md"
                  label="Weight"
                  value={`${(weight(selected) * 100).toFixed(1)}%`}
                  sub="of loaded gross MV"
                />
              </div>

              <div>
                <Eyebrow as="p" className="mb-2">
                  Position risk
                </Eyebrow>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Factor</dt>
                  <dd className="text-right">{selected.factor || 'Unclassified'}</dd>
                  <dt className="text-muted-foreground">Exit rule</dt>
                  <dd className="text-right font-mono text-xs">{selected.exitRule || '—'}</dd>
                  <dt className="text-muted-foreground">Flag</dt>
                  <dd className="text-right">
                    {selected.flag ? POSITION_RISK_FLAG[selected.flag].label : '—'}
                  </dd>
                </dl>
              </div>

              {/* Broker-reported values (read-only mirror — the broker owns the P&L). */}
              <div>
                <Eyebrow as="p" className="mb-2">
                  Reported by broker
                </Eyebrow>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">Qty</dt>
                  <dd className="text-right tabular-nums">{selected.qty}</dd>
                  <dt className="text-muted-foreground">Avg entry</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(selected.avgEntryPrice)}</dd>
                  <dt className="text-muted-foreground">Current price</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(selected.currentPrice)}</dd>
                  <dt className="text-muted-foreground">Market value</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(selected.marketValue)}</dd>
                  <dt className="text-muted-foreground">Today&apos;s P/L</dt>
                  <dd className={`text-right tabular-nums ${pnlClass(selected.dayPnl)}`}>
                    {fmtSignedUsd(selected.dayPnl)} ({fmtPct(selected.dayPnlPct)})
                  </dd>
                  <dt className="text-muted-foreground">Total P/L</dt>
                  <dd className={`text-right tabular-nums ${pnlClass(selected.unrealizedPnl)}`}>
                    {fmtSignedUsd(selected.unrealizedPnl)} ({fmtPct(selected.unrealizedPnlPct)})
                  </dd>
                  <dt className="text-muted-foreground">Cost basis</dt>
                  <dd className="text-right tabular-nums">{fmtUsd(selected.costBasis)}</dd>
                  <dt className="text-muted-foreground">Account</dt>
                  <dd className="text-right font-mono text-xs">{selected.accountId || '—'}</dd>
                </dl>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-2">Fill lineage</h3>
                {lineage.isLoading && (
                  <p className="text-xs text-muted-foreground">Loading fills…</p>
                )}
                {!lineage.isLoading && (lineage.data?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No order.filled events for this position.
                  </p>
                )}
                {(lineage.data?.length ?? 0) > 0 && (
                  <DataTable
                    columns={lineageColumns}
                    data={lineage.data ?? []}
                    getRowId={(e, i) =>
                      `${String(((e.payload ?? {}) as JsonObject).order_id ?? '')}-${i}`
                    }
                    enablePagination={false}
                  />
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
