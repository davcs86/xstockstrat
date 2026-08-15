import { OpportunityActionTag } from '@xstockstrat/proto/analysis/v1/analysis_pb';

/**
 * Opportunity-queue fixtures (feature 083, C-12). Connect-JSON (camelCase) shape of the
 * analysis.Opportunity message, used by mock-backend.ts (ListOpportunities) and the
 * opportunities e2e. Enum fields carry numeric values; validUntil is a protobuf-es Timestamp.
 */
const VALID_UNTIL = { seconds: BigInt(1_893_456_000), nanos: 0 }; // 2030-01-01

export const OPPORTUNITIES = [
  {
    symbol: 'AAPL',
    action: OpportunityActionTag.ENTER,
    conviction: 0.9,
    passingConditions: 4,
    totalConditions: 5,
    thesis: 'Golden cross with rising volume',
    strategyId: 'strat-001',
    source: 'unusual_whales',
    validUntil: VALID_UNTIL,
    // feature 097 — stable server-issued key (user|symbol_norm|strategy_id) + de-dup provenance.
    opportunityKey: 'u1|AAPL|strat-001',
    provenance: ['watchlist', 'unusual_whales'],
  },
  {
    symbol: 'MSFT',
    action: OpportunityActionTag.ADD,
    conviction: 0.75,
    passingConditions: 3,
    totalConditions: 5,
    thesis: 'Momentum continuation above the 50DMA',
    strategyId: 'strat-001',
    source: 'marketwatch',
    validUntil: VALID_UNTIL,
    opportunityKey: 'u1|MSFT|strat-001',
    provenance: ['position', 'marketwatch'],
  },
  {
    symbol: 'TSLA',
    action: OpportunityActionTag.REDUCE,
    conviction: 0.6,
    passingConditions: 0,
    totalConditions: 0,
    thesis: 'Overbought — trim into strength',
    strategyId: '',
    source: 'dividendology',
    validUntil: VALID_UNTIL,
    opportunityKey: 'u1|TSLA|',
    provenance: ['dividendology'],
  },
  {
    symbol: 'NVDA',
    action: OpportunityActionTag.ENTER,
    conviction: 0.85,
    passingConditions: 0,
    totalConditions: 0,
    thesis: 'Breakout from consolidation',
    strategyId: '',
    source: 'unusual_whales',
    validUntil: VALID_UNTIL,
    opportunityKey: 'u1|NVDA|',
    provenance: ['unusual_whales'],
  },
  // feature 132 — a held+denied REDUCE row: muted, but keeps its real exit trace + strategy.
  {
    symbol: 'AMD',
    action: OpportunityActionTag.REDUCE,
    conviction: 0.55,
    passingConditions: 1,
    totalConditions: 1,
    thesis: 'Deny-listed for entry; exit rule fired',
    strategyId: 'strat-001',
    source: '',
    validUntil: VALID_UNTIL,
    opportunityKey: 'u1|AMD|strat-001',
    provenance: ['position', 'denied'],
    muted: true,
  },
  // feature 132 — a standalone deny-listed 0/0 placeholder (conviction 0 — must survive the floor).
  {
    symbol: 'GME',
    action: OpportunityActionTag.UNSPECIFIED,
    conviction: 0,
    passingConditions: 0,
    totalConditions: 0,
    thesis: '',
    strategyId: 'strat-001',
    source: '',
    validUntil: VALID_UNTIL,
    opportunityKey: 'u1|GME|strat-001',
    provenance: ['denied'],
    muted: true,
  },
];

/**
 * feature 138 — an EXIT-rule SymbolReadiness for the Signal-detail mock. Distinct from the entry
 * trace below (different leaf `refName`/threshold and a passing count) so the e2e can prove the
 * panel traced the exit rule (not the entry rule) for a held opportunity.
 */
export function exitReadiness(symbol: string) {
  return {
    symbol,
    conviction: 1.0,
    passingConditions: 1,
    totalConditions: 1,
    conditions: [
      {
        refName: 'exit_z',
        lhsValue: -2.1,
        threshold: -2,
        fn: '<',
        state: 1,
        distanceToThreshold: 0.05,
      },
    ],
  };
}

/** A SymbolReadiness (traced condition leaves) for the Signal-detail EvaluateReadiness mock. */
export function symbolReadiness(symbol: string) {
  return {
    symbol,
    conviction: 0.8,
    passingConditions: 2,
    totalConditions: 3,
    conditions: [
      {
        refName: 'sma_fast',
        lhsValue: 152.3,
        threshold: 150,
        fn: '>',
        state: 1,
        distanceToThreshold: 0.015,
      },
      { refName: 'rsi', lhsValue: 58, threshold: 70, fn: '<', state: 1, distanceToThreshold: 0.17 },
      {
        refName: 'volume',
        lhsValue: 0.98,
        threshold: 1.0,
        fn: '>',
        state: 2,
        distanceToThreshold: -0.02,
      },
    ],
  };
}
