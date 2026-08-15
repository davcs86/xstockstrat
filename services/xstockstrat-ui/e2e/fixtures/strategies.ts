/**
 * Canonical strategy fixtures: scored strategies (ListStrategies) and
 * registered strategy definitions (ListStrategyDefinitions).
 *
 * Shape sources: `xstockstrat.analysis.v1.StrategyScore` and
 * `xstockstrat.analysis.v1.StrategyDefinition`
 * (packages/proto/analysis/v1/analysis.proto).
 *
 * The three scores deliberately span the UI's colour bands: ≥0.80 (green),
 * 0.60–0.79 (yellow), <0.60 (red) — keep that spread when editing values.
 * The mid strategy is the canonical *provisional* grade (thin evidence);
 * high and low are well-evidenced (feature 065).
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */

export const STRATEGY_SCORE_HIGH = {
  strategyId: 'strat-high-001',
  name: 'Momentum Alpha',
  description: 'High-conviction momentum strategy',
  rating: 'A',
  overallScore: 0.87,
  evidenceSymbols: 8,
  evidenceDays: 2100,
  provisional: false,
};

export const STRATEGY_SCORE_MID = {
  strategyId: 'strat-mid-002',
  name: 'Mean Reversion',
  description: 'Statistical arbitrage mean reversion',
  rating: 'B',
  overallScore: 0.68,
  evidenceSymbols: 1,
  evidenceDays: 60,
  provisional: true,
};

export const STRATEGY_SCORE_LOW = {
  strategyId: 'strat-low-003',
  name: 'Trend Follow',
  description: 'Simple trend following strategy',
  rating: 'D',
  overallScore: 0.42,
  evidenceSymbols: 4,
  evidenceDays: 900,
  provisional: false,
};

export const STRATEGY_SCORES = [STRATEGY_SCORE_HIGH, STRATEGY_SCORE_MID, STRATEGY_SCORE_LOW];

/** The canonical live-enabled strategy definition (feature 048). */
export const STRATEGY_DEF_LIVE = {
  strategyId: 'strat-live-001',
  displayName: 'Live Test Strategy',
  active: true,
  liveEnabled: true,
};

export const STRATEGY_DEF_INACTIVE = {
  strategyId: 'strat-live-002',
  displayName: 'Inactive Strategy',
  active: true,
  liveEnabled: false,
};

/** feature 132 — a definition carrying an entry-only deny list + signal_eligible (deny-list UI). */
export const STRATEGY_DEF_DENY = {
  strategyId: 'strat-001',
  displayName: 'Deny List Strategy',
  active: true,
  liveEnabled: true,
  deniedSymbols: ['TSLA'],
  signalEligible: true,
};

export const STRATEGY_DEFINITIONS = [STRATEGY_DEF_LIVE, STRATEGY_DEF_INACTIVE, STRATEGY_DEF_DENY];
