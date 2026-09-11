'use client';

// Shared filter-controls row for AccountsModule.tsx and OrderFilters.tsx. Slot-based: it renders only
// the controls themselves; each call site owns the surrounding Card/CardHeader/grid-vs-flex chrome.

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
  /** Optional per-select width tuning; callers that don't need it can omit it. */
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

// `activeFilterCount` is part of the props surface but neither current mode reads it here — 'inline'
// callers render their own count+Clear outside, 'trailing' renders unconditionally — so it's not destructured.
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
      {/* 'trailing' renders unconditionally — no activeFilterCount guard. */}
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
