import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Code, ConnectError } from '@connectrpc/connect';
import { BackfillStatus, FillMode } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { describe, expect, it } from 'vitest';
import { insufficientDataResult } from '../../e2e/fixtures/backtests';
import { backfillJob } from '../../e2e/fixtures/backfillJobs';
import {
  SELF_SERVE_DENIAL_PREFIX,
  SELF_SERVE_DENIAL_TOKENS,
  backfillJobMessage,
  backfillSpanDays,
  gapKey,
  gapToBackfillRequest,
  noVendorDataMessage,
  triggerErrorMessage,
} from './backtestBackfill';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const contract = JSON.parse(
  readFileSync(ROOT + 'services/xstockstrat-ingest/tests/fixtures/self_serve_denial.json', 'utf8'),
) as { prefix: string; tokens: string[]; range_too_long_suffix: string };

const ts = (isoDate: string) => ({ seconds: BigInt(Date.parse(isoDate) / 1000), nanos: 0 });
const WINDOW = { start: ts('2024-01-01'), end: ts('2024-12-31') };
const gapFor = (symbol: string) =>
  insufficientDataResult('strat-1', [symbol], WINDOW).coverageGaps[0];

const GENERIC = 'This backfill is not available here. Ask an admin to backfill LYFT.';
const denied = (detail: string) => new ConnectError(detail, Code.PermissionDenied);
const overCapDetail = (maxDays: number) =>
  contract.prefix +
  'range_too_long' +
  contract.range_too_long_suffix.replace('{max_days}', String(maxDays));

describe('self-serve denial contract (shared ingest fixture)', () => {
  it('pins the prefix and the token order to the ingest contract', () => {
    expect(SELF_SERVE_DENIAL_PREFIX).toBe(contract.prefix);
    expect([...SELF_SERVE_DENIAL_TOKENS]).toEqual(contract.tokens);
  });

  it('parses the configured cap from the ingest range_too_long detail', () => {
    expect(triggerErrorMessage(denied(overCapDetail(730)), { symbol: 'LYFT', spanDays: 900 })).toBe(
      'This backtest needs 900 days of history, more than the self-serve limit of 730 days. Ask an admin to backfill LYFT.',
    );
  });
});

describe('gapToBackfillRequest', () => {
  it('@AC-2 requests gap start through the backtest window end under GAPS_ONLY', () => {
    const gap = gapFor('LYFT');
    const req = gapToBackfillRequest(gap, {
      fillMode: FillMode.GAPS_ONLY,
      rangeEnd: gap.requestedRange?.end,
    });
    expect(req).toEqual({
      symbols: ['LYFT'],
      timeframeEnum: gap.timeframe,
      range: { start: gap.gap?.start, end: WINDOW.end },
      overwrite: false,
      fillMode: FillMode.GAPS_ONLY,
    });
    expect(req.range?.end).not.toEqual(gap.gap?.end);
  });

  it('@AC-10 keeps the exact gap when no window end is given', () => {
    const gap = gapFor('AAPL');
    const req = gapToBackfillRequest(gap, { fillMode: FillMode.GAPS_ONLY });
    expect(req.range).toEqual(gap.gap);
    expect(req.fillMode).toBe(FillMode.GAPS_ONLY);
  });

  it('@AC-10 with no options equals the existing inline request and sends no fillMode', () => {
    const gap = gapFor('AAPL');
    const req = gapToBackfillRequest(gap);
    expect('fillMode' in req).toBe(false);
    expect(req).toEqual({
      symbols: [gap.symbol],
      timeframeEnum: gap.timeframe,
      range: gap.gap,
      overwrite: false,
    });
  });
});

