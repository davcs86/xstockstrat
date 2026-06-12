'use client';
import { useState } from 'react';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  useBackfillJobs,
  useCancelBackfill,
  useDeleteBackfilledData,
  useTriggerBackfill,
} from '@/hooks/useBackfills';
import { useIsAdmin } from '@/hooks/useLiveStrategies';
import { BackfillStatus } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import type { BackfillJob } from '@xstockstrat/proto/ingest/v1/ingest_pb';
import { Timeframe } from '@xstockstrat/proto/common/v1/common_pb';

const TIMEFRAMES: { label: string; value: Timeframe }[] = [
  { label: '1 day', value: Timeframe.TIMEFRAME_1DAY },
  { label: '1 hour', value: Timeframe.TIMEFRAME_1HOUR },
  { label: '5 min', value: Timeframe.TIMEFRAME_5MIN },
  { label: '1 min', value: Timeframe.TIMEFRAME_1MIN },
];

const STATUS_FILTERS: { label: string; value: BackfillStatus }[] = [
  { label: 'All statuses', value: BackfillStatus.UNSPECIFIED },
  { label: 'Queued', value: BackfillStatus.QUEUED },
  { label: 'Running', value: BackfillStatus.RUNNING },
  { label: 'Completed', value: BackfillStatus.COMPLETED },
  { label: 'Partial', value: BackfillStatus.PARTIAL },
  { label: 'Failed', value: BackfillStatus.FAILED },
  { label: 'Canceled', value: BackfillStatus.CANCELED },
];

function statusBadge(status: BackfillStatus): {
  variant: 'buy' | 'info' | 'warning' | 'destructive' | 'secondary';
  label: string;
} {
  switch (status) {
    case BackfillStatus.COMPLETED:
      return { variant: 'buy', label: 'completed' };
    case BackfillStatus.RUNNING:
      return { variant: 'info', label: 'running' };
    case BackfillStatus.QUEUED:
      return { variant: 'secondary', label: 'queued' };
    case BackfillStatus.PARTIAL:
      return { variant: 'warning', label: 'partial' };
    case BackfillStatus.FAILED:
      return { variant: 'destructive', label: 'failed' };
    case BackfillStatus.CANCELED:
      return { variant: 'secondary', label: 'canceled' };
    default:
      return { variant: 'secondary', label: 'unknown' };
  }
}

function isCancelable(status: BackfillStatus): boolean {
  return status === BackfillStatus.QUEUED || status === BackfillStatus.RUNNING;
}

// Builds a common.v1.TimeRange from two date-input strings, omitting empty bounds.
function buildRange(start: string, end: string) {
  if (!start && !end) return undefined;
  return {
    ...(start ? { start: timestampFromDate(new Date(start)) } : {}),
    ...(end ? { end: timestampFromDate(new Date(end)) } : {}),
  };
}

