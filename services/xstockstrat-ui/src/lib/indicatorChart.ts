// Pure mapper: one indicator series' values + the shared parity `times` → lightweight-charts v5
// line-series data. Single source of the "unset → gap, never a fabricated 0" contract (P-03).

import type { LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';
import type { ConfigValue } from '@xstockstrat/proto/config/v1/config_pb';
import { SERIES_PALETTE, type PaletteEntry } from './seriesPalette';

/** W — bars the symbol chart draws. */
export const CHART_WINDOW_BARS = 200;
/** D fallback — must equal the seeded `ui.chart.indicator_history_bars` default (F-07). */
export const DEFAULT_HISTORY_BARS = 200;
/** D ceiling — the config write bound and the signed-off lock budget. */
export const MAX_HISTORY_BARS = 1000;

/** Minimal structural shape of a protobuf-es Timestamp (`{ seconds: bigint }`) — see chart.ts. */
export interface ProtoTime {
  seconds: bigint | number;
}

/** Minimal structural shape of an analysis `IndicatorValue`: `value` absent = UNSET (a gap). */
export interface IndicatorValueLike {
  value?: number;
}

/** Minimal structural shape of an analysis `ComponentSeries`: a non-empty `error` = failed. */
export interface ChartableComponent {
  refName: string;
  error?: string;
  series: readonly unknown[];
}

const NONE_INSUFFICIENT: ReadonlySet<string> = new Set();

/** `insufficient` = refNames lacking history (`windowIndicatorSeries`): no pane, no series. */
export function isChartable(
  c: ChartableComponent,
  insufficient: ReadonlySet<string> = NONE_INSUFFICIENT,
): boolean {
  return !c.error && c.series.length > 0 && !insufficient.has(c.refName);
}

/**
 * One palette row per component, in input order. The index runs across the whole chart, so colours
 * stay unique up to 12 series; a non-chartable component gets `[]` and consumes no index.
 */
export function seriesSlots(
  components: readonly ChartableComponent[],
  insufficient: ReadonlySet<string> = NONE_INSUFFICIENT,
): PaletteEntry[][] {
  let n = 0;
  return components.map((c) =>
    isChartable(c, insufficient)
      ? c.series.map(() => SERIES_PALETTE[n++ % SERIES_PALETTE.length])
      : [],
  );
}

/** A whitespace point `{ time }` breaks the line (a gap); `{ time, value }` draws it. */
export type IndicatorLinePoint = LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>;

/**
 * Map one series' `values` over the shared parity `times` (the aligned candlestick axis).
 *
 * - `values[i].value === undefined` (UNSET — warm-up head / gap) → a whitespace point `{ time }`, so
 *   the v5 line breaks across it. A genuine `0` → `{ time, value: 0 }` (kept, never dropped).
 * - Iterated over `times` (the axis is the source of truth); if `values` is shorter, the trailing
 *   positions become gaps — never invented data.
 */
export function toLineData(
  values: readonly IndicatorValueLike[],
  times: readonly ProtoTime[],
): IndicatorLinePoint[] {
  const points = times.map((t, i): IndicatorLinePoint => {
    const time = Number(t.seconds) as UTCTimestamp;
    const v = values[i]?.value;
    return v === undefined ? { time } : { time, value: v };
  });
  return normalizeAscendingUnique(points);
}

/** Structural shape of an analysis `ComponentSeries` as the window reads it. */
export interface ComponentSeriesLike {
  refName: string;
  error: string;
  firstValueBars: number;
  series: readonly { values: readonly IndicatorValueLike[] }[];
}

export interface WindowedIndicatorSeries<T extends ProtoTime, C extends ComponentSeriesLike> {
  components: C[];
  times: T[];
  insufficient: Set<string>;
}

/** Read D (`chart.indicator_history_bars`, an int64 `intVal`), clamped to [W, MAX_HISTORY_BARS]. */
export function readHistoryBars(values: Record<string, ConfigValue>): number {
  const v = values['chart.indicator_history_bars']?.value;
  if (v?.case !== 'intVal') return DEFAULT_HISTORY_BARS;
  return Math.min(MAX_HISTORY_BARS, Math.max(CHART_WINDOW_BARS, Number(v.value)));
}

/**
 * Window one GetIndicatorSeries response to its last `windowBars` bars. Times, H and exhaustion all
 * come from this one response, so a series cached a bar behind the page stays aligned (O-1).
 */
export function windowIndicatorSeries<T extends ProtoTime, C extends ComponentSeriesLike>(
  series: { times: readonly T[]; components: readonly C[] },
  requestedBars: number,
  windowBars: number = CHART_WINDOW_BARS,
): WindowedIndicatorSeries<T, C> {
  const h = series.times.length;
  const historyExhausted = h < requestedBars;
  const insufficient = new Set<string>();
  const components = series.components.map((c) => {
    // firstValueBars 0 = unknown P: fail open, never report.
    if (!c.error && historyExhausted && c.firstValueBars > h) insufficient.add(c.refName);
    const windowed = c.series.map((s) => ({ ...s, values: s.values.slice(-windowBars) }));
    return { ...c, series: windowed } as C;
  });
  return { components, times: series.times.slice(-windowBars), insufficient };
}

/**
 * Normalize to STRICTLY-ASCENDING, UNIQUE time — lightweight-charts v5 `setData` throws on a
 * non-monotonic or duplicate timestamp. Stable ascending sort, then collapse duplicates: the last
 * point for a timestamp wins.
 */
export function normalizeAscendingUnique(
  points: readonly IndicatorLinePoint[],
): IndicatorLinePoint[] {
  const sorted = [...points].sort((a, b) => (a.time as number) - (b.time as number));
  const out: IndicatorLinePoint[] = [];
  for (const p of sorted) {
    const last = out[out.length - 1];
    if (last && (last.time as number) === (p.time as number)) {
      out[out.length - 1] = p; // duplicate timestamp → last wins
    } else {
      out.push(p);
    }
  }
  return out;
}
