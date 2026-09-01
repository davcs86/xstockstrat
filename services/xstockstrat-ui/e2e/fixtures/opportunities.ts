import { OpportunityActionTag } from '@xstockstrat/proto/analysis/v1/analysis_pb';

/**
 * Opportunity-queue fixtures (feature 083, C-12). Connect-JSON (camelCase) shape of the
 * analysis.Opportunity message, used by mock-backend.ts (ListOpportunities) and the
 * opportunities e2e. Enum fields carry numeric values; validUntil is a protobuf-es Timestamp.
 */
const VALID_UNTIL = { seconds: BigInt(1_893_456_000), nanos: 0 }; // 2030-01-01
const CAPR_VALID_UNTIL = { seconds: BigInt(1_893_508_200), nanos: 0 }; // 2030-01-01T14:30:00Z

/**
 * feature 095 — the CAPR sparkline: 20 recent daily closes with ONE gap (an unset `close`, `{}`)
 * at index 5 to prove a warm-up/missing bar renders as a gap, never NaN/0 (AC-4). Connect-JSON: a
 * SparklinePoint with `close` present is `{ close: n }`; a gap is `{}`.
 */
const CAPR_SPARKLINE = Array.from({ length: 20 }, (_v, i) =>
  i === 5 ? {} : { close: Number((11.9 + i * 0.023).toFixed(3)) },
);

/** feature 095 — the traced condition leaves persisted on the CAPR quality-dip-buy opportunity. */
const CAPR_CONDITIONS = [
  {
    refName: 'close',
    lhsValue: 12.34,
    threshold: 12.0,
    fn: '>',
    state: 1,
    distanceToThreshold: 0.028,
  },
  {
    refName: 'sma_20',
    lhsValue: 12.34,
    threshold: 12.1,
    fn: '>',
    state: 1,
    distanceToThreshold: 0.014,
  },
];

/**
 * feature 095 — the LatestPrice the mock marketdata returns for CAPR (AC-1/AC-2/AC-12). change% =
 * (12.34 − 12.09)/12.09 ≈ +2.07% → displayed +2.1%. Used by the off-queue Signal-detail fallback
 * (AC-13) and mirrored on the enriched CAPR opportunity rows so both surfaces read one source.
 */
export const CAPR_LATEST_PRICE = {
  symbol: 'CAPR',
  lastPrice: 12.34,
  lastTradeTime: { seconds: BigInt(1_893_508_100), nanos: 0 },
  prevClose: 12.09,
  source: 'alpaca',
};
const CAPR_CHANGE_PCT = (12.34 - 12.09) / 12.09;

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
  // feature 145 — AMZN carries TWO live-strategy opportunities (a non-watchlisted symbol evaluated by
  // more than one strategy). Exercises the tabbed opportunity panel group (one card per strategy).
  {
    symbol: 'AMZN',
    action: OpportunityActionTag.REDUCE,
    conviction: 1.0,
    passingConditions: 1,
    totalConditions: 1,
    thesis: 'Range mean-reversion — trim into strength',
    strategyId: 'strat-live-001',
    source: '',
    validUntil: VALID_UNTIL,
    opportunityKey: 'u1|AMZN|strat-live-001',
    provenance: ['live_strategy'],
  },
  {
    symbol: 'AMZN',
    action: OpportunityActionTag.ADD,
    conviction: 0.33,
    passingConditions: 1,
    totalConditions: 3,
    thesis: 'Quality dip — accumulate',
    strategyId: 'strat-001',
    source: '',
    validUntil: VALID_UNTIL,
    opportunityKey: 'u1|AMZN|strat-001',
    provenance: ['live_strategy'],
  },
  // feature 155 (FR-4, AC-9/10) — CAPR carries TWO strategies (quality-dip-buy + momentum), a
  // 'watchlist' source, and a 14:30Z expiry: exercises mobile symbol-grouping and the strategy id /
  // source chip / expiry tags the flat mobile row used to omit.
  {
    symbol: 'CAPR',
    action: OpportunityActionTag.ENTER,
    conviction: 0.7,
    passingConditions: 2,
    totalConditions: 3,
    thesis: 'Quality dip — accumulate',
    strategyId: 'quality-dip-buy',
    source: 'watchlist',
    validUntil: CAPR_VALID_UNTIL,
    opportunityKey: 'u1|CAPR|quality-dip-buy',
    provenance: ['watchlist'],
    // feature 095 — live-market enrichment (read-time) + strategy-derived target/stop + conditions.
    livePrice: 12.34,
    changePct: CAPR_CHANGE_PCT,
    sparkline: CAPR_SPARKLINE,
    targetPrice: 14.0,
    stopPrice: 11.5,
    conditions: CAPR_CONDITIONS,
  },
  {
    symbol: 'CAPR',
    action: OpportunityActionTag.ADD,
    conviction: 0.5,
    passingConditions: 1,
    totalConditions: 3,
    thesis: 'Momentum building',
    strategyId: 'momentum',
    source: 'watchlist',
    validUntil: CAPR_VALID_UNTIL,
    opportunityKey: 'u1|CAPR|momentum',
    provenance: ['watchlist'],
    // feature 095 — symbol-level live fields mirror the quality-dip-buy row (same source, AC-12);
    // no target/stop on this strategy (AC-8 renders no overlay for it).
    livePrice: 12.34,
    changePct: CAPR_CHANGE_PCT,
    sparkline: CAPR_SPARKLINE,
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
