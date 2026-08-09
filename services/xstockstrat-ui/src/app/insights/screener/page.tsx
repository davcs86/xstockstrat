'use client';
import { useEffect, useState } from 'react';
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
  Comparator,
  ComponentKind,
  ScreenKind,
  ScreenResultStatus,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';

type CriterionRow = {
  refName: string;
  // FUNDAMENTAL (a marketdata fundamentals field/extra_metric, e.g. "pe_ratio") or
  // TECHNICAL_INDICATOR (a built-in indicator computed from bars, e.g. "RSI"). Bug fix: previously
  // every criterion was sent as FUNDAMENTAL regardless of what the user picked, so an indicator name
  // like "rsi" never matched a fundamental field, was silently skipped server-side, and — because a
  // skipped criterion never fails a hard filter — a comparison like "rsi < 30" always read as passed.
  kind: ScreenKind.FUNDAMENTAL | ScreenKind.TECHNICAL_INDICATOR;
  metricName: string;
  op: Comparator;
  threshold: number;
  weight: number;
  hardFilter: boolean;
};

const COMPARATOR_LABELS: Array<{ value: Comparator; label: string }> = [
  { value: Comparator.LT, label: '<' },
  { value: Comparator.LTE, label: '≤' },
  { value: Comparator.GT, label: '>' },
  { value: Comparator.GTE, label: '≥' },
];

const KIND_OPTIONS: Array<{ value: CriterionRow['kind']; label: string }> = [
  { value: ScreenKind.FUNDAMENTAL, label: 'Fundamental' },
  { value: ScreenKind.TECHNICAL_INDICATOR, label: 'Technical indicator' },
];

// Top-N default for the "Add top N to watchlist" action (feature 098, FR-6). A UI display constant,
// not a WatchConfig key (Floor F-07 unaffected).
const TOP_N = 5;

function comparatorGlyph(op: Comparator): string {
  return COMPARATOR_LABELS.find((c) => c.value === op)?.label ?? '?';
}

// Feature 118: merges a poll response into the displayed results by symbol, preserving row order
// (avoids the table visibly reordering every 60s) — safe because every poll response is a full,
// correctly-normalized result set for the identical symbol+criteria universe, not a partial one to
// reconcile (design.md § Chosen Approach — full-scan recheck, never narrowed).
function mergeResultsBySymbol(
  current: ScreenSymbolsResult['results'],
  incoming: ScreenSymbolsResult['results'],
): ScreenSymbolsResult['results'] {
  const bySymbol = new Map(incoming.map((r) => [r.symbol, r]));
  return current.map((r) => bySymbol.get(r.symbol) ?? r);
}

function newCriterion(i: number): CriterionRow {
  return {
    refName: `c${i}`,
    kind: ScreenKind.FUNDAMENTAL,
    metricName: DEFAULT_FUNDAMENTAL_METRIC,
    op: Comparator.LT,
    threshold: 20,
    weight: 1,
    hardFilter: false,
  };
}