describe('backfillJobMessage', () => {
  it.each([
    [
      '@AC-3 running with a bar total (string int64)',
      backfillJob({ barsProcessed: '120', barsTotal: '200' }),
      { state: 'running', text: 'Backfilling… 120 / 200 bars' },
    ],
    [
      '@AC-3 running with a bar total (bigint int64)',
      backfillJob({ barsProcessed: BigInt(120), barsTotal: BigInt(200) }),
      { state: 'running', text: 'Backfilling… 120 / 200 bars' },
    ],
    [
      '@AC-14 queued with no bar total',
      backfillJob({ status: BackfillStatus.QUEUED, barsProcessed: '0', barsTotal: '0' }),
      { state: 'running', text: 'Backfilling…' },
    ],
    [
      'completed',
      backfillJob({ status: BackfillStatus.COMPLETED }),
      { state: 'ready', text: 'Data ready' },
    ],
    [
      '@AC-6 failed with an error',
      backfillJob({ status: BackfillStatus.FAILED, error: 'vendor rate limit exceeded' }),
      { state: 'failed', text: 'Backfill failed: vendor rate limit exceeded' },
    ],
    [
      '@AC-16 failed with no error, chunk counts',
      backfillJob({ status: BackfillStatus.FAILED, chunksCompleted: 0, chunksTotal: 3 }),
      { state: 'failed', text: 'Backfill failed: 3 of 3 chunks failed' },
    ],
    [
      'failed with neither error nor chunks',
      backfillJob({ status: BackfillStatus.FAILED, chunksCompleted: 0, chunksTotal: 0 }),
      { state: 'failed', text: 'Backfill failed' },
    ],
    [
      '@AC-9 partial with failed chunks',
      backfillJob({ status: BackfillStatus.PARTIAL, chunksCompleted: 2, chunksTotal: 3 }),
      { state: 'partial', text: 'Backfill partial: 1 of 3 chunks failed' },
    ],
    [
      '@AC-9 partial with every chunk completed',
      backfillJob({ status: BackfillStatus.PARTIAL, chunksCompleted: 3, chunksTotal: 3 }),
      { state: 'partial', text: 'Backfill partial: LYFT returned no data for part of the range' },
    ],
    [
      '@AC-9 canceled',
      backfillJob({ status: BackfillStatus.CANCELED, chunksCompleted: 1, chunksTotal: 3 }),
      { state: 'canceled', text: 'Backfill canceled' },
    ],
  ])('%s', (_name, job, expected) => {
    expect(backfillJobMessage(job, 'LYFT')).toEqual(expected);
  });
});

describe('triggerErrorMessage', () => {
  const ctx = { symbol: 'LYFT', spanDays: 1825 };

  it('@AC-11 maps ALREADY_EXISTS to the retry copy', () => {
    const err = new ConnectError(
      'a backfill for LYFT is already queued or running',
      Code.AlreadyExists,
    );
    expect(triggerErrorMessage(err, ctx)).toBe(
      'A backfill for LYFT is already queued or running. Try again when it finishes.',
    );
  });

  it('@AC-12 maps range_too_long to the span and the limit', () => {
    expect(triggerErrorMessage(denied(overCapDetail(730)), ctx)).toBe(
      'This backtest needs 1825 days of history, more than the self-serve limit of 730 days. Ask an admin to backfill LYFT.',
    );
  });

  it.each(contract.tokens.filter((t) => t !== 'range_too_long'))(
    'maps the %s token to the generic copy without the token',
    (token) => {
      const text = triggerErrorMessage(denied(contract.prefix + token), ctx);
      expect(text).toBe(GENERIC);
      expect(text).not.toContain(token);
    },
  );

  it('maps range_too_long without a parsable cap to the generic copy', () => {
    expect(triggerErrorMessage(denied(contract.prefix + 'range_too_long'), ctx)).toBe(GENERIC);
  });

  it('maps an unknown token and a prefix-less PERMISSION_DENIED to the generic copy', () => {
    expect(triggerErrorMessage(denied(contract.prefix + 'brand_new_token'), ctx)).toBe(GENERIC);
    expect(triggerErrorMessage(denied('admin scope required'), ctx)).toBe(GENERIC);
  });

  it('maps any other error to the existing failure phrase', () => {
    expect(triggerErrorMessage(new Error('network down'), ctx)).toBe(
      'Could not start backfill: network down',
    );
  });
});

describe('noVendorDataMessage, gapKey and backfillSpanDays', () => {
  const gap = { ...gapFor('LYFT'), gap: { start: ts('2023-03-17'), end: ts('2024-01-01') } };

  it('@AC-13 names the unfillable range in UTC dates', () => {
    expect(noVendorDataMessage(gap)).toBe('No vendor data for 2023-03-17 to 2024-01-01');
  });

  it('gapKey is stable for the same gap and changes with the symbol or either bound', () => {
    expect(gapKey(gap)).toBe(gapKey({ ...gap }));
    expect(gapKey(gap)).not.toBe(gapKey({ ...gap, symbol: 'AAPL' }));
    expect(gapKey(gap)).not.toBe(gapKey({ ...gap, gap: { ...gap.gap, start: ts('2023-03-18') } }));
    expect(gapKey(gap)).not.toBe(gapKey({ ...gap, gap: { ...gap.gap, end: ts('2024-01-02') } }));
  });

  it('backfillSpanDays rounds whole days up and is 0 for an unset bound', () => {
    expect(backfillSpanDays({ start: ts('2024-01-01'), end: ts('2024-01-03') })).toBe(2);
    expect(
      backfillSpanDays({
        start: ts('2024-01-01'),
        end: { seconds: ts('2024-01-03').seconds + BigInt(1) },
      }),
    ).toBe(3);
    expect(backfillSpanDays({ start: ts('2024-01-01') })).toBe(0);
    expect(backfillSpanDays({ end: ts('2024-01-01') })).toBe(0);
    expect(backfillSpanDays(undefined)).toBe(0);
  });
});
