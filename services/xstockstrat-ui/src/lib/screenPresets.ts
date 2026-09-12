import { Comparator, ScreenKind } from '@xstockstrat/proto/analysis/v1/analysis_pb';
import type { CriterionRow } from './screenCriteria';

export type ScreenPreset = {
  id: string;
  name: string;
  description: string;
  criteria: CriterionRow[];
};

/**
 * Shipped presets. "Fundamentals Signal" mirrors _BUILTIN_BANDS bad-endpoint thresholds
 * from fundsignal_loop.py plus the EPS binary gate. All metrics are in FUNDAMENTAL_METRICS.
 */
export const SCREEN_PRESETS: ScreenPreset[] = [
  {
    id: 'fundamentals-signal',
    name: 'Fundamentals Signal',
    description: 'PE, PB, ROE, D/E bands + EPS gate',
    criteria: [
      {
        refName: 'c1',
        kind: ScreenKind.FUNDAMENTAL,
        metricName: 'pe_ratio',
        op: Comparator.LT,
        threshold: 35,
        weight: 1,
        hardFilter: false,
      },
      {
        refName: 'c2',
        kind: ScreenKind.FUNDAMENTAL,
        metricName: 'pb_ratio',
        op: Comparator.LT,
        threshold: 5,
        weight: 1,
        hardFilter: false,
      },
      {
        refName: 'c3',
        kind: ScreenKind.FUNDAMENTAL,
        metricName: 'roe',
        op: Comparator.GT,
        threshold: 0.05,
        weight: 1,
        hardFilter: false,
      },
      {
        refName: 'c4',
        kind: ScreenKind.FUNDAMENTAL,
        metricName: 'debt_to_equity',
        op: Comparator.LT,
        threshold: 2,
        weight: 1,
        hardFilter: false,
      },
      {
        refName: 'c5',
        kind: ScreenKind.FUNDAMENTAL,
        metricName: 'eps',
        op: Comparator.GT,
        threshold: 0,
        weight: 1,
        hardFilter: true,
      },
    ],
  },
];
