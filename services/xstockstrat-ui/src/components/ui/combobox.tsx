'use client';
import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './utils';

export type ComboboxOption = {
  value: string;
  label?: string;
  /** Secondary text shown muted next to the label (e.g. a description). */
  hint?: string;
};

interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  /** When true the typed text is kept even if it matches no option (e.g. numeric literals). */
  allowFreeText?: boolean;
  emptyText?: string;
  className?: string;
  'aria-label'?: string;
  disabled?: boolean;
}

/**
 * Lightweight type-ahead dropdown: an input that filters `options` by substring
 * and lets the user pick one (or, when `allowFreeText`, type an arbitrary value).
 * Self-contained — no portal — so it composes inside wizard cards without extra deps.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  allowFreeText = false,
  emptyText = 'No matches',
  className,
  'aria-label': ariaLabel,
  disabled,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // While open, the input reflects the in-progress query; while closed it shows the
  // selected option's label (falling back to the raw value for free-text entries).
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;
  const display = open ? query : selectedLabel;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.value.toLowerCase().includes(q) || (o.label ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  React.useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function commit(v: string) {
    onChange(v);
    setQuery('');
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className={cn('relative w-full', className)}>
      <div className="relative">
        <input
          aria-label={ariaLabel}
          disabled={disabled}
          className="flex h-10 w-full rounded-md border border-input bg-secondary px-3 py-2 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={placeholder}
          value={display}
          onFocus={() => {
            setQuery(value);
            setOpen(true);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            if (allowFreeText) onChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered.length > 0) commit(filtered[0].value);
              else if (allowFreeText) commit(query);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
      </div>

      {open && (
        <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-border bg-card text-card-foreground shadow-md">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{emptyText}</li>
          ) : (
            filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  // onMouseDown so the click registers before the input blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    commit(o.value);
                  }}
                  className={cn(
                    'flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground',
                    o.value === value && 'bg-accent text-accent-foreground',
                  )}
                >
                  <span>{o.label ?? o.value}</span>
                  {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
