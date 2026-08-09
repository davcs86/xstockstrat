'use client';
import { Fragment } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Per-row callbacks handed to `renderRow` — each is already bound to that row's own
 * index, so the render-prop never has to thread `i` back into `useListEditor` itself.
 * `move` is omitted (not merely disabled) when the consumer doesn't pass `onMove`, so a
 * row shape with no reorder concept (e.g. RuleEditor's conditions) renders no move
 * controls at all.
 */
export interface RepeatableRowCtx<T> {
  update: (patch: Partial<T>) => void;
  remove: () => void;
  move?: (dir: -1 | 1) => void;
}

interface RepeatableRowListProps<T> {
  items: T[];
  onAdd: () => void;
  addLabel: string;
  onUpdate: (index: number, patch: Partial<T>) => void;
  onRemove: (index: number) => void;
  onMove?: (index: number, dir: -1 | 1) => void;
  renderRow: (item: T, index: number, ctx: RepeatableRowCtx<T>) => React.ReactNode;
}

/**
 * Generic add/edit/reorder/remove row-list shell shared by the formula OutputEditor,
 * ParameterEditor, and RuleEditor's condition builder (DRY guard rail — see
 * docs/patterns/dry-guard-rail.md). Each consumer instantiates its own `useListEditor`
 * and passes the resulting `update`/`add`/`remove`/`move` callbacks down — this
 * component is a pure rendering shell, not a second state-management layer, and takes
 * full control of a row's own fields via the `renderRow` render-prop so it can support
 * every row shape (single-tier, two-tier with a conditional grid, move-controls-optional)
 * without assuming one shape fits all.
 */
export function RepeatableRowList<T>({
  items,
  onAdd,
  addLabel,
  onUpdate,
  onRemove,
  onMove,
  renderRow,
}: RepeatableRowListProps<T>) {
  return (
    <>
      {items.map((item, i) => (
        <Fragment key={i}>
          {renderRow(item, i, {
            update: (patch) => onUpdate(i, patch),
            remove: () => onRemove(i),
            move: onMove ? (dir) => onMove(i, dir) : undefined,
          })}
        </Fragment>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={onAdd}>
        <Plus className="mr-1.5 h-4 w-4" />
        {addLabel}
      </Button>
    </>
  );
}
