import { useState } from 'react';
import { Comparator, ComponentKind, ScreenKind } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import { DEFAULT_FUNDAMENTAL_METRIC } from './strategyCatalog';

/**
 * Shared screening-criteria vocabulary — comparator/kind option lists, the `CriterionRow` shape, the
 * new-row factory, the criteria-list state hook, and the wire-criterion builder. Shared by the
 * Screener page and the single-symbol Screening section (DRY guard rail).
 */

/**
 * FUNDAMENTAL (a marketdata fundamentals field, e.g. "pe_ratio") or TECHNICAL_INDICATOR (a built-in
 * indicator computed from bars, e.g. "RSI"). `kind` decides whether `metricName` is sent as
 * `metric_name` or as `component.indicator` — sending an indicator name as a fundamental field
 * silently skips it server-side, and a skipped criterion never fails a hard filter, so this is load-bearing.
 */
export type CriterionRow = {
  refName: string;
  kind: ScreenKind.FUNDAMENTAL | ScreenKind.TECHNICAL_INDICATOR;
  metricName: string;
  op: Comparator;
  threshold: number;
  weight: number;
  hardFilter: boolean;
};

export const COMPARATOR_LABELS: Array<{ value: Comparator; label: string }> = [
  { value: Comparator.LT, label: '<' },
  { value: Comparator.LTE, label: '≤' },
  { value: Comparator.GT, label: '>' },
  { value: Comparator.GTE, label: '≥' },
];

export const KIND_OPTIONS: Array<{ value: CriterionRow['kind']; label: string }> = [
  { value: ScreenKind.FUNDAMENTAL, label: 'Fundamental' },
  { value: ScreenKind.TECHNICAL_INDICATOR, label: 'Technical indicator' },
];

export function comparatorGlyph(op: Comparator): string {
  return COMPARATOR_LABELS.find((c) => c.value === op)?.label ?? '?';
}

export function newCriterion(i: number): CriterionRow {
  return {
    refName: `c${i}`,
    kind: ScreenKind.FUNDAMENTAL,
    metricName: DEFAULT_FUNDAMENTAL_METRIC,
    op: Comparator.LT,
    threshold: 20,
    weight: 1,
    hardFilter: false,
  };
}

/** Criteria-list state + the add/remove/update mutators both criteria builders share. */
export function useCriteriaList(initial: CriterionRow[] = [newCriterion(1)]) {
  const [criteria, setCriteria] = useState<CriterionRow[]>(initial);
  const add = () => setCriteria((c) => [...c, newCriterion(c.length + 1)]);
  const remove = (i: number) => setCriteria((c) => c.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<CriterionRow>) =>
    setCriteria((c) => c.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  return { criteria, setCriteria, add, remove, update };
}

/**
 * Build the wire criterion for a `ScreenSymbols` request: a technical indicator routes through
 * `component` (so the engine computes it from bars); a fundamental sends a bare `metricName`.
 */
export function buildScreenCriterion(c: CriterionRow) {
  const base = {
    refName: c.refName,
    kind: c.kind,
    op: c.op,
    threshold: c.threshold,
    weight: c.weight,
    hardFilter: c.hardFilter,
  };
  if (c.kind === ScreenKind.TECHNICAL_INDICATOR) {
    return {
      ...base,
      component: {
        refName: c.refName,
        kind: ComponentKind.BUILTIN_INDICATOR,
        indicator: c.metricName.toUpperCase(),
      },
    };
  }
  return { ...base, metricName: c.metricName };
}
