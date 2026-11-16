/**
 * History-length GetIndicatorSeriesResponse builders for the symbol page's deep indicator history
 * (feature 341): a response of `n` bars with one SMA component per period, so a test can choose H
 * (bars returned) against P (a component's first-value bars). Consumer: `src/lib/indicatorChart.test.ts`.
 *
 * Shape source: `xstockstrat.analysis.v1.GetIndicatorSeriesResponse` (analysis.proto), protobuf-es
 * init shape. Enums numeric. A `NamedSeries.values[i]` of `{}` is UNSET (a warm-up gap, never 0.0).
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
const FIRST_DAY_SECONDS = 1704067200; // 2024-01-01T00:00:00Z
const DAY_SECONDS = 86_400;

/** `n` ascending daily timestamps. */
export const historyTimes = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    seconds: BigInt(FIRST_DAY_SECONDS + i * DAY_SECONDS),
    nanos: 0,
  }));

/** One SMA component over `n` bars: `period - 1` leading gaps, then a value on every bar. */
export const smaComponent = (refName: string, period: number, n: number) => ({
  refName,
  kind: 1, // COMPONENT_KIND_BUILTIN_INDICATOR
  series: [
    {
      name: 'value',
      values: Array.from({ length: n }, (_, i) => (i < period - 1 ? {} : { value: 100 + i })),
    },
  ],
  error: '',
  firstValueBars: period,
});

/** A response of `n` bars with one `sma<period>` component per period. */
export const indicatorSeriesResponse = (n: number, periods: readonly number[]) => ({
  times: historyTimes(n),
  components: periods.map((p) => smaComponent(`sma${p}`, p, n)),
});
