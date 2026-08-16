'use client';
import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStrategyDefinitions, useManageStrategy } from '@/hooks/useStrategyDefinitions';
import { StrategyOperation } from '@xstockstrat/proto/analysis/v1/analysis_pb';

/**
 * feature 132 — "mute this symbol for a strategy": pick one of the caller's own strategies and
 * append this symbol (uppercase) to its deny list via a MASKED manageStrategy update
 * (updateMask=['denied_symbols']) — touches only the deny list, never clobbering the rest of the
 * definition. The strategy-definitions query is invalidated on success (wired in useManageStrategy),
 * so the "already muted" state reflects after the write.
 *
 * Relocated from the retired `insights/market/[symbol]` page onto the unified
 * `/trader/positions/[symbol]` page (feature 125) so the control survives that page's retirement.
 * Composed from shadcn primitives (Select) per the feature's shadcn-first requirement — the former
 * inline version used a raw `<select>`.
 */
export function MuteForStrategy({ symbol }: { symbol: string }) {
  const { data } = useStrategyDefinitions(true);
  const { mutate, isPending } = useManageStrategy();
  const [picked, setPicked] = useState('');
  const definitions = data?.definitions ?? [];
  const chosen = definitions.find((s) => s.strategyId === picked);
  const alreadyDenied = chosen?.deniedSymbols?.includes(symbol) ?? false;

  function mute() {
    if (!chosen) return;
    const next = Array.from(new Set([...(chosen.deniedSymbols ?? []), symbol]));
    mutate({
      operation: StrategyOperation.UPDATE,
      definition: { strategyId: chosen.strategyId, deniedSymbols: next },
      updateMask: ['denied_symbols'],
    });
  }

  return (
    <Card data-testid="mute-for-strategy">
      <CardHeader>
        <CardTitle className="text-base">Mute {symbol} for a strategy</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Adds {symbol} to the strategy&apos;s entry-only deny list — a held position still exits.
        </p>
        <div className="flex items-center gap-2">
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger
              data-testid="mute-strategy-select"
              aria-label="Mute strategy"
              className="h-9 w-64"
            >
              <SelectValue placeholder="Select a strategy…" />
            </SelectTrigger>
            <SelectContent>
              {definitions.map((s) => (
                <SelectItem key={s.strategyId} value={s.strategyId}>
                  {s.displayName || s.strategyId}
                  {s.deniedSymbols?.length ? ` (denies ${s.deniedSymbols.length})` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="secondary"
            data-testid="mute-submit"
            disabled={!chosen || alreadyDenied || isPending}
            onClick={mute}
          >
            {alreadyDenied ? 'Muted' : 'Mute'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
