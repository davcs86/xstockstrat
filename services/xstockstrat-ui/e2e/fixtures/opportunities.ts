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
  },
];
