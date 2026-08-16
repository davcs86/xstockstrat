'use client';

import * as React from 'react';
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/components/ui/utils';

/**
 * Minimal duck-typed interface for the row-click interactive-target guard — independently
 * unit-testable under the node-environment Vitest config with no `jsdom`.
 */
interface ClosestTarget {
  closest(selectors: string): Element | null;
}

/**
 * Returns true when `target` sits inside a native interactive element (`<a>`, `<button>`,
 * `[role="button"]`) or an explicit `[data-row-click-ignore]` escape hatch. Used to guard
 * `DataTable`'s `onRowClick` so a click/keydown on a nested interactive element never also
 * fires the row handler.
 *
 * `[role="button"]:not([data-datatable-row])` deliberately excludes the row's own `role="button"`
 * (set below, for a11y, on every `onRowClick`-enabled row) — without the exclusion, `.closest()`
 * would always find the row itself as the nearest `[role="button"]` ancestor-or-self for *any*
 * click inside it, permanently short-circuiting `onRowClick`. The exclusion still catches a
 * genuinely nested `role="button"` element (e.g. an icon-button that isn't a native `<button>`).
 */
export function isInteractiveTarget(target: ClosestTarget): boolean {
  return !!target.closest(
    'a, button, [role="button"]:not([data-datatable-row]), [data-row-click-ignore]',
  );
}

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  /**
   * Must be a referentially-stable array (wrap in `useMemo` if computed inline every render) —
   * TanStack Table's internal row-model state can reset unexpectedly on an unstable data
   * reference (see ledger `fails.md` 2026-08-08).
   */
  data: TData[];
  onRowClick?: (row: TData) => void;
  enablePagination?: boolean;
  pageSize?: number;
  emptyMessage?: string;
  getRowId?: (row: TData, index: number) => string;
  rowClassName?: (row: TData) => string | undefined;
  tableClassName?: string;
  /** Root `<table>` `data-testid`, for call sites migrating an existing testid-bearing table. */
  tableTestId?: string;
  /** Extra attributes (e.g. `data-testid`) merged onto each row's `<tr>`. */
  getRowProps?: (row: TData) => React.HTMLAttributes<HTMLTableRowElement>;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  enablePagination = false,
  pageSize,
  emptyMessage = 'No results.',
  getRowId,
  rowClassName,
  tableClassName,
  tableTestId,
  getRowProps,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(enablePagination
      ? {
          getPaginationRowModel: getPaginationRowModel(),
          initialState: { pagination: { pageSize: pageSize ?? 10 } },
        }
      : {}),
    ...(getRowId ? { getRowId } : {}),
  });

  const handleRowClick = (row: TData) => (e: React.MouseEvent) => {
    if (!onRowClick) return;
    if (isInteractiveTarget(e.target as unknown as ClosestTarget)) return;
    onRowClick(row);
  };

  const handleRowKeyDown = (row: TData) => (e: React.KeyboardEvent) => {
    if (!onRowClick) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (isInteractiveTarget(e.target as unknown as ClosestTarget)) return;
    e.preventDefault();
    onRowClick(row);
  };

  return (
    <div className="space-y-2">
      <Table className={tableClassName} data-testid={tableTestId}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortState = header.column.getIsSorted();
                return (
                  <TableHead
                    key={header.id}
                    className={cn(
                      (header.column.columnDef.meta as { className?: string } | undefined)
                        ?.className,
                    )}
                  >
                    {header.isPlaceholder ? null : canSort ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium"
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortState === 'asc' ? (
                          <ArrowUp className="size-3.5" />
                        ) : sortState === 'desc' ? (
                          <ArrowDown className="size-3.5" />
                        ) : (
                          <ArrowUpDown className="size-3.5 text-muted-foreground" />
                        )}
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={rowClassName?.(row.original)}
                {...getRowProps?.(row.original)}
                {...(onRowClick
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      'data-datatable-row': '',
                      onClick: handleRowClick(row.original),
                      onKeyDown: handleRowKeyDown(row.original),
                    }
                  : {})}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      (cell.column.columnDef.meta as { className?: string } | undefined)?.className,
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {enablePagination && (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
