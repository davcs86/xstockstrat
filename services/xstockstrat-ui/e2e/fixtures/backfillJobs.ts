/**
 * Canonical BackfillJob fixture (feature 057 Backfills page + feature 125 Symbol-page Backfill
 * coverage section). Generalized from `backfills.spec.ts`'s former inline `runningJob()` once the
 * feature-125 Backfill section became the second consumer (C-12).
 *
 * Shape source: `xstockstrat.ingest.v1.BackfillJob` (packages/proto/ingest/v1/ingest.proto).
 * Enum fields use the numeric proto values (`BackfillStatus`/`Timeframe`), which are valid both as a
 * Connect-server handler response (mock-backend.ts) and as a page.route Connect-JSON body
 * (backfills.spec.ts) — protobuf-es accepts numeric enum values from JSON. int64 fields stay strings.
 * `range` (a `common.v1.TimeRange`) is omitted by default; pass it via `over` when a test needs the
 * covered date span (`{ start: {seconds,nanos}, end: {seconds,nanos} }`).
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
import { BackfillStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';

export function backfillJob(over: Record<string, unknown> = {}) {
  return {
    jobId: 'job-1',
    symbols: ['AAPL'],
    status: BackfillStatus.RUNNING,
    barsProcessed: '100',
    barsTotal: '500',
    chunksCompleted: 1,
    chunksTotal: 5,
    failedSymbols: [],
    error: '',
    timeframe: '1d',
    timeframeEnum: Timeframe.TIMEFRAME_1DAY,
    ...over,
  };
}
