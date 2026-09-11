'use client';
import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/components/ui/utils';
import type { SymbolDiagnostics } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import {
  BarAction,
  FillModel,
  NoTradeReason,
  SizingMode,
} from '@xstockstrat/proto/analysis/v1/analysis_pb';

// Exhaustive Record<SizingMode,…> — a new enum value fails `tsc` here. UNSPECIFIED renders as "Legacy":
// a null/legacy run row deserializes to the 0 sentinel, which is exactly what UNSPECIFIED means.
export const SIZING_MODE_LABEL: Record<SizingMode, string> = {
  [SizingMode.UNSPECIFIED]: 'Legacy',
  [SizingMode.LEGACY]: 'Legacy',
  [SizingMode.PORTFOLIO]: 'Portfolio',
};

// Exhaustive Record<FillModel,…> — a new enum value fails `tsc`. UNSPECIFIED → "Legacy" (the 0
// sentinel, which the server normalizes to same-bar-close).
export const FILL_MODEL_LABEL: Record<FillModel, string> = {
  [FillModel.UNSPECIFIED]: 'Legacy',
  [FillModel.SAME_BAR_CLOSE]: 'Same-bar close',
  [FillModel.NEXT_BAR_OPEN]: 'Next-bar open',
};

const ACTION_LABEL: Record<BarAction, string> = {
  [BarAction.UNSPECIFIED]: '—',
  [BarAction.WARMUP]: 'Warm-up',
  [BarAction.HOLD_FLAT]: 'Flat',
  [BarAction.ENTER_LONG]: 'Buy',
  [BarAction.EXIT_LONG]: 'Sell',
  [BarAction.HOLD_LONG]: 'Hold',
};

const NO_TRADE_MESSAGE: Record<NoTradeReason, string> = {
  [NoTradeReason.UNSPECIFIED]: '',
  [NoTradeReason.ENTIRE_RANGE_WARMUP]:
    'No trades — the entire range was warm-up (not enough bars for the indicators to resolve). Widen the date range or shorten the indicator periods.',
  [NoTradeReason.ENTRY_NEVER_TRUE]:
    'No trades — the entry condition was never satisfied over this range. Check the indicator values below against your entry rule.',
  [NoTradeReason.INSUFFICIENT_CAPITAL]: 'No trades — insufficient capital to open a position.',
  [NoTradeReason.FORMULA_ERROR]:
    'No trades — a custom-formula component failed to execute over this range. Check the formula definition and its inputs.',
};

function fmtDate(seconds: bigint | undefined): string {
  if (seconds === undefined) return '';
  return new Date(Number(seconds) * 1000).toISOString().slice(0, 10);
}

function fmtNum(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : '';
}

function actionClass(action: BarAction): string {
  if (action === BarAction.ENTER_LONG) return 'text-buy';
  if (action === BarAction.EXIT_LONG) return 'text-destructive';
  if (action === BarAction.WARMUP) return 'text-muted-foreground';
  return 'text-foreground';
}

/**
 * Day-by-day backtest diagnostics: one card per symbol with the no-trade reason and a virtualized
 * table of every bar (OHLCV, indicators, warm-up flag, action, conviction) — why a strategy traded or not.
 */
export function BacktestDiagnostics({ diagnostics }: { diagnostics: SymbolDiagnostics[] }) {
  if (!diagnostics.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Debug — day by day</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {diagnostics.map((sd) => (
          <SymbolTable key={sd.symbol} sd={sd} />
        ))}
      </CardContent>
    </Card>
  );
}

function SymbolTable({ sd }: { sd: SymbolDiagnostics }) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Indicator columns = the union of keys seen across all bars (stable order).
  const indicatorKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const bar of sd.bars) {
      for (const k of Object.keys(bar.indicators)) keys.add(k);
    }
    return Array.from(keys).sort();
  }, [sd.bars]);

  const rowVirtualizer = useVirtualizer({
    count: sd.bars.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 12,
  });

  const cols = 3 + indicatorKeys.length + 3; // date, close, volume | indicators | warmup, action, conviction
  const gridTemplate = `110px 90px 90px ${indicatorKeys.map(() => '90px').join(' ')} 70px 70px 90px`;
  const noTradeMsg = NO_TRADE_MESSAGE[sd.noTradeReason] ?? '';

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-mono text-sm font-semibold">{sd.symbol}</span>
        <span className="text-xs text-muted-foreground">
          {sd.barsTotal} bars · {sd.warmupBars} warm-up
        </span>
      </div>
      {noTradeMsg && (
        <Alert data-testid="no-trade-reason">
          <AlertDescription>{noTradeMsg}</AlertDescription>
        </Alert>
      )}
      <div
        ref={parentRef}
        data-testid="diagnostics-table"
        className="max-h-[420px] overflow-auto rounded-md border border-border text-xs"
      >
        {/* header */}
        <div
          className="sticky top-0 z-10 grid gap-px bg-secondary font-medium text-muted-foreground"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <HeaderCell>Date</HeaderCell>
          <HeaderCell align="right">Close</HeaderCell>
          <HeaderCell align="right">Volume</HeaderCell>
          {indicatorKeys.map((k) => (
            <HeaderCell key={k} align="right">
              {k}
            </HeaderCell>
          ))}
          <HeaderCell align="right">Warm</HeaderCell>
          <HeaderCell>Action</HeaderCell>
          <HeaderCell align="right">Conv.</HeaderCell>
        </div>
        {/* virtualized body */}
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((vi) => {
            const bar = sd.bars[vi.index];
            return (
              <div
                key={vi.key}
                className={cn(
                  'absolute left-0 top-0 grid w-full items-center gap-px tabular-nums',
                  bar.warmup && 'opacity-60',
                )}
                style={{
                  gridTemplateColumns: gridTemplate,
                  height: vi.size,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <Cell>{fmtDate(bar.timestamp?.seconds)}</Cell>
                <Cell align="right">{fmtNum(bar.close)}</Cell>
                <Cell align="right">{bar.volume.toString()}</Cell>
                {indicatorKeys.map((k) => (
                  <Cell key={k} align="right">
                    {k in bar.indicators ? fmtNum(bar.indicators[k], 3) : ''}
                  </Cell>
                ))}
                <Cell align="right">{bar.warmup ? '✓' : ''}</Cell>
                <Cell className={actionClass(bar.action)}>{ACTION_LABEL[bar.action]}</Cell>
                <Cell align="right">{fmtNum(bar.conviction)}</Cell>
              </div>
            );
          })}
        </div>
      </div>
      <span className="sr-only">{cols} columns</span>
    </div>
  );
}

function HeaderCell({ children, align }: { children: React.ReactNode; align?: 'right' }) {
  return <div className={cn('px-2 py-1.5', align === 'right' && 'text-right')}>{children}</div>;
}

function Cell({
  children,
  align,
  className,
}: {
  children: React.ReactNode;
  align?: 'right';
  className?: string;
}) {
  return (
    <div className={cn('truncate px-2', align === 'right' && 'text-right', className)}>
      {children}
    </div>
  );
}
