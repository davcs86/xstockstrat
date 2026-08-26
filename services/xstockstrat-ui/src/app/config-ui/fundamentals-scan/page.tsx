'use client';

import { useState } from 'react';
import { ConnectError } from '@connectrpc/connect';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useRunFundamentalsScan } from '@/app/config-ui/hooks/useRunFundamentalsScan';

// Admin-only manual trigger for the fundamentals signal producer (feature 156). The BFF route
// (config-ui AnalysisService.runFundamentalsScan) is gated by forwardAdmin, so a non-admin caller
// receives a ConnectError (PermissionDenied) on submit — the authoritative gate, surfaced here.
export default function FundamentalsScanPage() {
  const [force, setForce] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [symbolsText, setSymbolsText] = useState('');
  const scan = useRunFundamentalsScan();

  const onRun = () => {
    const symbols = symbolsText
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    scan.mutate({ force, dryRun, symbols });
  };

  const summary = scan.data;
  const error = scan.error
    ? scan.error instanceof ConnectError
      ? scan.error.rawMessage
      : scan.error.message
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Run Fundamentals Scan</h1>
        <p className="text-sm text-muted-foreground">
          Manually trigger the fundamentals signal producer. Admin-scoped — the scheduled loop is
          unaffected, and a same-day re-run emits nothing unless <code>force</code> is set.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="force-toggle">Force re-emit</Label>
              <p className="text-xs text-muted-foreground">
                Clear today&apos;s idempotency rows and re-emit.
              </p>
            </div>
            <Switch
              id="force-toggle"
              data-testid="force-toggle"
              checked={force}
              onCheckedChange={setForce}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="dry-run-toggle">Dry run</Label>
              <p className="text-xs text-muted-foreground">
                Score and report without emitting or spending cache calls.
              </p>
            </div>
            <Switch
              id="dry-run-toggle"
              data-testid="dry-run-toggle"
              checked={dryRun}
              onCheckedChange={setDryRun}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="symbols-input">Symbols (optional, comma-separated)</Label>
            <Input
              id="symbols-input"
              data-testid="symbols-input"
              placeholder="AAPL, MSFT — leave blank for the configured universe"
              value={symbolsText}
              onChange={(e) => setSymbolsText(e.target.value)}
            />
          </div>

          <Button data-testid="run-scan-button" onClick={onRun} disabled={scan.isPending}>
            {scan.isPending ? 'Running…' : 'Run scan'}
          </Button>

          {error && (
            <p data-testid="scan-error" className="text-sm text-destructive">
              {error}
            </p>
          )}

          {summary && (
            <div data-testid="scan-summary" className="rounded-md border p-3 text-sm">
              <div>
                Status: <span className="font-medium">{summary.status}</span>
              </div>
              <div>Symbols processed: {summary.symbolsProcessed}</div>
              <div>Signals emitted: {summary.signalsEmitted}</div>
              <div>Cache calls spent: {summary.callsSpent}</div>
              <div>Deferred: {summary.deferredCount}</div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
