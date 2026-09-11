'use client';
import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useStrategyDefinitions } from '@/hooks/useStrategyDefinitions';

/**
 * Shared strategy picker — the single source of the "which strategy drives the strategy-scoped panels"
 * control, so the Indicators, Backtests, and "Why this fired" panels render the same synced dropdown.
 * Lists only live-eligible strategies. Controlled: the page owns the selected id, so all instances stay in lockstep.
 *
 * `ariaLabel` MUST be distinct per instance — identically-labeled comboboxes make `getByLabel('Strategy')`
 * ambiguous across the page.
 */
export function StrategyPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}) {
  const { data: defs } = useStrategyDefinitions(false);
  const strategies = useMemo(() => (defs?.definitions ?? []).filter((s) => s.liveEnabled), [defs]);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-56" aria-label={ariaLabel}>
        <SelectValue placeholder="Select a strategy…" />
      </SelectTrigger>
      <SelectContent>
        {strategies.map((s) => (
          <SelectItem key={s.strategyId} value={s.strategyId}>
            {s.displayName || s.strategyId}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
