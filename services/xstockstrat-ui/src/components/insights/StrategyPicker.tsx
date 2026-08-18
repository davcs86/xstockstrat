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
 * Shared strategy picker (feature 145) — the single source of the "which strategy drives the
 * strategy-scoped panels" control, lifted out of `SignalReadiness` so the Indicators, Backtests, and
 * "Why this fired" panels all render the same synced dropdown. Lists only strategies eligible to
 * trade live (`useStrategyDefinitions()` default `includeInactive=false` → active, then
 * `.filter(liveEnabled)`) — the exact filter `SignalReadiness` used before this feature. Controlled:
 * the page owns the selected id, so all three instances stay in lockstep.
 *
 * `ariaLabel` MUST be distinct per instance ("Strategy for Indicators" / "…Backtests" /
 * "…Why this fired") — three identically-labeled comboboxes would make `getByLabel('Strategy')`
 * ambiguous across the page (the 2026-08-09 Breadcrumb implicit-label trap).
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
