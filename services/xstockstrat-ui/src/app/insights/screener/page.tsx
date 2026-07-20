'use client';
import { useState } from 'react';
import { Plus, Trash2, Play } from 'lucide-react';
import { ConnectError } from '@connectrpc/connect';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useScreenSymbols } from '@/hooks/useScreenSymbols';
import {
  Comparator,
  ScreenKind,
  ScreenResultStatus,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';

type CriterionRow = {
  refName: string;
  metricName: string;
  op: Comparator;
  threshold: number;
  weight: number;
  hardFilter: boolean;
};

const COMPARATOR_LABELS: Array<{ value: Comparator; label: string }> = [
  { value: Comparator.LT, label: '<' },
  { value: Comparator.LTE, label: '<=' },
  { value: Comparator.GT, label: '>' },
  { value: Comparator.GTE, label: '>=' },
];

function newCriterion(i: number): CriterionRow {
  return {
    refName: `c${i}`,
    metricName: 'pe_ratio',
    op: Comparator.LT,
    threshold: 20,
    weight: 1,
    hardFilter: false,
  };
}

export default function ScreenerPage() {
  const screen = useScreenSymbols();
  const [symbolsText, setSymbolsText] = useState('AAPL MSFT GOOG');
  const [criteria, setCriteria] = useState<CriterionRow[]>([newCriterion(1)]);

  const errorMessage =
    screen.error instanceof ConnectError
      ? screen.error.rawMessage
      : screen.error?.message ?? null;

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
    screen.mutate({
      symbols,
      criteria: criteria.map((c) => ({
        refName: c.refName,
        kind: ScreenKind.FUNDAMENTAL,
        metricName: c.metricName,
        op: c.op,
        threshold: c.threshold,
        weight: c.weight,
        hardFilter: c.hardFilter,
      })),
    });
  }

  const results = screen.data?.results ?? [];

  return (
    <AppShell>
      <div className="p-4 sm:p-6">
        <div className="mb-6">
          <h1 className="text-xl font-bold tracking-tight">Screener</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Rank a symbol universe against weighted criteria.
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

            <div className="space-y-2">
              {criteria.map((c, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2" data-testid="criterion-row">
                  <Input
                    aria-label="metric"
                    className="w-40"
                    value={c.metricName}
                    onChange={(e) => updateCriterion(i, { metricName: e.target.value })}
                  />
                  <select
                    aria-label="comparator"
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={c.op}
                    onChange={(e) => updateCriterion(i, { op: Number(e.target.value) as Comparator })}
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
                  <label className="flex items-center gap-1 text-sm">
                    <input
                      type="checkbox"
                      aria-label="hard filter"
                      checked={c.hardFilter}
                      onChange={(e) => updateCriterion(i, { hardFilter: e.target.checked })}
                    />
                    hard
                  </label>
                  <Button
                    variant="destructive"
                    size="sm"
                    aria-label="remove criterion"
                    onClick={() => removeCriterion(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
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
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm" data-testid="screen-results">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3">Rank</th>
                    <th className="p-3">Symbol</th>
                    <th className="p-3">Score</th>
                    <th className="p-3">Passed</th>
                    <th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={r.symbol} className="border-b" data-testid="result-row">
                      <td className="p-3">{i + 1}</td>
                      <td className="p-3 font-medium">{r.symbol}</td>
                      <td className="p-3">{r.score.toFixed(3)}</td>
                      <td className="p-3">{r.passed ? '✓' : '—'}</td>
                      <td className="p-3">
                        {r.status === ScreenResultStatus.INSUFFICIENT_DATA ? (
                          <Badge variant="warning" data-testid="insufficient-data">
                            Insufficient data
                          </Badge>
                        ) : (
                          <Badge variant="info">OK</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
