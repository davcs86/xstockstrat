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

export type IndicatorParam = {
  /** Param key sent in `component.params` (must match the engine, e.g. "period"). */
  key: string;
  /** Human label shown in the form. */
  label: string;
  /** Default value pre-filled when the indicator is selected. */
  default: number;
};

export type BuiltinIndicator = {
  /** Canonical name sent as `component.indicator` (upper-case). */
  name: string;
  description: string;
  params: IndicatorParam[];
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
  },
  {
    name: 'BB',
    description: 'Bollinger Bands',
    params: [
      { key: 'period', label: 'Period', default: 20 },
      { key: 'std_dev', label: 'Std. deviations', default: 2 },
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
