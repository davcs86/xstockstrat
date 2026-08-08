'use client';
import { useState } from 'react';
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
import { useScreenSymbols } from '@/hooks/useScreenSymbols';
import { useWatchlists, useCreateWatchlist, useAddWatchlistSymbols } from '@/hooks/useWatchlists';
import { normalizeWeights } from '@/lib/screenWeights';
import { formatLastRun } from '@/lib/formatLastRun';
import { scoreColor } from '@/lib/scoreDisplay';
import { BUILTIN_INDICATORS } from '@/lib/strategyCatalog';
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

function newCriterion(i: number): CriterionRow {
  return {
    refName: `c${i}`,
    kind: ScreenKind.FUNDAMENTAL,
    metricName: 'pe_ratio',
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
    screen.mutate(
      {
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
      },
      { onSuccess: () => setLastRun({ at: new Date(), count: symbols.length }) },
    );
  }

  const results = screen.data?.results ?? [];
  // INSUFFICIENT_DATA has two distinct causes the backend already tells apart (see
  // services/xstockstrat-analysis/app/services/screener.py): too few bars for a technical
  // criterion (carries a `gap` — actionable via the Backfills page) vs. the fundamentals data
  // source being unavailable for a requested fundamental criterion (no `gap` — that message is
  // bars-specific; there's no fundamentals backfill to trigger). Screener scans aren't persisted,
  // so there's nothing to notify against — the pending count below just tells the user this scan
  // will likely score more candidates on a later re-run rather than looking silently frozen.
  const pendingFundamentals = results.filter(
    (r) => r.status === ScreenResultStatus.INSUFFICIENT_DATA && !r.gap,
  );
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
                            : 'pe_ratio';
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
                      <Input
                        aria-label="metric"
                        className="w-40 font-mono"
                        value={c.metricName}
                        onChange={(e) => updateCriterion(i, { metricName: e.target.value })}
                      />
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
                    <div className="inline-flex overflow-hidden rounded-md border border-border">
                      <button
                        type="button"
                        aria-label="hard filter"
                        aria-pressed={c.hardFilter}
                        className={cn(
                          'px-2.5 py-1.5 text-xs',
                          c.hardFilter
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background text-muted-foreground',
                        )}
                        onClick={() => updateCriterion(i, { hardFilter: true })}
                      >
                        hard
                      </button>
                      <button
                        type="button"
                        aria-label="rank only"
                        aria-pressed={!c.hardFilter}
                        className={cn(
                          'px-2.5 py-1.5 text-xs',
                          !c.hardFilter
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-background text-muted-foreground',
                        )}
                        onClick={() => updateCriterion(i, { hardFilter: false })}
                      >
                        rank
                      </button>
                    </div>
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
                    <label className="flex items-center gap-2">
                      <span>weight</span>
                      <input
                        type="range"
                        aria-label="weight slider"
                        min={0}
                        max={1}
                        step={0.05}
                        value={c.weight}
                        onChange={(e) => updateCriterion(i, { weight: Number(e.target.value) })}
                        className="w-28 accent-primary"
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
                    </label>
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
