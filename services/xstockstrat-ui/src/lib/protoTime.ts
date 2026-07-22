/**
 * Canonical proto-Timestamp → JS time conversions (feature 068).
 *
 * The generated ts-proto Timestamp carries bigint seconds; components had been inlining
 * `new Date(Number(ts.seconds) * 1000)` per call site (DRY guard rail — this is the one
 * shared home). Node-environment-safe: no DOM usage.
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