export default function ScreenerPage() {
  const screen = useScreenSymbols();
  const watchlists = useWatchlists();
  const createWl = useCreateWatchlist();
  const addSymbols = useAddWatchlistSymbols();

  const [symbolsText, setSymbolsText] = useState('AAPL MSFT GOOG');
  const [criteria, setCriteria] = useState<CriterionRow[]>([newCriterion(1)]);
  // Last-run metadata (FR-4) — captured on scan success, rendered once from Date.now() at render
  // (no live tick; see src/lib/formatLastRun.ts).
  const [lastRun, setLastRun] = useState<{ at: Date; count: number } | null>(null);
  // Save-as-watchlist inline name panel (FR-5) + add-top-N target (FR-6).
  const [saveName, setSaveName] = useState('');
  const [targetListId, setTargetListId] = useState('');
  // Feature 118 — background data-readiness polling state.
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

  function addCriterion() {
    setCriteria((c) => [...c, newCriterion(c.length + 1)]);
  }
  function removeCriterion(i: number) {
    setCriteria((c) => c.filter((_, idx) => idx !== i));
  }
  function updateCriterion(i: number, patch: Partial<CriterionRow>) {
    setCriteria((c) => c.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function runScan() {
    const symbols = symbolsText.split(/[\s,]+/).filter(Boolean);
    if (symbols.length === 0) return;
    const req: ScreenSymbolsInput = {
      symbols,
      criteria: criteria.map((c) => {
        const base = {
          refName: c.refName,
          kind: c.kind,
          op: c.op,
          threshold: c.threshold,
          weight: c.weight,
          hardFilter: c.hardFilter,
        };
        if (c.kind === ScreenKind.TECHNICAL_INDICATOR) {
          // Route through `component` (not `metricName`) so the engine actually computes the
          // indicator from bars — a bare metric_name only resolves fundamentals fields.
          return {
            ...base,
            component: {
              refName: c.refName,
              kind: ComponentKind.BUILTIN_INDICATOR,
              indicator: c.metricName.toUpperCase(),
            },
          };
        }
        return { ...base, metricName: c.metricName };
      }),
    };
    // Feature 118 — scan-generation guard: bump before mutate so a still-in-flight poll from a
    // superseded scan is orphaned; reset per-scan polling state so a stopped/exhausted previous
    // scan's status never leaks into the new one (closes the "stale permanent opt-out" gap).
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

  // INSUFFICIENT_DATA has two distinct causes the backend already tells apart (see
  // services/xstockstrat-analysis/app/services/screener.py): too few bars for a technical
  // criterion (carries a `gap`) vs. the fundamentals data source being unavailable (no `gap`).
  // Both drive the background auto-recheck uniformly (feature 118, FR-3).
  const pendingRows = results.filter((r) => r.status === ScreenResultStatus.INSUFFICIENT_DATA);
  const pendingFundamentals = pendingRows.filter((r) => !r.gap);

  const poll = useScreenSymbolsPoll(
    lastScanReq,
    scanGeneration,
    pollingEnabled && lastScanReq !== null && pendingRows.length > 0,
  );

  useEffect(() => {
    // Keyed on `dataUpdatedAt`/`errorUpdatedAt` (always-fresh timestamps), NOT `poll.data`/
    // `poll.error` object identity. TanStack Query's structural sharing reuses the previous `data`
    // reference when a new response is deeply equal to the last one — and that's the *normal* case
    // here: a still-pending row comes back byte-identical on every retry until it resolves. Keying
    // on `poll.data` would make this effect fire once and never again for identical retries,
    // freezing `pollAttempts` and leaving the UI stuck on "Checking…" forever even after the query
    // internally gave up (caught by running the Step 3 suite against this implementation — see
    // context.md). Also covers the erroring-poll case (mirrors the hook's own attempt-counting,
    // dataUpdateCount + errorUpdateCount, Step 1 §5) the same way.
    if (poll.dataUpdatedAt === 0 && poll.errorUpdatedAt === 0) return;
    if (poll.data !== undefined) {
      setResults((prev) => mergeResultsBySymbol(prev, poll.data!.results));
    }
    setPollAttempts((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poll.dataUpdatedAt, poll.errorUpdatedAt]);

  const hasHardFilter = criteria.some((c) => c.hardFilter);
  // "Save as watchlist" seeds the passing subset when a hard filter is active, else all results (FR-5).
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
                  {/* Readable grammar line (FR-3): <kind> <metric> <comparator> <threshold>, all
                      editable. `kind` decides whether `metric` resolves against fundamentals
                      (metricName) or is computed from bars (component.indicator) — see the
                      CriterionRow.kind comment above for why this distinction matters. */}
                  <div className="flex flex-wrap items-end gap-2">
                    <select
                      aria-label="kind"
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={c.kind}
                      onChange={(e) => {
                        const kind = Number(e.target.value) as CriterionRow['kind'];
                        // Reset to a valid default for the new kind so a leftover fundamentals
                        // field name (e.g. "pe_ratio") isn't sent as a bogus indicator name.
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
                    {/* Hard/rank segmented toggle (FR-2) → hardFilter. */}
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

                  {/* Preview of the grammar + normalized weight share (FR-1/FR-3). */}
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

              {/* Screener → watchlist actions (FR-5 / FR-6). */}
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
              {/* Wide table → scroll horizontally within its own container so the phone frame
                  never overflows (the results table has 10 columns). */}
              <div className="w-full overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]" data-testid="screen-results">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="p-3 whitespace-nowrap">Rank</th>
                      <th className="p-3">Symbol</th>
                      <th className="p-3">Score</th>
                      {/* feature 083 (FR-8) raw columns. ATR is a close-only approximation. */}
                      <th className="p-3">P/E</th>
                      <th className="p-3">RSI</th>
                      <th className="p-3" title="ATR is a close-only approximation (not exact)">
                        ATR
                      </th>
                      <th className="p-3 whitespace-nowrap">Rev growth</th>
                      <th className="p-3">Held</th>
                      <th className="p-3">Passed</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={r.symbol} className="border-b" data-testid="result-row">
                        <td className="p-3">{i + 1}</td>
                        <td className="p-3 font-mono font-medium">{r.symbol}</td>
                        <td className="p-3 font-mono tabular-nums font-semibold">
                          {/* Colored strength dot via the canonical scoreColor helper (FR-7, DRY). */}
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              aria-hidden
                              className={cn(
                                'inline-block h-2 w-2 rounded-full bg-current',
                                scoreColor(r.score),
                              )}
                            />
                            <span className={scoreColor(r.score)}>{r.score.toFixed(3)}</span>
                          </span>
                        </td>
                        <td className="p-3 font-mono tabular-nums">
                          {r.pe ? r.pe.toFixed(1) : '—'}
                        </td>
                        <td className="p-3 font-mono tabular-nums">
                          {r.rsi ? r.rsi.toFixed(0) : '—'}
                        </td>
                        <td className="p-3 font-mono tabular-nums">
                          {r.atr ? r.atr.toFixed(2) : '—'}
                        </td>
                        <td className="p-3 font-mono tabular-nums">
                          {r.revGrowth ? `${(r.revGrowth * 100).toFixed(1)}%` : '—'}
                        </td>
                        <td className="p-3">
                          {r.held ? <Badge variant="paper">Held</Badge> : '—'}
                        </td>
                        <td className="p-3">{r.passed ? '✓' : '—'}</td>
                        <td className="p-3">
                          {r.status === ScreenResultStatus.INSUFFICIENT_DATA ? (
                            r.gap ? (
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
                            )
                          ) : (
                            <Badge variant="info">OK</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
