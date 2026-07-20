'use client';
import { useState } from 'react';
import Link from 'next/link';
import type { JsonObject } from '@bufbuild/protobuf';
import { AppShell } from '@/components/trader/AppShell';
import { useAccountContext } from '@/context/AccountContext';
import { usePositions } from '@/hooks/usePortfolio';
import { usePositionLineage } from '@/hooks/usePositionLineage';
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
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

type TradingMode = 'paper' | 'live';
type PnlFilter = 'all' | 'winners' | 'losers';

function fmtUsd(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  const pct = Number(n) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

function fmtSignedUsd(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return '—';
  return `${Number(n) >= 0 ? '+' : ''}${fmtUsd(n)}`;
}

// pnlClass colors a P&L figure green/red by sign, matching the buy/sell palette.
function pnlClass(n: number | undefined | null): string {
  return Number(n ?? 0) >= 0 ? 'text-buy' : 'text-destructive';
}

// sideLabel derives Long/Short from the signed quantity (qty < 0 is short).
function sideLabel(qty: number | undefined | null): string {
  return Number(qty ?? 0) < 0 ? 'Short' : 'Long';
}

export default function PositionsPage() {
  const { selectedAccountId, environmentMode } = useAccountContext();
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
  // Winners/losers P&L-sign filter is applied client-side over the enriched unrealizedPnl.
  const positions = rawPositions.filter((p) => {
    const pnl = Number(p.unrealizedPnl ?? 0);
    if (pnlFilter === 'winners') return pnl > 0;
    if (pnlFilter === 'losers') return pnl < 0;
    return true;
  });
  const nextPageToken = data?.page?.nextPageToken ?? '';

  const lineage = usePositionLineage(
    selected?.symbol ?? null,
    selected?.accountId ?? selectedAccountId,
    mode,
  );

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Positions</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Open positions for the selected account, refreshed every 10s
            </p>
          </div>
        </div>

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
            {isLoading && <p className="text-sm text-muted-foreground">Loading positions…</p>}
            {error && <p className="text-sm text-destructive">Failed to load positions</p>}
            {!isLoading && !error && positions.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No open {mode} positions
                {selectedAccountId ? '' : ' (select an account in the header)'}
              </p>
            )}
            {positions.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Avg Entry</TableHead>
                    <TableHead className="text-right hidden lg:table-cell">Cost Basis</TableHead>
                    <TableHead className="text-right hidden md:table-cell">Market Value</TableHead>
                    <TableHead className="text-right">Today&apos;s P/L ($)</TableHead>
                    <TableHead className="text-right hidden sm:table-cell">Today&apos;s P/L (%)</TableHead>
                    <TableHead className="text-right">Total P/L ($)</TableHead>
                    <TableHead className="text-right">Total P/L (%)</TableHead>
                    <TableHead className="text-right sr-only">Trade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {positions.map((p) => (
                    <TableRow
                      key={`${p.accountId ?? ''}-${p.symbol}`}
                      onClick={() => setSelected(p)}
                      className="cursor-pointer"
                    >
                      <TableCell className="font-mono font-semibold">{p.symbol}</TableCell>
                      <TableCell className="text-muted-foreground">{sideLabel(p.qty)}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.qty}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUsd(p.currentPrice)}</TableCell>
                      <TableCell className="text-right tabular-nums hidden sm:table-cell">
                        {fmtUsd(p.avgEntryPrice)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums hidden lg:table-cell">
                        {fmtUsd(p.costBasis)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums hidden md:table-cell">
                        {fmtUsd(p.marketValue)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${pnlClass(p.dayPnl)}`}>
                        {fmtSignedUsd(p.dayPnl)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums hidden sm:table-cell ${pnlClass(p.dayPnl)}`}
                      >
                        {fmtPct(p.dayPnlPct)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${pnlClass(p.unrealizedPnl)}`}>
                        {fmtSignedUsd(p.unrealizedPnl)}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${pnlClass(p.unrealizedPnl)}`}>
                        {fmtPct(p.unrealizedPnlPct)}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* Quick-trade shortcut: opens the order ticket pre-filled with this
                            symbol. stopPropagation so the row's detail Sheet doesn't also open. */}
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="h-7"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link href={`/trader?symbol=${encodeURIComponent(p.symbol)}`}>Trade</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
            <SheetTitle className="font-mono">{selected?.symbol} — position detail</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="px-4 space-y-4">
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

              <div>
                <h3 className="text-sm font-semibold mb-2">Fill lineage</h3>
                {lineage.isLoading && (
                  <p className="text-xs text-muted-foreground">Loading fills…</p>
                )}
                {!lineage.isLoading && (lineage.data?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">No order.filled events for this position.</p>
                )}
                {(lineage.data?.length ?? 0) > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Order</TableHead>
                        <TableHead className="text-right text-xs">Qty</TableHead>
                        <TableHead className="text-right text-xs">Fill price</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(lineage.data ?? []).map((e, i) => {
                        const p = (e.payload ?? {}) as JsonObject;
                        return (
                          <TableRow key={`${String(p.order_id ?? '')}-${i}`}>
                            <TableCell className="font-mono text-xs">
                              {String(p.order_id ?? '—')}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {String(p.qty ?? '—')}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-xs">
                              {fmtUsd(Number(p.fill_price ?? 0))}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </AppShell>
  );
}
