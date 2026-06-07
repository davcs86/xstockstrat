'use client';
import type { ExecuteFormulaResponse } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { Badge } from '@/components/ui/badge';
import { EXIT_REASON } from './formulaReference';

/** Tiny inline sparkline for numeric output series — no chart dependency. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 140;
  const h = 30;
  const pad = 2;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
      const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="text-primary shrink-0" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function asNumberArray(value: unknown): number[] | null {
  if (Array.isArray(value) && value.length > 0 && value.every((x) => typeof x === 'number')) {
    return value as number[];
  }
  return null;
}

function OutputRow({ name, value }: { name: string; value: unknown }) {
  const series = asNumberArray(value);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-2 last:border-0">
      <div className="min-w-0">
        <p className="font-mono text-xs text-foreground">{name}</p>
        {series ? (
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {series.length} pts · last {series[series.length - 1]}
          </p>
        ) : (
          <pre className="mt-0.5 max-w-[28ch] overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
            {JSON.stringify(value)}
          </pre>
        )}
      </div>
      {series && <Sparkline values={series} />}
    </div>
  );
}

export function FormulaRunResult({ result }: { result: ExecuteFormulaResponse }) {
  const exit = EXIT_REASON[result.exitReason] ?? EXIT_REASON[0];
  const outputEntries = Object.entries(result.output ?? {});

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={result.success ? 'buy' : 'destructive'}>
          {result.success ? 'Passed' : 'Failed'}
        </Badge>
        <Badge variant={exit.tone}>{exit.label}</Badge>
        <span className="text-muted-foreground tabular-nums">{String(result.executionMs)} ms</span>
      </div>

      {result.error && <p className="text-xs text-destructive">{result.error}</p>}

      {outputEntries.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            result
          </p>
          <div className="rounded-md bg-background/60 px-3">
            {outputEntries.map(([k, v]) => (
              <OutputRow key={k} name={k} value={v} />
            ))}
          </div>
        </div>
      )}

      {result.stdout && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            stdout
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 text-[11px] text-foreground/80">
            {result.stdout}
          </pre>
        </div>
      )}

      {result.stderr && (
        <div>
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            stderr
          </p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-background/60 p-2 text-[11px] text-destructive">
            {result.stderr}
          </pre>
        </div>
      )}
    </div>
  );
}
