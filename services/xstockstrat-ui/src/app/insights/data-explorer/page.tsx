'use client';
import { useEffect, useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable } from '@/components/ui/data-table';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { EmptyState } from '@/components/shared/EmptyState';
import { QueryStateMessages } from '@/components/shared/QueryStateMessages';
import { timestampToDate, timestampToMillis } from '@/lib/protoTime';
import {
  type Bar,
  type MetricKey,
  type Period,
  FUNDAMENTAL_METRICS,
  barsToCsv,
  downloadCsv,
  historicalToCsv,
  latestBarMillis,
  latestFiledMillis,
  metricValue,
  snapshotToCsv,
  useAssetSymbols,
  useBars,
  useHistoricalFundamentals,
  useSnapshotFundamentals,
} from '@/hooks/useDataExplorer';

/**
 * Data Explorer (feature 204): browse stored daily OHLCV bars and point-in-time fundamentals for a
 * symbol, with client-paged tables/charts and CSV export. Reads marketdata via the insights BFF.
 * Daily-only bars (feature 143); `missing_metrics` renders as `—`/a gap (MARKETDATA-11).
 */

const CHART_CONFIG: ChartConfig = { value: { label: 'Value', color: 'hsl(163 100% 44%)' } };
const AXIS_TICK = { fill: 'hsl(215 16% 47%)', fontSize: 11 };

