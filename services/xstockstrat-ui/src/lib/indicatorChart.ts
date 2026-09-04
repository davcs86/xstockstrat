// Pure mapper: one indicator series' values + the shared parity `times` → lightweight-charts v5
// line-series data. Single source of the "unset → gap, never a fabricated 0" contract (P-03).

import type { LineData, UTCTimestamp, WhitespaceData } from 'lightweight-charts';

/** Minimal structural shape of a protobuf-es Timestamp (`{ seconds: bigint }`) — see chart.ts. */
export interface ProtoTime {
  seconds: bigint | number;
}

/** Minimal structural shape of an analysis `IndicatorValue`: `value` absent = UNSET (a gap). */
export interface IndicatorValueLike {
  value?: number;
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
