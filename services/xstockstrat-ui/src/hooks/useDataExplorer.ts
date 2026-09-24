import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { insightsMarketDataClient } from '@/lib/browserClients/insightsMarketDataClient';
import { TIMEFRAME_ENUM } from '@/lib/chart';
import { timestampToDate, timestampToMillis } from '@/lib/protoTime';

/**
 * Data Explorer query hooks + CSV/metric helpers (feature 204). Daily is the only requestable bar
 * interval (feature 143). `missing_metrics` is authoritative — a metric named there is rendered as a
 * gap/`—`, never inferred from a zero value (MARKETDATA-11).
 */

const TIMEFRAME = '1Day' as const;
const BARS_PAGE_SIZE = 500; // AC-8 — at most 500 bars per page
const HIST_PAGE_SIZE = 50; // AC-20 — at most 50 periods per page

type BarsResp = Awaited<ReturnType<typeof insightsMarketDataClient.getBars>>;
export type Bar = BarsResp['bars'][number];
type HistResp = Awaited<ReturnType<typeof insightsMarketDataClient.getHistoricalFundamentals>>;
export type Period = HistResp['periods'][number];
export type Fundamentals = NonNullable<
  Awaited<ReturnType<typeof insightsMarketDataClient.getFundamentals>>['fundamentals']
>;

export type MetricKey =
  | 'marketCap'
  | 'peRatio'
  | 'pbRatio'
  | 'dividendYield'
  | 'eps'
  | 'beta'
  | 'roe'
  | 'debtToEquity'
  | 'price'
  | 'yearHigh'
  | 'yearLow';

// `key`: protobuf-es (camelCase) field for the value; `name`: the snake_case token that appears in
// `missing_metrics`; `label`: display header.
export const FUNDAMENTAL_METRICS: ReadonlyArray<{ key: MetricKey; name: string; label: string }> = [
  { key: 'marketCap', name: 'market_cap', label: 'Market Cap' },
  { key: 'peRatio', name: 'pe_ratio', label: 'P/E' },
  { key: 'pbRatio', name: 'pb_ratio', label: 'P/B' },
  { key: 'dividendYield', name: 'dividend_yield', label: 'Div Yield' },
  { key: 'eps', name: 'eps', label: 'EPS' },
  { key: 'beta', name: 'beta', label: 'Beta' },
  { key: 'roe', name: 'roe', label: 'ROE' },
  { key: 'debtToEquity', name: 'debt_to_equity', label: 'Debt/Equity' },
  { key: 'price', name: 'price', label: 'Price' },
  { key: 'yearHigh', name: 'year_high', label: '52w High' },
  { key: 'yearLow', name: 'year_low', label: '52w Low' },
];

function dateToTimestamp(d: Date | undefined) {
  return d ? { seconds: BigInt(Math.floor(d.getTime() / 1000)), nanos: 0 } : undefined;
}

export function useAssetSymbols() {
  return useQuery({
    queryKey: ['data-explorer-assets'],
    queryFn: async () => {
      const res = await insightsMarketDataClient.listAssets({
        assetClass: 'us_equity',
        tradableOnly: true,
      });
      return res.assets.map((a) => a.symbol).filter(Boolean);
    },
    staleTime: 5 * 60_000,
  });
}

export function useBars(symbol: string, start?: Date, end?: Date) {
  return useInfiniteQuery({
    queryKey: ['data-explorer-bars', symbol, start?.toISOString() ?? '', end?.toISOString() ?? ''],
    enabled: Boolean(symbol),
    queryFn: ({ pageParam }) =>
      insightsMarketDataClient.getBars({
        symbol,
        timeframe: TIMEFRAME,
        timeframeEnum: TIMEFRAME_ENUM[TIMEFRAME],
        range: { start: dateToTimestamp(start), end: dateToTimestamp(end) },
        page: { pageSize: BARS_PAGE_SIZE, pageToken: pageParam ?? '' },
      }),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.page?.nextPageToken || undefined,
  });
}

export function useSnapshotFundamentals(symbol: string) {
  return useQuery({
    queryKey: ['data-explorer-fundamentals', symbol],
    enabled: Boolean(symbol),
    queryFn: () => insightsMarketDataClient.getFundamentals({ symbol }),
  });
}

export function useHistoricalFundamentals(
  symbol: string,
  periodTypes: string[],
  start?: Date,
  end?: Date,
) {
  return useInfiniteQuery({
    queryKey: [
      'data-explorer-hist-fundamentals',
      symbol,
      [...periodTypes].sort(),
      start?.toISOString() ?? '',
      end?.toISOString() ?? '',
    ],
    enabled: Boolean(symbol),
    queryFn: ({ pageParam }) =>
      insightsMarketDataClient.getHistoricalFundamentals({
        symbol,
        periodTypes,
        rangeStart: dateToTimestamp(start),
        rangeEnd: dateToTimestamp(end),
        page: { pageSize: HIST_PAGE_SIZE, pageToken: pageParam ?? '' },
      }),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.pagination?.nextPageToken || undefined,
  });
}

/** A metric's value, or null when the provider did not supply it (authoritative missing_metrics). */
export function metricValue(
  row:
    | Pick<Period, MetricKey | 'missingMetrics'>
    | Pick<Fundamentals, MetricKey | 'missingMetrics'>,
  metric: { key: MetricKey; name: string },
): number | null {
  return row.missingMetrics.includes(metric.name) ? null : (row[metric.key] as number);
}

function isoDate(ts: { seconds: bigint | number; nanos?: number } | undefined): string {
  return timestampToDate(ts)?.toISOString() ?? '';
}

/** Newest bar time (ms) across accumulated pages, or undefined when empty. */
export function latestBarMillis(bars: Bar[]): number | undefined {
  const times = bars.map((b) => timestampToMillis(b.time) ?? 0).filter((t) => t > 0);
  return times.length ? Math.max(...times) : undefined;
}

/** Newest filed_date (ms) across accumulated periods, or undefined when empty. */
export function latestFiledMillis(periods: Period[]): number | undefined {
  const times = periods.map((p) => timestampToMillis(p.filedDate) ?? 0).filter((t) => t > 0);
  return times.length ? Math.max(...times) : undefined;
}

export function barsToCsv(bars: Bar[]): string {
  const header = 'time,open,high,low,close,volume';
  const lines = bars.map((b) =>
    [isoDate(b.time), b.open, b.high, b.low, b.close, b.volume].join(','),
  );
  return [header, ...lines].join('\n');
}

export function snapshotToCsv(f: Fundamentals): string {
  const header = ['symbol', 'as_of', ...FUNDAMENTAL_METRICS.map((m) => m.name)].join(',');
  const row = [
    f.symbol,
    isoDate(f.asOf),
    ...FUNDAMENTAL_METRICS.map((m) => metricValue(f, m) ?? ''),
  ].join(',');
  return [header, row].join('\n');
}

export function historicalToCsv(periods: Period[]): string {
  const header = [
    'symbol',
    'fiscal_period',
    'period_type',
    'period_end',
    'filed_date',
    ...FUNDAMENTAL_METRICS.map((m) => m.name),
  ].join(',');
  const lines = periods.map((p) => {
    const cells = [
      p.symbol,
      p.fiscalPeriod,
      p.periodType,
      isoDate(p.periodEnd),
      isoDate(p.filedDate),
      // Blank cell for a missing metric (MARKETDATA-11), else the value.
      ...FUNDAMENTAL_METRICS.map((m) => metricValue(p, m) ?? ''),
    ];
    return cells.join(',');
  });
  return [header, ...lines].join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
