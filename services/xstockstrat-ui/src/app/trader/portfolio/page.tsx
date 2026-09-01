'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { AppShell } from '@/components/trader/AppShell';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatTile } from '@/components/shared/StatTile';
import { CardNotice } from '@/components/shared/CardNotice';
import { Eyebrow } from '@/components/shared/Eyebrow';
import { DataTable } from '@/components/ui/data-table';
import { useAccountContext } from '@/context/AccountContext';
import { usePortfolios, usePositions } from '@/hooks/usePortfolio';
import { brokerLabel } from '@/lib/brokers';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import { fmtUsd, fmtSignedUsd, fmtPct, pnlClass } from '@/lib/money';

/**
 * Book → Portfolio (feature 083, FR-14). A read-only mirror of what the brokers report — Alpaca
 * and IBKR own the ledger and P&L; xstockstrat never writes to it (AC-8, C-10(b)). Combined
 * balances + one card per account + the broker-reported positions table, all polled at 10s. The
 * valuation source is the single broker-authoritative one shared with Exposure.
 */
export default function PortfolioPage() {
  const { accounts, selectedAccountId, environmentMode } = useAccountContext();
  const mode = environmentMode ?? 'paper';
  // Combined view: all accounts (null → no account filter).
  const { data: portfoliosData, isLoading, error } = usePortfolios(null);
  const portfolios = portfoliosData?.portfolios ?? [];
  // Broker-reported positions for the selected account (full Position columns).
  const { data: positionsData } = usePositions(mode, selectedAccountId);
  const positions = positionsData?.positions ?? [];

  const accountName = (accountId: string) =>
    accounts.find((a) => a.id === accountId)?.displayName ?? accountId;

  const combined = portfolios.reduce(
    (acc, p) => ({
      equity: acc.equity + Number(p.equity ?? 0),
      cash: acc.cash + Number(p.cash ?? 0),
      buyingPower: acc.buyingPower + Number(p.buyingPower ?? 0),
      dayPnl: acc.dayPnl + Number(p.dayPnl ?? 0),
      totalPnl: acc.totalPnl + Number(p.totalPnl ?? 0),
    }),
    { equity: 0, cash: 0, buyingPower: 0, dayPnl: 0, totalPnl: 0 },
  );
  const cashPct = combined.equity ? combined.cash / combined.equity : 0;

  type PositionRow = (typeof positions)[number];

  const columns = useMemo<ColumnDef<PositionRow>[]>(
    () => [
      {
        accessorKey: 'symbol',
        header: 'Symbol',
        meta: { className: 'font-mono font-semibold' },
        cell: ({ row }) => (
          <Link
            href={`/trader/positions/${encodeURIComponent(row.original.symbol)}`}
            className="hover:underline"
          >
            {row.original.symbol}
          </Link>
        ),
      },
      {
        id: 'account',
        header: 'Account',
        accessorFn: (p) => accountName(p.accountId),
        meta: { className: 'hidden sm:table-cell text-muted-foreground' },
      },
      {
        accessorKey: 'qty',
        header: 'Qty',
        meta: { className: 'text-right tabular-nums' },
      },
      {
        accessorKey: 'avgEntryPrice',
        header: 'Avg cost',
        meta: { className: 'text-right tabular-nums hidden md:table-cell' },
        cell: ({ row }) => fmtUsd(row.original.avgEntryPrice),
      },
      {
        accessorKey: 'marketValue',
        header: 'Mkt value',
        meta: { className: 'text-right tabular-nums' },
        cell: ({ row }) => fmtUsd(row.original.marketValue),
      },
      {
        accessorKey: 'unrealizedPnl',
        header: 'Unrealized',
        meta: { className: 'text-right tabular-nums' },
        cell: ({ row }) => (
          <span className={pnlClass(row.original.unrealizedPnl)}>
            {fmtSignedUsd(row.original.unrealizedPnl)}
          </span>
        ),
      },
      {
        accessorKey: 'dayPnl',
        header: 'Day P&L',
        meta: { className: 'text-right tabular-nums hidden sm:table-cell' },
        cell: ({ row }) => (
          <span className={pnlClass(row.original.dayPnl)}>{fmtSignedUsd(row.original.dayPnl)}</span>
        ),
      },
    ],
    [accountName],
  );

  // Feature 021 — export the caller's ledger events (last 90 days, all types by default, AC-9).
  // Goes through fetch() (not a bare <a href>) so the session-cookie'd refresh interceptor applies;
  // the blob is handed to a transient download link to present the browser's save dialog.
  const onExportEvents = async () => {
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
    const qs = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
    const res = await fetch(`/trader/api/ledger/export?${qs.toString()}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ledger-events.ndjson';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Portfolio</h1>
            <p className="text-sm text-muted-foreground mt-1">
              A read-only mirror of what your brokers report — the broker owns the ledger and the
              P&amp;L.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onExportEvents}>
              Export events
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/trader/positions">See risk in Exposure →</Link>
            </Button>
          </div>
        </div>

        {isLoading && <CardNotice>Loading portfolio…</CardNotice>}
        {error && <CardNotice variant="error">Portfolio unavailable</CardNotice>}

        {!isLoading && !error && portfolios.length > 0 && (
          <>
            {/* Combined 5-stat row */}
            <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border sm:grid-cols-5">
              <StatTile
                label="Combined equity"
                value={fmtUsd(combined.equity)}
                sub={`${portfolios.length} account${portfolios.length === 1 ? '' : 's'}`}
              />
              <StatTile
                label="Cash"
                value={fmtUsd(combined.cash)}
                sub={`${(cashPct * 100).toFixed(0)}% of equity`}
              />
              <StatTile label="Buying power" value={fmtUsd(combined.buyingPower)} />
              <StatTile
                label="Day P&L"
                value={fmtSignedUsd(combined.dayPnl)}
                tone={combined.dayPnl >= 0 ? 'gain' : 'loss'}
                sub="blended"
              />
              <StatTile
                label="Total P&L"
                value={fmtSignedUsd(combined.totalPnl)}
                tone={combined.totalPnl >= 0 ? 'gain' : 'loss'}
                sub="open + realized"
              />
            </div>

            {/* Account cards */}
            <div className="grid gap-4 md:grid-cols-2">
              {portfolios.map((p) => {
                const acct = accounts.find((a) => a.id === p.accountId);
                // Offline accounts have no account_balances row (feature 157), so Cash / Buying power /
                // Day P&L / Total P&L are broker-only concepts that misrepresent them as $0 (feature 159 /
                // FR-3). Show only the meaningful fields on an offline account's card.
                const isOffline = acct?.brokerType === BrokerType.OFFLINE;
                return (
                  <Card key={p.portfolioId || p.accountId}>
                    <CardContent className="pt-5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{accountName(p.accountId)}</span>
                        {acct && (
                          <Badge variant="secondary" className="text-[10px]">
                            {brokerLabel(acct.brokerType)}
                          </Badge>
                        )}
                      </div>
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                        <Field label="Equity" value={fmtUsd(p.equity)} />
                        {!isOffline && (
                          <>
                            <Field label="Cash" value={fmtUsd(p.cash)} />
                            <Field
                              label="Buying power"
                              value={p.buyingPower ? fmtUsd(p.buyingPower) : '—'}
                            />
                            <Field
                              label="Day P&L"
                              value={`${fmtSignedUsd(p.dayPnl)} (${fmtPct(p.dayPnlPct)})`}
                              valueClass={pnlClass(p.dayPnl)}
                            />
                            <Field
                              label="Total P&L"
                              value={fmtSignedUsd(p.totalPnl)}
                              valueClass={pnlClass(p.totalPnl)}
                            />
                          </>
                        )}
                        <Field
                          label="Positions"
                          value={
                            p.positions.length > 0 ? `${p.positions.length} open` : 'flat today'
                          }
                        />
                      </dl>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Broker-reported positions (selected account) */}
            <div>
              <Eyebrow as="p" className="mb-2">
                Positions · reported by broker
              </Eyebrow>
              {positions.length === 0 ? (
                <CardNotice>No open positions in the selected account.</CardNotice>
              ) : (
                <DataTable
                  columns={columns}
                  data={positions}
                  getRowId={(p) => `${p.accountId}-${p.symbol}`}
                />
              )}
            </div>
          </>
        )}

        <p className="text-xs text-muted-foreground" data-testid="ledger-disclaimer">
          Balances refresh every 10s from the broker · xstockstrat never writes to the ledger — the
          broker is the source of truth for positions and P&amp;L.
        </p>
      </div>
    </AppShell>
  );
}

function Field({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col">
      <Eyebrow as="dt">{label}</Eyebrow>
      <dd className={`tabular-nums ${valueClass ?? ''}`}>{value}</dd>
    </div>
  );
}
