'use client';
import { Line, LineChart, XAxis, YAxis } from 'recharts';
import type { ExecuteFormulaResponse } from '@xstockstrat/proto/indicators/v1/indicators_pb';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, type ChartConfig } from '@/components/ui/chart';
import { EXIT_REASON } from './formulaReference';

// Single-series sparkline config (feature 123 FR-4) — 'value' color mirrors the original
// `text-primary`/`currentColor` styling via the design token, not a new color.
const SPARKLINE_CONFIG: ChartConfig = {
  value: { label: 'Value', color: 'var(--primary)' },
};

/** Tiny inline sparkline for numeric output series. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const data = values.map((value, i) => ({ i, value }));
  return (
    <ChartContainer config={SPARKLINE_CONFIG} className="aspect-auto h-[30px] w-[140px] shrink-0">
      <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <XAxis dataKey="i" hide />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Line
          dataKey="value"
          type="monotone"
          stroke="var(--color-value)"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
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
