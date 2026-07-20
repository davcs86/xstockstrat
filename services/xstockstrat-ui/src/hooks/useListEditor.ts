'use client';

/**
 * Generic add / update / remove / reorder helpers for an editable list bound to a
 * value/onChange pair. Shared by the formula OutputEditor and ParameterEditor so the
 * list-manipulation logic lives in one place (DRY guard rail — see
 * docs/patterns/dry-guard-rail.md).
 */
export function useListEditor<T extends object>(
  value: T[],
  onChange: (next: T[]) => void,
  makeEmpty: () => T,
) {
  const update = (i: number, patch: Partial<T>) =>
    onChange(value.map((x, j) => (j === i ? ({ ...x, ...patch } as T) : x)));
  const add = () => onChange([...value, makeEmpty()]);
  const remove = (i: number) => onChange(value.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return { update, add, remove, move };
}
