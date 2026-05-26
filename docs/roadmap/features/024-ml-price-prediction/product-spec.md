# Product Spec: ml-price-prediction

**Created**: 2026-05-26
**Status**: `demoted/canceled`

---

## Idea

Train a machine learning model (LSTM, transformer, or gradient boosting) on historical OHLCV price and volume data to predict short-term price direction or magnitude, then pipe those predictions into the analysis service as a synthetic signal source.

## Why It Seems Valuable

- "AI-powered" predictions sound like a natural upgrade to the formula engine.
- The indicators service is already sandboxed Python — plugging in a model appears additive.
- Backtests of simple ML models on historical data often show positive returns.

## Why It Is Not Worth Building

**1. Price-only ML has no demonstrable edge after costs.**
Hundreds of published studies (including from Renaissance, AQR, and academic finance) show that models trained purely on OHLCV data perform at or below chance once transaction costs, slippage, and bid-ask spread are accounted for. The apparent backtest performance is an artifact of overfitting to noise. This is not a tooling problem that better hyperparameters can solve — it is a structural absence of signal in the input features.

**2. The platform already uses the best available text intelligence.**
The agent MCP server passes newsletter text and email signals through Claude (claude-sonnet-4-6), which has far more context about market narrative than any OHLCV model can derive. Adding a price-prediction model is redundant with the existing signal pipeline and inferior on the text dimension.

**3. Backtesting gives false confidence.**
An LSTM that "predicts" tomorrow's return by implicitly learning the average upward drift of equities will look good in backtests and fail in live trading when regime changes occur. Detecting overfitting in sequential financial models requires walk-forward validation across many years and market regimes — a significant research project, not a feature.

**4. Operational cost is high.**
Continuous retraining cadence (weekly or daily), model versioning, inference latency budget, feature pipeline for OHLCV normalization, GPU or CPU inference infrastructure, and model monitoring for concept drift all become ongoing platform obligations with no clear ROI.

**5. Outputs are opaque and hard to debug.**
When the model drives a bad trade, there is no interpretable explanation. The existing signal pipeline (newsletter → extraction → source weight → decay → score) is fully auditable. Replacing or supplementing it with a black box removes the ability to diagnose failures.

## Conditions Under Which This Should Be Reconsidered

- The platform has access to genuine alternative data with ML-exploitable structure: order flow imbalance, satellite imagery, earnings call sentiment at scale, or limit order book depth.
- A dedicated research track (separate from the trading platform) validates a specific model architecture on live paper trading for 6+ months with walk-forward validation showing Sharpe > 1.0 net of costs.
- Even then: add ML predictions as one signal source with a weight in the source registry — do not replace the existing scoring architecture.

## Affected Services

_Not applicable — demoted before any design._
