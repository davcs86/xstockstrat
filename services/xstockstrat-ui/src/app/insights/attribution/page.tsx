'use client';
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/ui/data-table';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { EmptyState } from '@/components/shared/EmptyState';
import { useSignalAttribution } from '@/hooks/useSignalAttribution';

/**
 * feature 029 — Signal-performance Attribution. A sortable per-source table (trades, win rate, avg
 * return %, total P&L net of fees) over closed positions, filterable by date range and source, with
 * a CSV copy-to-clipboard export (FR-6/FR-7). Reads GetAttribution via the insights BFF
 * (useSignalAttribution); the handler is owner-scoped from the propagated x-user-id header.
 */

type Attribution = {
  sourceId: string;
  sourceName: string;
  tradeCount: number;
  winCount: number;
  winRate: number;
  avgReturn: number;
  totalPnl: number;
};

const CSV_HEADER = 'source name,trades,win rate,avg return %,total P&L';

function toCsv(rows: Attribution[]): string {
  const lines = rows.map((r) =>
    [r.sourceName, r.tradeCount, r.winRate, r.avgReturn, r.totalPnl].join(','),
  );
  return [CSV_HEADER, ...lines].join('\n');
}

function parseDate(v: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default function AttributionPage() {
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const [sourceId, setSourceId] = useState('');

  const { data, isLoading, error } = useSignalAttribution({
    start: parseDate(startStr),
    end: parseDate(endStr),
    sourceId,
  });
  const rows = useMemo(() => (data?.attributions ?? []) as Attribution[], [data]);

  const columns = useMemo<ColumnDef<Attribution>[]>(
    () => [
      { accessorKey: 'sourceName', header: 'Source', meta: { className: 'font-medium' } },
      { accessorKey: 'tradeCount', header: 'Trades', cell: ({ row }) => row.original.tradeCount },
      {
        accessorKey: 'winRate',
        header: 'Win rate',
        sortDescFirst: true,
        cell: ({ row }) => `${(row.original.winRate * 100).toFixed(1)}%`,
      },
      {
        accessorKey: 'avgReturn',
        header: 'Avg return %',
        sortDescFirst: true,
        cell: ({ row }) => `${(row.original.avgReturn * 100).toFixed(2)}%`,
      },
      {
        accessorKey: 'totalPnl',
        header: 'Total P&L',
        sortDescFirst: true,
        cell: ({ row }) => row.original.totalPnl.toFixed(2),
      },
    ],
    [],
  );

  const [copied, setCopied] = useState(false);
  const copyCsv = async () => {
    try {
      await navigator.clipboard.writeText(toCsv(rows));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  return (
    <AppShell>
      <div className="space-y-4" data-testid="attribution-page">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold">Signal Attribution</h1>
            <p className="text-sm text-muted-foreground">
              Per-source trading performance over closed positions — P&amp;L is net of fees (broker
              regulatory fees pending).
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={copyCsv}
            disabled={rows.length === 0}
            data-testid="attribution-copy"
          >
            {copied ? 'Copied' : 'Copy to clipboard'}
          </Button>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="attr-start">From</Label>
            <Input
              id="attr-start"
              type="date"
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="attr-end">To</Label>
            <Input
              id="attr-end"
              type="date"
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="attr-source">Source</Label>
            <Input
              id="attr-source"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="All sources"
              aria-label="Source filter"
              className="w-40"
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By signal source</CardTitle>
          </CardHeader>
          <CardContent>
            <QueryStateMessages
              isLoading={isLoading}
              error={error}
              loadingText="Loading attribution…"
              errorText="Attribution unavailable"
            />
            {!isLoading && !error && rows.length === 0 && (
              <EmptyState
                title="No attribution yet"
                description="Closed positions with captured signal sources will appear here."
              />
            )}
            {!isLoading && !error && rows.length > 0 && (
              <DataTable columns={columns} data={rows} tableTestId="attribution-table" />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
