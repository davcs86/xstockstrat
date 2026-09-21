/**
 * Canonical proto-Timestamp → JS time conversions. The generated Timestamp carries bigint seconds;
 * this is the one shared home (DRY guard rail). Node-environment-safe: no DOM usage.
 */

export interface ProtoTimestamp {
  seconds: bigint | number;
  nanos?: number;
}

export function timestampToMillis(ts: ProtoTimestamp | undefined): number | undefined {
  if (!ts) return undefined;
  return Number(ts.seconds) * 1000 + Math.floor((ts.nanos ?? 0) / 1_000_000);
}

export function timestampToDate(ts: ProtoTimestamp | undefined): Date | undefined {
  const ms = timestampToMillis(ts);
  return ms === undefined ? undefined : new Date(ms);
}

export type OhlcData = { date: Date; open: number; high: number; low: number; close: number };

export function fmtShortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function selectOhlcBar(
  bars: ReadonlyArray<{
    time?: ProtoTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  }>,
  now?: Date,
): OhlcData | undefined {
  if (bars.length === 0) return undefined;
  const today = now ?? new Date();
  const todayUtc = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;
  // Bars are ascending chronological; most recent is last.
  for (let i = bars.length - 1; i >= 0; i--) {
    const d = timestampToDate(bars[i].time);
    if (!d) continue;
    const barUtc = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
    if (barUtc === todayUtc) continue;
    return {
      date: d,
      open: bars[i].open,
      high: bars[i].high,
      low: bars[i].low,
      close: bars[i].close,
    };
  }
  return undefined;
}
