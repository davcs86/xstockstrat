/**
 * Strategy authoring catalog — the closed set of choices the backend accepts.
 *
 * These mirror the analysis/indicators services so the wizard can offer
 * select-only inputs (dropdowns / type-ahead) instead of free-form text boxes:
 *   - Built-in indicators + their parameters: `xstockstrat-indicators`
 *     `app/services/indicators_engine.py` (`INDICATOR_REGISTRY` + each `_fn` default).
 *   - Rule condition functions: `xstockstrat-analysis`
 *     `app/services/evaluator.py` (`_SUPPORTED_FNS`).
 *
 * Keep this file in sync with those two sources of truth.
 */

import { ComponentKind } from '@xstockstrat/proto/analysis/v1/analysis_pb';

export type IndicatorParam = {
  /** Param key sent in `component.params` (must match the engine, e.g. "period"). */
  key: string;
  /** Human label shown in the form. */
  label: string;
  /** Default value pre-filled when the indicator is selected. */
  default: number;
};

/**
 * An output series an indicator emits. `key` matches the series name produced by
 * `indicators_engine.py` (the primary series is always "value"; multi-output
 * indicators add extras like "upper"/"lower"). In a rule, the primary series is
 * referenced by the bare ref_name and the rest by "<ref_name>.<key>".
 */
export type IndicatorOutput = {
  key: string;
  /** Human label shown next to the operand (e.g. "upper band"). */
  label: string;
};

export type BuiltinIndicator = {
  /** Canonical name sent as `component.indicator` (upper-case). */
  name: string;
  description: string;
  params: IndicatorParam[];
  /**
   * Output series, when the indicator emits more than the single "value" series.
   * Omitted for single-output indicators (implicitly just "value"). The first entry
   * is the primary series (the bare ref_name). Mirrors the extra keys in
   * `indicators_engine.py`.
   */
  outputs?: IndicatorOutput[];
};

// Mirrors INDICATOR_REGISTRY + per-indicator defaults in indicators_engine.py.
export const BUILTIN_INDICATORS: BuiltinIndicator[] = [
  {
    name: 'SMA',
    description: 'Simple Moving Average',
    params: [{ key: 'period', label: 'Period', default: 14 }],
  },
  {
    name: 'EMA',
    description: 'Exponential Moving Average',
    params: [{ key: 'period', label: 'Period', default: 14 }],
  },
  {
    name: 'RSI',
    description: 'Relative Strength Index',
    params: [{ key: 'period', label: 'Period', default: 14 }],
  },
  {
    name: 'MACD',
    description: 'Moving Average Convergence Divergence',
    params: [
      { key: 'fast', label: 'Fast period', default: 12 },
      { key: 'slow', label: 'Slow period', default: 26 },
      { key: 'signal', label: 'Signal period', default: 9 },
    ],
    outputs: [
      { key: 'value', label: 'MACD line' },
      { key: 'signal', label: 'signal line' },
      { key: 'histogram', label: 'histogram' },
    ],
  },
  {
    name: 'BB',
    description: 'Bollinger Bands',
    params: [
      { key: 'period', label: 'Period', default: 20 },
      { key: 'std_dev', label: 'Std. deviations', default: 2 },
    ],
    outputs: [
      { key: 'value', label: 'middle band' },
      { key: 'upper', label: 'upper band' },
      { key: 'lower', label: 'lower band' },
    ],
  },
  {
    name: 'ATR',
    description: 'Average True Range',
    params: [{ key: 'period', label: 'Period', default: 14 }],
  },
  {
    name: 'VWAP',
    description: 'Volume Weighted Average Price',
    params: [],
  },
  {
    name: 'STOCH',
    description: 'Stochastic Oscillator',
    params: [{ key: 'period', label: 'Period', default: 14 }],
    outputs: [
      { key: 'value', label: '%K' },
      { key: 'd', label: '%D' },
    ],
  },
];

export function findIndicator(name: string): BuiltinIndicator | undefined {
  const upper = (name ?? '').toUpperCase();
  return BUILTIN_INDICATORS.find((i) => i.name === upper);
}

/** Default params object for a freshly selected indicator. */
export function defaultParamsFor(name: string): Record<string, number> {
  const ind = findIndicator(name);
  if (!ind) return {};
  return Object.fromEntries(ind.params.map((p) => [p.key, p.default]));
}

