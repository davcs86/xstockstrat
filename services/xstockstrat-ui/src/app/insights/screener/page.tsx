'use client';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Play } from 'lucide-react';
import { ConnectError } from '@connectrpc/connect';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/components/ui/utils';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Slider } from '@/components/ui/slider';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/ui/data-table';
import {
  useScreenSymbols,
  useScreenSymbolsPoll,
  MAX_POLL_ATTEMPTS,
  type ScreenSymbolsInput,
  type ScreenSymbolsResult,
} from '@/hooks/useScreenSymbols';
import { useWatchlists, useCreateWatchlist, useAddWatchlistSymbols } from '@/hooks/useWatchlists';
import { normalizeWeights } from '@/lib/screenWeights';
import { formatLastRun } from '@/lib/formatLastRun';
import { scoreColor } from '@/lib/scoreDisplay';
import {
  BUILTIN_INDICATORS,
  FUNDAMENTAL_METRICS,
  DEFAULT_FUNDAMENTAL_METRIC,
} from '@/lib/strategyCatalog';
import {
  type CriterionRow,
  COMPARATOR_LABELS,
  KIND_OPTIONS,
  comparatorGlyph,
  useCriteriaList,
  buildScreenCriterion,
} from '@/lib/screenCriteria';
import {
  Comparator,
  ScreenKind,
  ScreenResultStatus,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';

// UI display constant (not a WatchConfig key — Floor F-07 unaffected).
const TOP_N = 5;

// Merges a poll response into the displayed results by symbol, preserving row order. Safe because
// every poll response is a full, normalized result set for the identical symbol+criteria universe.
function mergeResultsBySymbol(
  current: ScreenSymbolsResult['results'],
  incoming: ScreenSymbolsResult['results'],
): ScreenSymbolsResult['results'] {
  const bySymbol = new Map(incoming.map((r) => [r.symbol, r]));
  return current.map((r) => bySymbol.get(r.symbol) ?? r);
}

export default function ScreenerPage() {
  const screen = useScreenSymbols();
  const watchlists = useWatchlists();
  const createWl = useCreateWatchlist();
  const addSymbols = useAddWatchlistSymbols();

  const [symbolsText, setSymbolsText] = useState('AAPL MSFT GOOG');
  const {
    criteria,
    add: addCriterion,
    remove: removeCriterion,
    update: updateCriterion,
  } = useCriteriaList();
  // Last-run metadata — rendered once from Date.now() at render (no live tick).
  const [lastRun, setLastRun] = useState<{ at: Date; count: number } | null>(null);
  const [saveName, setSaveName] = useState('');
  const [targetListId, setTargetListId] = useState('');
  const [results, setResults] = useState<ScreenSymbolsResult['results']>([]);
  const [scanGeneration, setScanGeneration] = useState(0);
  const [lastScanReq, setLastScanReq] = useState<ScreenSymbolsInput | null>(null);
  const [pollingEnabled, setPollingEnabled] = useState(true);
  const [pollAttempts, setPollAttempts] = useState(0);

  const errorMessage =
    screen.error instanceof ConnectError
      ? screen.error.rawMessage
      : (screen.error?.message ?? null);

  const shares = normalizeWeights(criteria.map((c) => c.weight));

  function runScan() {
    const symbols = symbolsText.split(/[\s,]+/).filter(Boolean);
    if (symbols.length === 0) return;
    const req: ScreenSymbolsInput = {
      symbols,
      criteria: criteria.map(buildScreenCriterion),
    };
    // Scan-generation guard: bump before mutate so a still-in-flight poll from a superseded scan is
    // orphaned; reset per-scan polling state so a previous scan's status never leaks into the new one.
    setScanGeneration((g) => g + 1);
    setLastScanReq(null);
    setPollAttempts(0);
    setPollingEnabled(true);
    screen.mutate(req, {
      onSuccess: (data) => {
        setLastRun({ at: new Date(), count: symbols.length });
        setResults(data.results);
        setLastScanReq(req);
      },
    });
  }

  // INSUFFICIENT_DATA has two backend causes: too few bars for a technical criterion (carries a
  // `gap`) vs. the fundamentals source being unavailable (no `gap`). Both drive the auto-recheck.
  const pendingRows = results.filter((r) => r.status === ScreenResultStatus.INSUFFICIENT_DATA);
  const pendingFundamentals = pendingRows.filter((r) => !r.gap);

  const poll = useScreenSymbolsPoll(
    lastScanReq,
    scanGeneration,
    pollingEnabled && lastScanReq !== null && pendingRows.length > 0,
  );

  useEffect(() => {
    // Key on dataUpdatedAt/errorUpdatedAt, NOT poll.data identity: TanStack's structural sharing
    // reuses the same data reference for byte-identical retries, so keying on poll.data fires once only.
    if (poll.dataUpdatedAt === 0 && poll.errorUpdatedAt === 0) return;
    if (poll.data !== undefined) {
      setResults((prev) => mergeResultsBySymbol(prev, poll.data!.results));
    }
    setPollAttempts((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.dataUpdatedAt, poll.errorUpdatedAt]);

  const hasHardFilter = criteria.some((c) => c.hardFilter);
  // "Save as watchlist" seeds the passing subset when a hard filter is active, else all results.
  const saveSymbols = (hasHardFilter ? results.filter((r) => r.passed) : results).map(
    (r) => r.symbol,
  );
  const topNSymbols = results.slice(0, TOP_N).map((r) => r.symbol);

  function handleSaveAsWatchlist() {
    const name = saveName.trim();
    if (!name || saveSymbols.length === 0) return;
    createWl.mutate({ name, symbols: saveSymbols }, { onSuccess: () => setSaveName('') });
  }

  function handleAddTopN() {
    if (!targetListId || topNSymbols.length === 0) return;
    addSymbols.mutate({ watchlistId: targetListId, symbols: topNSymbols });
  }

  type ScreenResultRow = ScreenSymbolsResult['results'][number];

  const columns = useMemo<ColumnDef<ScreenResultRow>[]>(
    () => [
      {
        id: 'rank',
        header: 'Rank',
        enableSorting: false,
        meta: { className: 'p-3 whitespace-nowrap' },
        cell: ({ row }) => row.index + 1,
      },
      {
        accessorKey: 'symbol',
        header: 'Symbol',
        meta: { className: 'p-3 font-mono font-medium' },
      },
      {
        accessorKey: 'score',
        header: 'Score',
        meta: { className: 'p-3 font-mono tabular-nums font-semibold' },
        cell: ({ row }) => {
          const r = row.original;
          // A scoreUnavailable result's `score` is an internal placeholder, not a real computed
          // value — render it as no-data rather than a plausible-looking number.
          if (r.scoreUnavailable) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <span className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn('inline-block h-2 w-2 rounded-full bg-current', scoreColor(r.score))}
              />
              <span className={scoreColor(r.score)}>{r.score.toFixed(3)}</span>
            </span>
          );
        },
      },
      {
        accessorKey: 'pe',
        header: 'P/E',
        meta: { className: 'p-3 font-mono tabular-nums' },
        cell: ({ row }) => (row.original.pe ? row.original.pe.toFixed(1) : '—'),
      },
      {
        accessorKey: 'rsi',
        header: 'RSI',
        meta: { className: 'p-3 font-mono tabular-nums' },
        cell: ({ row }) => (row.original.rsi ? row.original.rsi.toFixed(0) : '—'),
      },
      {
        accessorKey: 'atr',
        header: () => <span title="ATR is a close-only approximation (not exact)">ATR</span>,
        meta: { className: 'p-3 font-mono tabular-nums' },
        cell: ({ row }) => (row.original.atr ? row.original.atr.toFixed(2) : '—'),
      },
      {
        accessorKey: 'revGrowth',
        header: 'Rev growth',
        meta: { className: 'p-3 font-mono tabular-nums whitespace-nowrap' },
        cell: ({ row }) =>
          row.original.revGrowth ? `${(row.original.revGrowth * 100).toFixed(1)}%` : '—',
      },
      {
        accessorKey: 'held',
        header: 'Held',
        meta: { className: 'p-3' },
        cell: ({ row }) => (row.original.held ? <Badge variant="paper">Held</Badge> : '—'),
      },
      {
        accessorKey: 'passed',
        header: 'Passed',
        meta: { className: 'p-3' },
        cell: ({ row }) => (row.original.passed ? '✓' : '—'),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        meta: { className: 'p-3' },
        cell: ({ row }) => {
          const r = row.original;
          if (r.status === ScreenResultStatus.INSUFFICIENT_DATA) {
            return r.gap ? (
              <Badge variant="warning" data-testid="insufficient-data">
                Insufficient data
              </Badge>
            ) : (
              <Badge
                variant="warning"
                data-testid="fundamentals-pending"
                title="The fundamentals data source is currently unavailable — this candidate will be re-scored on a later scan once it's back."
              >
                Fundamentals pending
              </Badge>
            );
          }
          // scoreUnavailable = evaluated but no criterion had usable data — distinct from the
          // retry-eligible INSUFFICIENT_DATA (this may be permanent, e.g. an ETF with no P/E).
          if (r.scoreUnavailable) {
            return (
              <Badge
                variant="warning"
                data-testid="no-criteria-data"
                title="None of this scan's criteria had usable data for this candidate — its score is not a real result."
              >
                No criteria data
              </Badge>
            );
          }
          return <Badge variant="info">OK</Badge>;
        },
      },
    ],
    [],
  );

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">Screener</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Find candidates worth watching — rank a symbol universe against weighted criteria.
          </p>
        </div>

        <Card className="mb-4">
          <CardContent className="p-4 space-y-3">
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="symbols">
                Symbols (space or comma separated)
              </label>
              <Input
                id="symbols"
                data-testid="screen-symbols"
                value={symbolsText}
                onChange={(e) => setSymbolsText(e.target.value)}
                placeholder="AAPL MSFT GOOG"
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Criteria
              </span>
              <span className="text-xs text-muted-foreground">weights normalize to 1.0</span>
            </div>

            <div className="space-y-2">
              {criteria.map((c, i) => (
                <div
                  key={i}
                  className="rounded-md border border-border p-3 space-y-2"
                  data-testid="criterion-row"
                >
                  {/* kind decides whether metric resolves against fundamentals or is computed from bars. */}
                  <div className="flex flex-wrap items-end gap-2">
                    <select
                      aria-label="kind"
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={c.kind}
                      onChange={(e) => {
                        const kind = Number(e.target.value) as CriterionRow['kind'];
                        // Reset metric to a valid default for the new kind so a leftover fundamentals
                        // name isn't sent as a bogus indicator name.
                        const metricName =
                          kind === ScreenKind.TECHNICAL_INDICATOR
                            ? BUILTIN_INDICATORS[0].name
                            : DEFAULT_FUNDAMENTAL_METRIC;
                        updateCriterion(i, { kind, metricName });
                      }}
                    >
                      {KIND_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    {c.kind === ScreenKind.TECHNICAL_INDICATOR ? (
                      <select
                        aria-label="metric"
                        className="h-9 rounded-md border bg-background px-2 text-sm font-mono"
                        value={c.metricName}
                        onChange={(e) => updateCriterion(i, { metricName: e.target.value })}
                      >
                        {BUILTIN_INDICATORS.map((ind) => (
                          <option key={ind.name} value={ind.name}>
                            {ind.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Select
                        value={c.metricName}
                        onValueChange={(v) => updateCriterion(i, { metricName: v })}
                      >
                        <SelectTrigger aria-label="metric" className="h-9 w-40 font-mono">
                          <SelectValue placeholder="Select a metric…" />
                        </SelectTrigger>
                        <SelectContent>
                          {FUNDAMENTAL_METRICS.map((m) => (
                            <SelectItem key={m.name} value={m.name}>
                              {m.name} — {m.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <select
                      aria-label="comparator"
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={c.op}
                      onChange={(e) =>
                        updateCriterion(i, { op: Number(e.target.value) as Comparator })
                      }
                    >
                      {COMPARATOR_LABELS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label="threshold"
                      type="number"
                      className="w-28"
                      value={c.threshold}
                      onChange={(e) => updateCriterion(i, { threshold: Number(e.target.value) })}
                    />
                    <ToggleGroup
                      type="single"
                      variant="outline"
                      value={c.hardFilter ? 'hard' : 'rank'}
                      onValueChange={(v) => v && updateCriterion(i, { hardFilter: v === 'hard' })}
                    >
                      <ToggleGroupItem value="hard" aria-label="hard filter">
                        hard
                      </ToggleGroupItem>
                      <ToggleGroupItem value="rank" aria-label="rank only">
                        rank
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <Button
                      variant="destructive"
                      size="sm"
                      aria-label="remove criterion"
                      onClick={() => removeCriterion(i)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="font-mono text-foreground">
                      {c.metricName} {comparatorGlyph(c.op)} {c.threshold}
                    </span>
                    <div className="flex items-center gap-2">
                      <span>weight</span>
                      <Slider
                        aria-label="weight slider"
                        min={0}
                        max={1}
                        step={0.05}
                        value={[c.weight]}
                        onValueChange={([v]) => updateCriterion(i, { weight: v })}
                        className="w-28"
                      />
                      <Input
                        aria-label="weight"
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        className="w-20"
                        value={c.weight}
                        onChange={(e) => updateCriterion(i, { weight: Number(e.target.value) })}
                      />
                    </div>
                    <span data-testid="weight-share" className="tabular-nums">
                      {(shares[i] * 100).toFixed(0)}% of weight
                    </span>
                  </div>
                </div>
              ))}
              <Button variant="default" size="sm" onClick={addCriterion}>
                <Plus className="h-4 w-4 mr-1" /> Add criterion
              </Button>
            </div>

            <Button data-testid="run-screen" onClick={runScan} disabled={screen.isPending}>
              <Play className="h-4 w-4 mr-1.5" />
              Run scan
            </Button>
          </CardContent>
        </Card>

        {screen.isPending && (
          <p data-testid="screen-loading" className="text-sm text-muted-foreground">
            Scanning…
          </p>
        )}
        {errorMessage && (
          <p data-testid="screen-error" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        {!screen.isPending && results.length > 0 && (
          <>
            <div
              className="mb-3 flex flex-wrap items-center justify-between gap-2"
              data-testid="candidates-summary"
            >
              <div className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Candidates</span> ·{' '}
                {results.filter((r) => r.passed).length} of {results.length} passed the hard filters
                {lastRun && (
                  <span data-testid="last-run" className="ml-2">
                    · {formatLastRun(lastRun.at, Date.now())} · {lastRun.count} symbols
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="new watchlist name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="New list name"
                  className="h-8 w-40"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="save-as-watchlist"
                  onClick={handleSaveAsWatchlist}
                  disabled={createWl.isPending || !saveName.trim() || saveSymbols.length === 0}
                >
                  Save {saveSymbols.length} as watchlist
                </Button>
                <Select value={targetListId} onValueChange={setTargetListId}>
                  <SelectTrigger className="h-8 w-40" aria-label="Target watchlist">
                    <SelectValue placeholder="Add top 5 to…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(watchlists.data?.watchlists ?? []).map((wl) => (
                      <SelectItem key={wl.watchlistId} value={wl.watchlistId}>
                        {wl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="add-top-n"
                  onClick={handleAddTopN}
                  disabled={addSymbols.isPending || !targetListId || topNSymbols.length === 0}
                >
                  Add top {topNSymbols.length}
                </Button>
              </div>
            </div>
            {createWl.error && (
              <p className="mb-2 text-sm text-destructive">{(createWl.error as Error).message}</p>
            )}
            {pendingFundamentals.length > 0 && (
              <p data-testid="fundamentals-pending-banner" className="mb-2 text-sm text-yellow-500">
                Fundamentals data isn&apos;t available right now for{' '}
                {pendingFundamentals.length === results.length
                  ? 'any symbol'
                  : `${pendingFundamentals.length} of ${results.length} symbols`}{' '}
                — re-run this scan later once it is.
              </p>
            )}
            {pendingRows.length > 0 && pollingEnabled && pollAttempts < MAX_POLL_ATTEMPTS && (
              <div
                data-testid="screener-checking"
                className="mb-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
              >
                <span>
                  Checking for updated data… (attempt{' '}
                  {Math.min(pollAttempts + 1, MAX_POLL_ATTEMPTS)} of {MAX_POLL_ATTEMPTS})
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  data-testid="stop-polling"
                  onClick={() => setPollingEnabled(false)}
                >
                  Stop checking
                </Button>
              </div>
            )}
            {pendingRows.length > 0 && pollingEnabled && pollAttempts >= MAX_POLL_ATTEMPTS && (
              <p
                data-testid="screener-polling-gave-up"
                className="mb-2 text-sm text-muted-foreground"
              >
                Gave up checking — {pendingRows.length} of {results.length} symbols are still not
                available. Run the scan again later to retry.
              </p>
            )}
          </>
        )}

        {!screen.isPending && results.length > 0 && (
          <Card>
            <CardContent className="p-0">
              {/* Wide table scrolls horizontally in its own container so the phone frame never overflows. */}
              <DataTable
                columns={columns}
                data={results}
                getRowId={(r) => r.symbol}
                tableClassName="min-w-[640px]"
                tableTestId="screen-results"
                getRowProps={() => ({ 'data-testid': 'result-row', className: 'border-b' })}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