function parseDate(v: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function fmtDay(ts: { seconds: bigint | number; nanos?: number } | undefined): string {
  const d = timestampToDate(ts);
  return d ? d.toISOString().slice(0, 10) : '—';
}

function fmtRefreshed(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function fmtNum(v: number, digits = 2): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

function fmtMetric(v: number | null): string {
  if (v === null) return '—';
  if (Math.abs(v) >= 1e6)
    return v.toLocaleString('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  return fmtNum(v);
}

// OHLCV CSV filename range segment: `<start>_<end>` when a range is selected (AC-16), else `bars`.
function csvRangeTag(start?: Date, end?: Date): string {
  return start && end
    ? `${start.toISOString().slice(0, 10)}_${end.toISOString().slice(0, 10)}`
    : 'bars';
}

export default function DataExplorerPage() {
  const [symbol, setSymbol] = useState('');
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const start = parseDate(startStr);
  const end = parseDate(endStr);

  const { data: symbols } = useAssetSymbols();

  // Auto-select the first asset once the list loads so the page opens on real data (ChartPanel
  // precedent) rather than the empty prompt; a manual clear re-selects it, which is fine.
  useEffect(() => {
    if (!symbol && symbols && symbols.length > 0) setSymbol(symbols[0]);
  }, [symbols, symbol]);

  return (
    <AppShell>
      <div className="space-y-4 p-4" data-testid="data-explorer-page">
        <div>
          <h1 className="text-lg font-semibold">Data Explorer</h1>
          <p className="text-sm text-muted-foreground">
            Browse stored daily OHLCV bars and point-in-time fundamentals for a symbol.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="de-symbol">Symbol</Label>
            <Combobox
              items={symbols ?? []}
              value={symbol || null}
              onValueChange={(v) => setSymbol(v ?? '')}
              limit={50}
            >
              <ComboboxInput
                id="de-symbol"
                placeholder="Symbol"
                aria-label="Data Explorer symbol"
                showTrigger={false}
                className="w-40"
              />
              <ComboboxContent>
                <ComboboxEmpty>No matching symbols</ComboboxEmpty>
                <ComboboxList>
                  {(item: string) => (
                    <ComboboxItem key={item} value={item}>
                      {item}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="space-y-1">
            <Label htmlFor="de-start">From</Label>
            <Input
              id="de-start"
              type="date"
              value={startStr}
              onChange={(e) => setStartStr(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="de-end">To</Label>
            <Input
              id="de-end"
              type="date"
              value={endStr}
              onChange={(e) => setEndStr(e.target.value)}
              className="w-40"
            />
          </div>
        </div>

        {!symbol ? (
          <EmptyState
            title="Select a symbol"
            description="Choose a symbol to load its OHLCV bars and fundamentals."
          />
        ) : (
          <Tabs defaultValue="ohlcv">
            <TabsList>
              <TabsTrigger value="ohlcv">OHLCV</TabsTrigger>
              <TabsTrigger value="fundamentals">Fundamentals</TabsTrigger>
            </TabsList>
            <TabsContent value="ohlcv">
              <OhlcvTab symbol={symbol} start={start} end={end} />
            </TabsContent>
            <TabsContent value="fundamentals">
              <FundamentalsTab symbol={symbol} start={start} end={end} />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}

function OhlcvTab({ symbol, start, end }: { symbol: string; start?: Date; end?: Date }) {
  const query = useBars(symbol, start, end);
  const bars = useMemo<Bar[]>(() => query.data?.pages.flatMap((p) => p.bars) ?? [], [query.data]);

  const columns = useMemo<ColumnDef<Bar>[]>(
    () => [
      { id: 'time', header: 'Time', cell: ({ row }) => fmtDay(row.original.time) },
      { accessorKey: 'open', header: 'Open', cell: ({ row }) => fmtNum(row.original.open) },
      { accessorKey: 'high', header: 'High', cell: ({ row }) => fmtNum(row.original.high) },
      { accessorKey: 'low', header: 'Low', cell: ({ row }) => fmtNum(row.original.low) },
      { accessorKey: 'close', header: 'Close', cell: ({ row }) => fmtNum(row.original.close) },
      { id: 'volume', header: 'Volume', cell: ({ row }) => String(row.original.volume) },
    ],
    [],
  );

  const chartData = useMemo(
    () =>
      bars
        .map((b) => ({ t: timestampToMillis(b.time) ?? 0, close: b.close }))
        .filter((d) => d.t > 0)
        .sort((a, b) => a.t - b.t),
    [bars],
  );

  const refreshed = latestBarMillis(bars);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">
          Daily bars
          <span
            className="ml-2 text-xs font-normal text-muted-foreground"
            data-testid="de-bars-refreshed"
          >
            Last refreshed: {fmtRefreshed(refreshed)}
          </span>
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          data-testid="de-bars-csv"
          disabled={bars.length === 0}
          onClick={() =>
            downloadCsv(`${symbol}_1Day_${csvRangeTag(start, end)}.csv`, barsToCsv(bars))
          }
        >
          Download CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <QueryStateMessages
          isLoading={query.isLoading}
          error={query.error}
          loadingText="Loading bars…"
          errorText="Bars unavailable"
        />
        {!query.isLoading && !query.error && bars.length === 0 && (
          <EmptyState title="No OHLCV data found for the selected criteria" />
        )}
        {bars.length > 0 && (
          <>
            <div data-testid="de-bars-chart">
              <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[240px] w-full">
                <LineChart data={chartData}>
                  <CartesianGrid
                    xAxisId={0}
                    yAxisId={0}
                    strokeDasharray="3 3"
                    stroke="hsl(222 20% 14%)"
                  />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="time"
                    domain={['dataMin', 'dataMax']}
                    tick={AXIS_TICK}
                    tickFormatter={(v: number) => new Date(v).toISOString().slice(0, 10)}
                  />
                  <YAxis tick={AXIS_TICK} domain={['auto', 'auto']} />
                  <Tooltip
                    labelFormatter={(v) => new Date(v as number).toISOString().slice(0, 10)}
                    formatter={(v) => [fmtNum(v as number), 'Close']}
                  />
                  <Line
                    dataKey="close"
                    name="Close"
                    type="monotone"
                    stroke="hsl(163 100% 44%)"
                    dot={false}
                    strokeWidth={2}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            </div>
            <DataTable
              columns={columns}
              data={bars}
              enablePagination
              pageSize={25}
              tableTestId="de-bars-table"
            />
          </>
        )}
        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              data-testid="de-bars-loadmore"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FundamentalsTab({ symbol, start, end }: { symbol: string; start?: Date; end?: Date }) {
  return (
    <Tabs defaultValue="snapshot">
      <TabsList>
        <TabsTrigger value="snapshot">Snapshot</TabsTrigger>
        <TabsTrigger value="historical">Historical</TabsTrigger>
      </TabsList>
      <TabsContent value="snapshot">
        <SnapshotView symbol={symbol} />
      </TabsContent>
      <TabsContent value="historical">
        <HistoricalView symbol={symbol} start={start} end={end} />
      </TabsContent>
    </Tabs>
  );
}

function SnapshotView({ symbol }: { symbol: string }) {
  const { data, isLoading, error } = useSnapshotFundamentals(symbol);
  const fundamentals = data?.fundamentals;
  const refreshed = timestampToMillis(fundamentals?.asOf);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">
          Snapshot
          <span
            className="ml-2 text-xs font-normal text-muted-foreground"
            data-testid="de-fund-refreshed"
          >
            Last refreshed: {fmtRefreshed(refreshed)}
          </span>
          {fundamentals?.stale && (
            <Badge variant="warning" className="ml-2" data-testid="de-fund-stale">
              Stale
            </Badge>
          )}
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          data-testid="de-fund-csv"
          disabled={!fundamentals}
          onClick={() =>
            fundamentals &&
            downloadCsv(`${symbol}_fundamentals_snapshot.csv`, snapshotToCsv(fundamentals))
          }
        >
          Download CSV
        </Button>
      </CardHeader>
      <CardContent>
        <QueryStateMessages
          isLoading={isLoading}
          error={error}
          loadingText="Loading fundamentals…"
          errorText="Fundamentals unavailable"
        />
        {!isLoading && !error && !fundamentals && (
          <EmptyState title="No fundamentals found for this symbol" />
        )}
        {fundamentals && (
          <dl
            className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3"
            data-testid="de-fund-snapshot"
          >
            {FUNDAMENTAL_METRICS.map((m) => (
              <div
                key={m.key}
                className="flex items-center justify-between border-b border-border py-1"
              >
                <dt className="text-xs text-muted-foreground">{m.label}</dt>
                <dd className="text-sm font-medium" data-metric={m.name}>
                  {fmtMetric(metricValue(fundamentals, m))}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

function HistoricalView({ symbol, start, end }: { symbol: string; start?: Date; end?: Date }) {
  const [periodType, setPeriodType] = useState<'all' | 'quarterly' | 'annual'>('all');
  const [metric, setMetric] = useState<MetricKey>('peRatio');
  const periodTypes = periodType === 'all' ? [] : [periodType];
  const query = useHistoricalFundamentals(symbol, periodTypes, start, end);
  const periods = useMemo<Period[]>(
    () => query.data?.pages.flatMap((p) => p.periods) ?? [],
    [query.data],
  );

  const columns = useMemo<ColumnDef<Period>[]>(
    () => [
      { accessorKey: 'fiscalPeriod', header: 'Period', meta: { className: 'font-medium' } },
      { accessorKey: 'periodType', header: 'Type' },
      { id: 'periodEnd', header: 'Period end', cell: ({ row }) => fmtDay(row.original.periodEnd) },
      { id: 'filedDate', header: 'Filed', cell: ({ row }) => fmtDay(row.original.filedDate) },
      ...FUNDAMENTAL_METRICS.map(
        (m): ColumnDef<Period> => ({
          id: m.name,
          header: m.label,
          cell: ({ row }) => fmtMetric(metricValue(row.original, m)),
        }),
      ),
    ],
    [],
  );

  const selected = FUNDAMENTAL_METRICS.find((m) => m.key === metric) ?? FUNDAMENTAL_METRICS[1];
  const chartData = useMemo(
    () => periods.map((p) => ({ label: p.fiscalPeriod, value: metricValue(p, selected) })),
    [periods, selected],
  );
  const refreshed = latestFiledMillis(periods);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-sm">
          Historical
          <span
            className="ml-2 text-xs font-normal text-muted-foreground"
            data-testid="de-hist-refreshed"
          >
            Last refreshed: {fmtRefreshed(refreshed)}
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={periodType} onValueChange={(v) => setPeriodType(v as typeof periodType)}>
            <SelectTrigger className="w-32" aria-label="Period type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All periods</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="annual">Annual</SelectItem>
            </SelectContent>
          </Select>
          <Select value={metric} onValueChange={(v) => setMetric(v as MetricKey)}>
            <SelectTrigger className="w-36" aria-label="Chart metric">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FUNDAMENTAL_METRICS.map((m) => (
                <SelectItem key={m.key} value={m.key}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            data-testid="de-hist-csv"
            disabled={periods.length === 0}
            onClick={() =>
              downloadCsv(`${symbol}_fundamentals_${periodType}.csv`, historicalToCsv(periods))
            }
          >
            Download CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <QueryStateMessages
          isLoading={query.isLoading}
          error={query.error}
          loadingText="Loading fundamentals history…"
          errorText="Fundamentals history unavailable"
        />
        {!query.isLoading && !query.error && periods.length === 0 && (
          <EmptyState title="No fundamentals history found for the selected criteria" />
        )}
        {periods.length > 0 && (
          <>
            <div data-testid="de-hist-chart">
              <ChartContainer config={CHART_CONFIG} className="aspect-auto h-[240px] w-full">
                <LineChart data={chartData}>
                  <CartesianGrid
                    xAxisId={0}
                    yAxisId={0}
                    strokeDasharray="3 3"
                    stroke="hsl(222 20% 14%)"
                  />
                  <XAxis dataKey="label" tick={AXIS_TICK} />
                  <YAxis tick={AXIS_TICK} domain={['auto', 'auto']} />
                  <Tooltip formatter={(v) => [fmtMetric(v as number), selected.label]} />
                  <Line
                    dataKey="value"
                    name={selected.label}
                    type="monotone"
                    stroke="hsl(163 100% 44%)"
                    dot
                    strokeWidth={2}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ChartContainer>
            </div>
            <div className="overflow-x-auto">
              <DataTable
                columns={columns}
                data={periods}
                enablePagination
                pageSize={25}
                tableTestId="de-hist-table"
              />
            </div>
          </>
        )}
        {query.hasNextPage && (
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              data-testid="de-hist-loadmore"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