export default function BackfillsPage() {
  const { data: isAdmin } = useIsAdmin();

  // Create-form state (FR-1).
  const [symbols, setSymbols] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>(Timeframe.TIMEFRAME_1DAY);
  const [createStart, setCreateStart] = useState('');
  const [createEnd, setCreateEnd] = useState('');
  const [overwrite, setOverwrite] = useState(false);

  // Filter state (FR-3).
  const [statusFilter, setStatusFilter] = useState<BackfillStatus>(BackfillStatus.UNSPECIFIED);
  const [symbolFilter, setSymbolFilter] = useState('');

  // Delete-panel state (FR-5).
  const [delSymbol, setDelSymbol] = useState('');
  const [delStart, setDelStart] = useState('');
  const [delEnd, setDelEnd] = useState('');
  const [delTimeframe, setDelTimeframe] = useState<Timeframe>(Timeframe.TIMEFRAME_UNSPECIFIED);
  const [delConfirm, setDelConfirm] = useState('');
  const [delWholeConfirm, setDelWholeConfirm] = useState('');

  const trigger = useTriggerBackfill();
  const cancel = useCancelBackfill();
  const del = useDeleteBackfilledData();

  const { data, isLoading, error } = useBackfillJobs({
    statusFilter,
    symbol: symbolFilter.trim(),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const list = symbols
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (list.length === 0) return;
    trigger.mutate(
      {
        symbols: list,
        timeframeEnum: timeframe,
        range: buildRange(createStart, createEnd),
        overwrite,
      },
      {
        onSuccess: () => {
          setSymbols('');
          setCreateStart('');
          setCreateEnd('');
        },
      },
    );
  }

  function handleCancel(job: BackfillJob) {
    if (!window.confirm(`Cancel backfill ${job.jobId}? Completed-chunk bars are kept.`)) return;
    cancel.mutate({ jobId: job.jobId });
  }

  const delRange = buildRange(delStart, delEnd);
  const isWholeSymbolDelete = !delRange;
  // FR-5: operator must type the exact symbol; a whole-symbol delete needs a second typed confirm.
  const deleteEnabled =
    delSymbol.trim().length > 0 &&
    delConfirm.trim().toUpperCase() === delSymbol.trim().toUpperCase() &&
    (!isWholeSymbolDelete || delWholeConfirm.trim().toUpperCase() === 'DELETE ALL');

  function handleDelete(e: React.FormEvent) {
    e.preventDefault();
    if (!deleteEnabled) return;
    del.mutate(
      {
        symbol: delSymbol.trim().toUpperCase(),
        range: delRange,
        timeframe: delTimeframe,
      },
      {
        onSuccess: () => {
          setDelConfirm('');
          setDelWholeConfirm('');
        },
      },
    );
  }

  return (
    <AppShell>
      <div className="p-4 sm:p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Backfills</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create, monitor, cancel, and delete historical OHLCV backfills.
          </p>
        </div>

        {/* Create backfill (FR-1) — admin only */}
        {isAdmin && (
          <Card>
            <CardContent className="pt-5">
              <h2 className="text-sm font-semibold mb-3">New backfill</h2>
              <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-5 gap-3">
                <Input
                  placeholder="Symbols (AAPL, TSLA)"
                  value={symbols}
                  onChange={(e) => setSymbols(e.target.value)}
                  className="sm:col-span-2"
                />
                <select
                  className="h-10 rounded-md border border-input bg-secondary px-3 text-sm"
                  value={timeframe}
                  onChange={(e) => setTimeframe(Number(e.target.value))}
                >
                  {TIMEFRAMES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={createStart}
                  onChange={(e) => setCreateStart(e.target.value)}
                />
                <Input
                  type="date"
                  value={createEnd}
                  onChange={(e) => setCreateEnd(e.target.value)}
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2">
                  <input
                    type="checkbox"
                    checked={overwrite}
                    onChange={(e) => setOverwrite(e.target.checked)}
                  />
                  Overwrite existing bars
                </label>
                <Button type="submit" disabled={trigger.isPending} className="sm:col-span-1">
                  {trigger.isPending ? 'Starting…' : 'Start backfill'}
                </Button>
              </form>
              {trigger.error && (
                <p className="text-xs text-destructive mt-2">{trigger.error.message}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Filters (FR-3) */}
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="h-10 rounded-md border border-input bg-secondary px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(Number(e.target.value))}
          >
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <Input
            placeholder="Filter by symbol"
            value={symbolFilter}
            onChange={(e) => setSymbolFilter(e.target.value)}
            className="max-w-[200px]"
          />
        </div>

        {/* Job list + monitor (FR-2/FR-6) */}
        {isLoading && <p className="text-sm text-muted-foreground">Loading jobs…</p>}
        {error && <p className="text-sm text-destructive">Failed to load backfill jobs</p>}
        {data && (
          <div className="space-y-2">
            {(data.jobs ?? []).map((job: BackfillJob) => {
              const badge = statusBadge(job.status);
              return (
                <Card key={job.jobId}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          <span className="text-sm font-mono truncate">
                            {job.symbols.join(', ')}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1.5 tabular-nums">
                          bars {job.barsProcessed.toString()} / {job.barsTotal.toString()} · chunks{' '}
                          {job.chunksCompleted} / {job.chunksTotal}
                          {job.failedSymbols.length > 0 && (
                            <span className="text-destructive">
                              {' '}
                              · failed: {job.failedSymbols.join(', ')}
                            </span>
                          )}
                        </div>
                        {job.error && <p className="text-xs text-destructive mt-1">{job.error}</p>}
                        <p className="text-[11px] text-muted-foreground/70 font-mono mt-1">
                          {job.jobId}
                        </p>
                      </div>
                      {isAdmin && isCancelable(job.status) && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={cancel.isPending}
                          onClick={() => handleCancel(job)}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {(data.jobs ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No backfill jobs match the filter.</p>
            )}
          </div>
        )}

        {/* Delete backfilled data (FR-5) — admin only, destructive */}
        {isAdmin && (
          <Card className="border-destructive/40">
            <CardContent className="pt-5">
              <h2 className="text-sm font-semibold mb-1 text-destructive">
                Delete backfilled data
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                Permanently removes stored bars for a symbol. Scope it with a date range and/or
                timeframe — an empty range deletes <strong>all</strong> bars for the symbol.
              </p>
              <form onSubmit={handleDelete} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Input
                  placeholder="Symbol"
                  value={delSymbol}
                  onChange={(e) => setDelSymbol(e.target.value)}
                />
                <select
                  className="h-10 rounded-md border border-input bg-secondary px-3 text-sm"
                  value={delTimeframe}
                  onChange={(e) => setDelTimeframe(Number(e.target.value))}
                >
                  <option value={Timeframe.TIMEFRAME_UNSPECIFIED}>All timeframes</option>
                  {TIMEFRAMES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <Input type="date" value={delStart} onChange={(e) => setDelStart(e.target.value)} />
                <Input type="date" value={delEnd} onChange={(e) => setDelEnd(e.target.value)} />
                <Input
                  placeholder={`Type "${delSymbol.trim().toUpperCase() || 'SYMBOL'}" to confirm`}
                  value={delConfirm}
                  onChange={(e) => setDelConfirm(e.target.value)}
                  className="sm:col-span-2"
                />
                {isWholeSymbolDelete && (
                  <Input
                    placeholder='Whole-symbol delete — type "DELETE ALL"'
                    value={delWholeConfirm}
                    onChange={(e) => setDelWholeConfirm(e.target.value)}
                    className="sm:col-span-2"
                  />
                )}
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={!deleteEnabled || del.isPending}
                  className="sm:col-span-1"
                >
                  {del.isPending ? 'Deleting…' : 'Delete data'}
                </Button>
              </form>
              {del.error && <p className="text-xs text-destructive mt-2">{del.error.message}</p>}
              {del.data && (
                <p className="text-xs text-buy mt-2">
                  Deleted {del.data.rowsDeleted.toString()} rows.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
