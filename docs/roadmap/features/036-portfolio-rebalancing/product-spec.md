# Product Spec: portfolio-rebalancing

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Add a scheduled rebalancing job that runs daily or weekly: computes the deviation of each open position from a target weight (e.g., equal-weight across N positions), then submits trim or add-to orders to restore target allocations. Optionally, rebalance relative to a reference benchmark (e.g., maintain the same sector weights as the S&P 500).

## Why It Seems Valuable

- Rebalancing is standard practice in portfolio management — every robo-advisor and index fund does it.
- It provides a principled rule for "when to add to a winner" and "when to trim a loser."
- Equal-weight rebalancing is one of the simplest, most defensible allocation frameworks.

## Why It Is Not Worth Building

**1. Rebalancing is a concept from passive allocation, not signal-driven trading.**
Index funds and target-date funds rebalance because they have a static target (e.g., 60/40 stocks/bonds, or market-cap-weighted index constituents) and drift from that target is an unintended deviation. xstockstrat has no static target weights — the "right" allocation to any given stock is zero when there is no signal for it and signal-confidence-sized when there is. There is no drift to correct; there is only signal conviction to follow.

**2. Rebalancing creates trades that directly contradict signal logic.**
Consider: AAPL has a strong buy signal, position opened, stock rises 20% and becomes the largest position by value. Rebalancing would trim AAPL because it has "drifted above target weight." But the position is large because the trade is winning — trimming it is an anti-momentum action that partially closes a profitable position driven by a still-valid signal. Conversely, rebalancing would add to a losing position (say MSFT fell 15%) to restore its target weight, despite no new signal supporting the addition. This is the opposite of what a signal-driven strategy should do.

**3. There is no target weight definition that makes sense for this system.**
- Equal-weight requires N positions to be open simultaneously, but positions open and close based on signal timing — the portfolio is almost never at its "target" N. Equal-weighting across 1 or 2 open positions is just "hold equal amounts of whatever you have," which the position sizing engine already approximates.
- Sector-weight benchmarking (vs. S&P 500) imports benchmark risk that is irrelevant to the signal strategy — if the strategy has no signals in tech, underweighting tech vs. the S&P 500 is correct, not a deviation to fix.

**4. The position sizing engine (feature 023) already provides the concentration control rebalancing is meant to achieve.**
The `max_concentration_pct` parameter in feature 023 caps any single position at a maximum fraction of equity. This is the correct, signal-aware mechanism: it prevents outsized positions without forcing trades that contradict signal conviction.

## Conditions Under Which This Should Be Reconsidered

- The platform evolves into a multi-strategy portfolio manager where different strategies have allocated capital buckets and rebalancing within each bucket is meaningful.
- A long-only, hold-indefinitely strategy is added (e.g., a "core holdings" layer separate from the signal-driven layer) where passive drift correction is appropriate.
- Even then: implement as a separate module with explicit "rebalancing mode" that is clearly distinct from the signal-driven execution path.

## Affected Services

_Not applicable — demoted before any design._
