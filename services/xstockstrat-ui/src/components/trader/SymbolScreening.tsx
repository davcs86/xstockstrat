'use client';
import { useMemo, useState } from 'react';
import { Plus, Trash2, Play } from 'lucide-react';
import { ConnectError } from '@connectrpc/connect';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
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
import { DataTable } from '@/components/ui/data-table';
import { useScreenSymbols, type ScreenSymbolsInput } from '@/hooks/useScreenSymbols';
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
  buildScreenCriterion,
  useCriteriaList,
} from '@/lib/screenCriteria';
import {
  Comparator,
  ScreenKind,
  ScreenResultStatus,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';

// Single-symbol Screening section (non-watchlisted symbols only), running the same ScreenSymbols RPC as the
// Screener page. Rank fields collapse to a content-free 0.5 on a one-symbol scan, so it shows ONLY the per-criterion raw/passed maps.

export function SymbolScreening({ symbol }: { symbol: string }) {
  const screen = useScreenSymbols();
  const {
    criteria,
    add: addCriterion,
    remove: removeCriterion,
    update: updateCriterion,
  } = useCriteriaList();
  // The criteria snapshot actually screened — echoed in the result rows so the displayed threshold
  // reflects the run, not a subsequent unrun edit.
  const [ranCriteria, setRanCriteria] = useState<CriterionRow[]>([]);

  function runScan() {
    if (criteria.length === 0) return;
    const snapshot = criteria;
    const req: ScreenSymbolsInput = {
      symbols: [symbol],
      criteria: criteria.map(buildScreenCriterion),
    };
    screen.mutate(req, { onSuccess: () => setRanCriteria(snapshot) });
  }

  const result = screen.data?.results?.[0];
  const insufficient = result?.status === ScreenResultStatus.INSUFFICIENT_DATA;
  const errorMessage =
    screen.error instanceof ConnectError
      ? screen.error.rawMessage
      : (screen.error?.message ?? null);

  // criterion_raw_values / criterion_passed are keyed by ref_name; a skipped criterion
  // (unavailable reading) is absent from both maps → render em-dashes.
  const columns = useMemo<ColumnDef<CriterionRow>[]>(
    () => [
      {
        id: 'criterion',
        header: 'Criterion',
        meta: { className: 'font-mono text-xs' },
        cell: ({ row }) =>
          `${row.original.metricName} ${comparatorGlyph(row.original.op)} ${row.original.threshold}`,
      },
      {
        id: 'raw',
        header: 'Raw',
        meta: { className: 'text-right font-mono tabular-nums' },
        cell: ({ row }) => {
          if (!result) return '—';
          const evaluated = row.original.refName in result.criterionRawValues;
          const raw = result.criterionRawValues[row.original.refName];
          return evaluated && raw !== undefined ? raw.toFixed(2) : '—';
        },
      },
      {
        accessorKey: 'threshold',
        header: 'Threshold',
        meta: { className: 'text-right font-mono tabular-nums' },
      },
      {
        id: 'pass',
        header: 'Pass',
        cell: ({ row }) => {
          if (!result) return '—';
          const evaluated = row.original.refName in result.criterionRawValues;
          if (!evaluated) return '—';
          const passed = result.criterionPassed[row.original.refName];
          return passed ? <Badge variant="buy">Pass</Badge> : <Badge variant="sell">Fail</Badge>;
        },
      },
    ],
    [result],
  );

  return (
    <Card data-testid="symbol-screening">
      <CardHeader>
        <CardTitle className="text-base">Screening</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {symbol} isn&apos;t on a watchlist — test it against ad hoc criteria.
        </p>

        <div className="space-y-2">
          {criteria.map((c, i) => (
            <div
              key={i}
              className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
              data-testid="symbol-criterion-row"
            >
              {/* <kind> <metric> <comparator> <threshold> grammar — same shape the full Screener
                  uses, composed from shadcn Select/Input primitives. */}
              <Select
                value={String(c.kind)}
                onValueChange={(v) => {
                  const kind = Number(v) as CriterionRow['kind'];
                  const metricName =
                    kind === ScreenKind.TECHNICAL_INDICATOR
                      ? BUILTIN_INDICATORS[0].name
                      : DEFAULT_FUNDAMENTAL_METRIC;
                  updateCriterion(i, { kind, metricName });
                }}
              >
                <SelectTrigger aria-label="kind" className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={c.metricName}
                onValueChange={(v) => updateCriterion(i, { metricName: v })}
              >
                <SelectTrigger aria-label="metric" className="h-9 w-44 font-mono">
                  <SelectValue placeholder="Select a metric…" />
                </SelectTrigger>
                <SelectContent>
                  {c.kind === ScreenKind.TECHNICAL_INDICATOR
                    ? BUILTIN_INDICATORS.map((ind) => (
                        <SelectItem key={ind.name} value={ind.name}>
                          {ind.name} — {ind.description}
                        </SelectItem>
                      ))
                    : FUNDAMENTAL_METRICS.map((m) => (
                        <SelectItem key={m.name} value={m.name}>
                          {m.name} — {m.description}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>

              <Select
                value={String(c.op)}
                onValueChange={(v) => updateCriterion(i, { op: Number(v) as Comparator })}
              >
                <SelectTrigger aria-label="comparator" className="h-9 w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARATOR_LABELS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                aria-label="threshold"
                type="number"
                className="w-28"
                value={c.threshold}
                onChange={(e) => updateCriterion(i, { threshold: Number(e.target.value) })}
              />

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
            <Plus className="mr-1 h-4 w-4" /> Add criterion
          </Button>
        </div>

        <Button
          data-testid="run-symbol-screen"
          onClick={runScan}
          disabled={screen.isPending || criteria.length === 0}
        >
          <Play className="mr-1.5 h-4 w-4" /> Run screen
        </Button>

        {screen.isPending && (
          <p data-testid="symbol-screen-loading" className="text-sm text-muted-foreground">
            Screening…
          </p>
        )}
        {errorMessage && (
          <p data-testid="symbol-screen-error" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}

        {result &&
          !screen.isPending &&
          (insufficient ? (
            <div
              data-testid="symbol-screen-insufficient"
              className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
            >
              <Badge variant="warning">Insufficient data</Badge>
              <span>
                Not enough data to screen {symbol}
                {result.gap
                  ? ` — needs ${result.gap.barsNeed} bars, has ${result.gap.barsHave}.`
                  : '.'}
              </span>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={ranCriteria}
              getRowId={(c) => c.refName}
              tableTestId="symbol-screen-results"
              getRowProps={() => ({ 'data-testid': 'symbol-screen-row' })}
            />
          ))}
      </CardContent>
    </Card>
  );
}
