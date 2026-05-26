# Product Spec: multi-broker-smart-routing

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Maintain live connections to both IBKR and Alpaca simultaneously. Before submitting each order, query both brokers' pre-trade price estimates, route to the one offering better price improvement, then aggregate the resulting positions and fills into a unified portfolio view.

## Why It Seems Valuable

- Institutions use smart order routing to achieve best execution across venues — this is standard practice.
- IBKR and Alpaca have different order routing infrastructure; one may offer better fills for specific stocks at specific times.
- The platform already supports both brokers (via `BrokerType` enum); routing between them appears to be a config-time decision that could become a runtime decision.

## Why It Is Not Worth Building

**1. The economic benefit is negligible at retail position sizes.**
Smart order routing (SOR) earns meaningful savings when you are moving large blocks. For a 100-share order on a $50 stock ($5,000 notional), a 0.01/share price improvement saves $1.00. Spread across 200 trades a year, that is $200 in annual savings. The engineering cost of building, testing, and maintaining a dual-broker routing system — including the failure modes — is orders of magnitude larger than any realistic execution improvement.

**2. Maintaining two simultaneous live broker connections doubles operational risk.**
Each broker connection is a live socket that can disconnect, authenticate incorrectly, have API rate limits hit, or return stale quote data. Two simultaneous connections means two sets of these failure modes to handle, monitor, and recover from. A failure in the routing decision layer (which broker to use) can result in a missed execution or a double-submission if not handled precisely. The current single-broker architecture is simpler and more reliable.

**3. Position aggregation across two brokers is a ledger consistency problem.**
If positions exist in both IBKR and Alpaca accounts, the portfolio service must aggregate them correctly for P&L, concentration limits, and position sizing. Margin is calculated separately by each broker against their own account equity. A stop-loss order at IBKR does not protect a position at Alpaca. Reconciling fills, corporate actions, and dividends across two accounts is an ongoing operational burden.

**4. IBKR already provides internal smart routing.**
IBKR's SmartRouting system automatically routes orders across NYSE, NASDAQ, ARCA, and other venues to seek price improvement. When using IBKR, the platform is already getting institutional-grade order routing within that broker's infrastructure. Adding a second broker does not improve on this — it adds a second routing hop before the order reaches IBKR's routing.

**5. Alpaca's execution model is different in ways that complicate routing.**
Alpaca routes retail orders through market makers (order flow arrangements) rather than directly to lit exchanges. The execution model is fundamentally different from IBKR's direct market access. Comparing pre-trade quotes across these two models is not apples-to-apples and the "winner" at the routing decision point may not deliver better actual fills.

## Conditions Under Which This Should Be Reconsidered

- Position sizes grow to institutional scale (10,000+ shares per order) where execution quality differences are material in dollar terms.
- A specific, documented execution quality problem is identified with the current single-broker setup (e.g., consistent slippage on a specific order type or market condition) that a second broker demonstrably solves.
- Even then: route at order type level (e.g., all limit orders to IBKR, all market orders to Alpaca) based on static configuration — not dynamic per-order price comparison, which requires real-time quote infrastructure.

## Affected Services

_Not applicable — demoted before any design._
