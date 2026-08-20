'use client';
import { useState } from 'react';
import { AppShell } from '@/components/insights/AppShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { usePnLPatterns } from '@/hooks/usePnLPatterns';
import { FactorType } from '@xstockstrat/proto/analysis/v1/analysis_pb';

/**
 * feature 042 — P&L Patterns view. Renders the ranked top positive- and negative-contributing
 * attribution factors (indicator value-ranges and signals) for a symbol, plus a per-order snapshot
 * timeline placeholder (FR-5). Reads QueryPnLPatterns via the insights BFF (usePnLPatterns).
 */

type Factor = {
  factorName: string;
  factorType: FactorType;
  valueRangeLow: number;
  valueRangeHigh: number;
  sampleCount: number;
  avgPnlImpact: number;
};

function FactorCard({ factor }: { factor: Factor }) {
  const isIndicator = factor.factorType === FactorType.INDICATOR;
  const positive = factor.avgPnlImpact >= 0;
  return (
    <div
      className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
      data-testid="pnl-factor-card"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono font-semibold">{factor.factorName}</span>
          <Badge variant={isIndicator ? 'info' : 'paper'}>
            {isIndicator ? 'Indicator' : 'Signal'}
          </Badge>
        </div>
        {isIndicator && (
          <p className="text-xs text-muted-foreground">
            {factor.valueRangeLow.toFixed(2)} – {factor.valueRangeHigh.toFixed(2)} ·{' '}
            {factor.sampleCount} samples
          </p>
        )}
        {!isIndicator && (
          <p className="text-xs text-muted-foreground">{factor.sampleCount} samples</p>
        )}
      </div>
      <span
        className={`font-mono tabular-nums ${positive ? 'text-buy' : 'text-sell'}`}
        data-testid="pnl-factor-impact"
      >
        {positive ? '+' : ''}
        {factor.avgPnlImpact.toFixed(2)}
      </span>
    </div>
  );
}

export default function PnLPatternsPage() {
  const [symbol, setSymbol] = useState('AAPL');
  const { data, isLoading, error } = usePnLPatterns(symbol);

  const positive = (data?.positiveFactors ?? []) as Factor[];
  const negative = (data?.negativeFactors ?? []) as Factor[];

  return (
    <AppShell>
      <div className="space-y-4" data-testid="pnl-patterns-page">
        <div>
          <h1 className="text-lg font-semibold">P&amp;L Patterns</h1>
          <p className="text-sm text-muted-foreground">
            Which indicator value-ranges and signals correlate with positive vs negative realized
            P&amp;L for a symbol.
          </p>
        </div>

        <Input
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="Symbol (e.g. AAPL)"
          aria-label="Symbol"
          className="max-w-xs"
        />

        {error && (
          <p className="text-sm text-sell" data-testid="pnl-patterns-error">
            Failed to load P&amp;L patterns.
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top positive-contributing factors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2" data-testid="pnl-positive">
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!isLoading && positive.length === 0 && (
                <p className="text-sm text-muted-foreground">No positive factors yet.</p>
              )}
              {positive.map((f) => (
                <FactorCard key={`pos-${f.factorType}-${f.factorName}-${f.valueRangeLow}`} factor={f} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Top negative-contributing factors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2" data-testid="pnl-negative">
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!isLoading && negative.length === 0 && (
                <p className="text-sm text-muted-foreground">No negative factors yet.</p>
              )}
              {negative.map((f) => (
                <FactorCard key={`neg-${f.factorType}-${f.factorName}-${f.valueRangeLow}`} factor={f} />
              ))}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Per-order snapshot timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground" data-testid="pnl-timeline-placeholder">
              A per-order snapshot timeline for the selected symbol will appear here.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
