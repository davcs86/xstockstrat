# Product Spec: options-trading-support

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Extend the trading service to submit options orders (single-leg and multi-leg spreads) to IBKR and Alpaca, using the existing signal pipeline to drive directional options positions (e.g., a buy signal on AAPL triggers a long call purchase rather than a stock purchase).

## Why It Seems Valuable

- Options provide defined risk and leverage — a long call risks only the premium while capturing upside.
- Defined-risk structures (credit spreads, iron condors) let the strategy profit from signal conviction without unlimited downside.
- IBKR and Alpaca both support options trading via their APIs.
- The existing signal pipeline already produces directional signals that could theoretically select calls vs. puts.

## Why It Is Not Worth Building

**1. Options require data infrastructure that doesn't exist on this platform.**
Equity trading needs OHLCV bars. Options trading additionally requires: a full options chain per underlying (all strikes × all expiries), real-time bid/ask for every contract (illiquid contracts have wide spreads that dominate P&L), implied volatility per contract, the IV surface for strike/expiry selection, and Greeks (delta, gamma, theta, vega) for position sizing and risk management. None of this is in the marketdata service, the proto types, or the indicators engine. Building it is a separate data infrastructure project.

**2. Options pricing requires a model the platform doesn't have.**
To know whether an option is cheap or expensive, you need a pricing model (Black-Scholes for European, binomial tree for American-style equity options) and a volatility estimate. The platform has no volatility modeling capability. Without it, the system cannot distinguish between buying an option at fair value vs. buying one where the market has already priced in the expected move.

**3. Signals don't contain the information options execution needs.**
A newsletter signal says "buy AAPL." An options position requires: direction (call vs. put — OK, derivable), expiry (which week? month? quarter?), strike (at-the-money? 5% out-of-the-money?), strategy type (long call, bull call spread, cash-secured put?), and max premium budget. None of this can be inferred from a directional equity signal without additional context that the current signal sources don't provide.

**4. IBKR options API semantics are significantly more complex.**
IBKR's TWS API uses a separate `Contract` object for options with fields for strike, expiry, right (call/put), and multiplier. The order submission, margin calculation, assignment handling, and exercise notification paths are all different from equity order paths. Multi-leg spreads require combo order submission. The trading service would need a parallel implementation of nearly every broker integration path.

**5. Options add leverage that amplifies the risk of an unproven strategy.**
The equity strategy has not yet been validated in live trading. Options amplify both wins and losses; applying an unvalidated signal pipeline to leveraged instruments with time decay (theta) and volatility exposure (vega) introduces multiple simultaneous risk factors before the underlying directional strategy is proven.

## Conditions Under Which This Should Be Reconsidered

- The equity strategy has a validated live track record (12+ months, Sharpe > 1.0 net of costs).
- Signal sources have been extended to produce options-specific parameters (expiry, strike, strategy type) — not just direction.
- A volatility surface data feed has been integrated into the marketdata service.
- A separate `options-trading` service is designed from scratch with options-native data types, rather than retrofitting the equity trading service.

## Affected Services

_Not applicable — demoted before any design._