// Condition functions supported by the evaluator (_SUPPORTED_FNS).
export type RuleFn = '>' | '<' | '>=' | '<=' | 'crosses_above' | 'crosses_below';

export type RuleFnOption = { fn: RuleFn; label: string; phrase: string };

export const RULE_FUNCTIONS: RuleFnOption[] = [
  { fn: '>', label: '> (greater than)', phrase: 'is greater than' },
  { fn: '<', label: '< (less than)', phrase: 'is less than' },
  { fn: '>=', label: '≥ (greater or equal)', phrase: 'is greater than or equal to' },
  { fn: '<=', label: '≤ (less or equal)', phrase: 'is less than or equal to' },
  { fn: 'crosses_above', label: 'crosses above', phrase: 'crosses above' },
  { fn: 'crosses_below', label: 'crosses below', phrase: 'crosses below' },
];

export function fnPhrase(fn: string): string {
  return RULE_FUNCTIONS.find((f) => f.fn === fn)?.phrase ?? fn;
}

/** A selectable rule operand: the value sent in the rule JSON plus display metadata. */
export type OperandRef = {
  /** What lands in the rule JSON (bare ref_name, or "<ref_name>.<series>"). */
  value: string;
  /** What the user sees in the dropdown. */
  label: string;
  /** Muted secondary text (e.g. "upper band"). */
  hint?: string;
};

/** Minimal shape of a strategy component needed to enumerate its rule operands. */
export type OperandComponent = {
  refName: string;
  kind: ComponentKind;
  indicator: string;
  formulaId: string;
};

/** A declared output series of a custom formula (name + optional description). */
export type FormulaOutputMeta = { name: string; description?: string };

/**
 * Declared outputs per custom-formula `formula_id`. Supplied by the strategy
 * authoring UI (from the indicators service) so formula components expose their
 * declared series as rule operands, just like built-in multi-output indicators.
 */
export type FormulaOutputsMap = Record<string, FormulaOutputMeta[]>;

/**
 * Expand a single component into the operands a rule may reference.
 *
 * - Single-output components yield just the bare `ref_name`.
 * - Multi-output built-in indicators (BB, MACD, STOCH) yield the bare `ref_name`
 *   (the primary series) plus one `<ref_name>.<series>` entry per extra series.
 * - Custom formulas yield the bare `ref_name` (the implicit "value" series) plus one
 *   `<ref_name>.<series>` entry per declared output (looked up by formula_id in
 *   `formulaOutputs`). When a formula's outputs are unknown, only the bare ref is
 *   offered; authors can still type `<ref_name>.<series>` in JSON mode.
 */
export function operandRefsForComponent(
  c: OperandComponent,
  formulaOutputs?: FormulaOutputsMap,
): OperandRef[] {
  const refName = (c.refName ?? '').trim();
  if (!refName) return [];

  if (c.kind === ComponentKind.BUILTIN_INDICATOR) {
    const ind = findIndicator(c.indicator);
    if (ind?.outputs && ind.outputs.length > 1) {
      return ind.outputs.map((o, i) => ({
        // The primary series is addressed by the bare ref_name (back-compat with the
        // evaluator); the rest use the dotted form.
        value: i === 0 ? refName : `${refName}.${o.key}`,
        label: i === 0 ? refName : `${refName}.${o.key}`,
        hint: o.label,
      }));
    }
  } else if (c.kind === ComponentKind.CUSTOM_FORMULA) {
    const declared = formulaOutputs?.[c.formulaId] ?? [];
    if (declared.length > 0) {
      return [
        { value: refName, label: refName, hint: 'value' },
        ...declared.map((o) => ({
          value: `${refName}.${o.name}`,
          label: `${refName}.${o.name}`,
          hint: o.description || o.name,
        })),
      ];
    }
  }
  return [{ value: refName, label: refName }];
}

/** Expand all components into a flat, de-duplicated operand list for the rule editor. */
export function operandRefs(
  components: OperandComponent[],
  formulaOutputs?: FormulaOutputsMap,
): OperandRef[] {
  const seen = new Set<string>();
  const out: OperandRef[] = [];
  for (const c of components) {
    for (const op of operandRefsForComponent(c, formulaOutputs)) {
      if (seen.has(op.value)) continue;
      seen.add(op.value);
      out.push(op);
    }
  }
  return out;
}
