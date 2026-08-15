/**
 * Canonical GetIndicatorSeriesResponse fixture for the unified Symbol page's FR-6 indicator overlay
 * panels (feature 125). Two consumers on day one: the `getIndicatorSeries` mock (`e2e/mock-backend.ts`)
 * and the panels e2e (`e2e/trader/position-detail.spec.ts`) — C-12.
 *
 * Shape source: `xstockstrat.analysis.v1.GetIndicatorSeriesResponse` (analysis.proto). Enums numeric.
 * A `NamedSeries.values[i]` is an `IndicatorValue`: `{}` = UNSET (a warm-up/gap point — must NOT plot
 * as 0.0, AC-4a/P-03); `{ value: n }` = a real reading (including a genuine 0.0). Two components:
 *  - `macd` — a multi-series component (value / signal / histogram) with a 2-point warm-up head, so
 *    the panel must render three lines and leave the leading gap unplotted.
 *  - `brokenformula` — a failed component (non-empty `error`, empty `series`): per-component fault
 *    isolation, rendered as a per-panel error state, never a chart.
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
const T = (seconds: number) => ({ seconds: BigInt(seconds), nanos: 0 });

// UNSET point (a warm-up/gap): an IndicatorValue with no `value` field.
const GAP = {};
const V = (value: number) => ({ value });

export const INDICATOR_SERIES_AAPL = {
  times: [T(1704067200), T(1704153600), T(1704240000), T(1704326400), T(1704412800)],
  components: [
    {
      refName: 'macd',
      kind: 1, // COMPONENT_KIND_BUILTIN_INDICATOR
      error: '',
      series: [
        { name: 'value', values: [GAP, GAP, V(1.2), V(1.5), V(1.1)] },
        { name: 'signal', values: [GAP, GAP, V(0.9), V(1.0), V(1.05)] },
        { name: 'histogram', values: [GAP, GAP, V(0.3), V(0.5), V(0.05)] },
      ],
    },
    {
      refName: 'brokenformula',
      kind: 2, // COMPONENT_KIND_CUSTOM_FORMULA
      series: [],
      error: 'formula f-broken failed: sandbox timeout',
    },
  ],
};
