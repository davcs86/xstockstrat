'use client';

// Shared filter-controls row for AccountsModule.tsx and OrderFilters.tsx (feature 121, FR-12).
// Slot-based, not a layout-mode switch (see 121-shadcn-migration-medium-confidence design.md §4 —
// the round-1/round-2 debate rejected a `layout` variant enum as a leaky abstraction): it renders
// only the controls themselves; the surrounding Card/CardHeader/grid-vs-flex chrome stays owned by
// each call site.

import React from 'react';
import { Search } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

export interface FilterToolbarFilter {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
  /** Optional per-select width tuning (AccountsModule.tsx's three selects each had a distinct
   *  fixed width) — kept optional so callers that don't need it (OrderFilters.tsx) can omit it. */
  className?: string;
}

export interface FilterToolbarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder: string;
  };
  filters: FilterToolbarFilter[];
  dateRange?: {
    from: string;
    to: string;
    onFromChange: (value: string) => void;
    onToChange: (value: string) => void;
  };
  activeFilterCount: number;
  onClear: () => void;
  /** 'inline' — caller renders its own Clear button (e.g. in a CardHeader) and this component
   *  renders none. 'trailing' — this component renders the Clear button itself, below the row. */
  clearPlacement: 'inline' | 'trailing';
}

// `activeFilterCount` is part of the approved props surface (design.md §4) for callers/future
// clearPlacement modes, but neither current mode reads it inside this component — 'inline'
// callers render their own count+Clear button entirely outside FilterToolbar (AccountsModule.tsx),
// and 'trailing' renders its Clear button unconditionally (see below) — so it is intentionally not
// destructured here.
export function FilterToolbar({
  search,
  filters,
  dateRange,
  onClear,
  clearPlacement,
}: FilterToolbarProps) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {search && (
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder={search.placeholder}
              className="pl-8 h-8 text-sm"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
            />
          </div>
        )}
        {filters.map((f) => (
          <Select key={f.ariaLabel} value={f.value} onValueChange={f.onValueChange}>
            <SelectTrigger aria-label={f.ariaLabel} className={f.className ?? 'h-8 text-sm'}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {f.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        {dateRange && (
          <>
            <Input
              type="date"
              value={dateRange.from}
              onChange={(e) => dateRange.onFromChange(e.target.value)}
              aria-label="Filter from date"
            />
            <Input
              type="date"
              value={dateRange.to}
              onChange={(e) => dateRange.onToChange(e.target.value)}
              aria-label="Filter to date"
            />
          </>
        )}
      </div>
      {/* 'trailing' always renders (today's OrderFilters.tsx behavior is unconditional — no
          activeFilterCount guard here, to keep this a like-for-like substitution). */}
      {clearPlacement === 'trailing' && (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        </div>
      )}
    </>
  );
}
