import { Code, ConnectError } from '@connectrpc/connect';
import type { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';
import { BackfillStatus, type FillMode } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import type { insightsIngestClient } from '@/lib/browserClients/insightsIngestClient';
import { errMessage } from '@/lib/errMessage';
import { timestampToDate, timestampToMillis } from '@/lib/protoTime';

type Ts = { seconds: bigint; nanos?: number };
type RangeLike = { start?: Ts; end?: Ts };
type Int64Like = bigint | string | number;

export type TriggerBackfillInput = Parameters<typeof insightsIngestClient.triggerBackfill>[0];

export interface GapLike {
  symbol: string;
  timeframe: Timeframe;
  gap?: RangeLike;
}

export interface BackfillJobLike {
  status: BackfillStatus;
  barsProcessed?: Int64Like;
  barsTotal?: Int64Like;
  error?: string;
  chunksTotal?: number;
  chunksCompleted?: number;
}

export type BackfillJobState = 'running' | 'ready' | 'failed' | 'partial' | 'canceled';

// Must match ingest's denial contract; backtestBackfill.test.ts pins both against
// services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json.
export const SELF_SERVE_DENIAL_PREFIX = 'self-serve backfill denied: ';
export const SELF_SERVE_DENIAL_TOKENS = [
  'multi_symbol',
  'data_kind',
  'fill_mode',
  'overwrite',
  'range_unset',
  'range_too_long',
  'callback_url',
  'no_user',
] as const;

const DAY_MS = 86_400_000;
const MAX_DAYS_SUFFIX = / \(max (\d+) days\)$/;

export function gapToBackfillRequest(
  gap: GapLike,
  opts: { fillMode?: FillMode; rangeEnd?: Ts } = {},
): TriggerBackfillInput {
  return {
    symbols: [gap.symbol],
    timeframeEnum: gap.timeframe,
    range: { start: gap.gap?.start, end: opts.rangeEnd ?? gap.gap?.end },
    overwrite: false,
    ...(opts.fillMode !== undefined && { fillMode: opts.fillMode }),
  };
}

export function backfillSpanDays(range: RangeLike | undefined): number {
  const start = timestampToMillis(range?.start);
  const end = timestampToMillis(range?.end);
  if (start === undefined || end === undefined) return 0;
  return Math.ceil((end - start) / DAY_MS);
}

export function gapKey(gap: GapLike): string {
  return [gap.symbol, gap.gap?.start?.seconds, gap.gap?.end?.seconds].map(String).join('|');
}

export function backfillJobMessage(
  job: BackfillJobLike,
  symbol: string,
): { state: BackfillJobState; text: string } {
  const chunksTotal = job.chunksTotal ?? 0;
  const chunksFailed = chunksTotal - (job.chunksCompleted ?? 0);
  switch (job.status) {
    case BackfillStatus.COMPLETED:
      return { state: 'ready', text: 'Data ready' };
    case BackfillStatus.FAILED:
      if (job.error) return { state: 'failed', text: `Backfill failed: ${job.error}` };
      if (chunksTotal > 0) {
        return {
          state: 'failed',
          text: `Backfill failed: ${chunksFailed} of ${chunksTotal} chunks failed`,
        };
      }
      return { state: 'failed', text: 'Backfill failed' };
    case BackfillStatus.PARTIAL:
      if (chunksFailed > 0) {
        return {
          state: 'partial',
          text: `Backfill partial: ${chunksFailed} of ${chunksTotal} chunks failed`,
        };
      }
      return {
        state: 'partial',
        text: `Backfill partial: ${symbol} returned no data for part of the range`,
      };
    case BackfillStatus.CANCELED:
      return { state: 'canceled', text: 'Backfill canceled' };
    default: {
      const barsTotal = Number(job.barsTotal ?? 0);
      if (barsTotal > 0) {
        return {
          state: 'running',
          text: `Backfilling… ${Number(job.barsProcessed ?? 0)} / ${barsTotal} bars`,
        };
      }
      return { state: 'running', text: 'Backfilling…' };
    }
  }
}

export function triggerErrorMessage(
  err: unknown,
  ctx: { symbol: string; spanDays: number },
): string {
  if (err instanceof ConnectError && err.code === Code.AlreadyExists) {
    return `A backfill for ${ctx.symbol} is already queued or running. Try again when it finishes.`;
  }
  if (err instanceof ConnectError && err.code === Code.PermissionDenied) {
    const raw = err.rawMessage;
    const token = raw.startsWith(SELF_SERVE_DENIAL_PREFIX)
      ? raw.slice(SELF_SERVE_DENIAL_PREFIX.length).split(' ')[0]
      : undefined;
    const max = token === 'range_too_long' ? MAX_DAYS_SUFFIX.exec(raw)?.[1] : undefined;
    if (max !== undefined) {
      return `This backtest needs ${ctx.spanDays} days of history, more than the self-serve limit of ${max} days. Ask an admin to backfill ${ctx.symbol}.`;
    }
    return `This backfill is not available here. Ask an admin to backfill ${ctx.symbol}.`;
  }
  return `Could not start backfill: ${errMessage(err)}`;
}

const utcDate = (ts: Ts | undefined) => timestampToDate(ts)?.toISOString().slice(0, 10) ?? '?';

export function noVendorDataMessage(gap: GapLike): string {
  return `No vendor data for ${utcDate(gap.gap?.start)} to ${utcDate(gap.gap?.end)}`;
}
