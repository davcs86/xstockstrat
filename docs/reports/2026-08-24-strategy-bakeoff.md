# Strategy Bakeoff — Sharpe & Return Leaderboard (2026-08-24)

**Author:** Claude Code session (feature 152 follow-on validation)
**Scope:** Empirical comparison of all 15 registered strategies on staging, ranked by Sharpe and by return.

---

## Methodology

- **Universe (29 symbols):** AAPL, AI, AMAT, AMD, AXP, BX, CCI, CMG, GOOG, JPM, KKR, LMT, LRCX,
  LULU, LYFT, MARA, MSFT, MSTR, NKE, NVDA, NVO, SBUX, SMCI, SPG, TSLA, UBER, UNH, XLE, XRT
  (the "Schwab" watchlist).
- **Engine:** `run_backtest` on `xstockstrat-analysis` (staging), `sizing_mode=portfolio`,
  `fill_model=next_bar_open`, `initial_capital=100000`.
- **Windows (4 × ~1 year):**
  - `Wbear` 2022-06-01 → 2023-05-31 (contains the 2022 bear; VOO 200-day slope negative ~82% of bars)
  - `W1` 2023-08-01 → 2024-08-01
  - `W2` 2024-08-01 → 2025-08-01
  - `W3` 2025-08-01 → 2026-08-01
- **Data:** staging Alpaca daily bars; 2020-06→2023-06 backfilled for this study (jobs
  `32af596e`, `160c6b0c`).

**Caveats — treat as directional, not definitive:**
- Only 4 one-year windows on a single 29-name universe.
- Each backtest is an **independent** `$100k` run; the `compounded` column chains the four annual
  results post-hoc, and there is a ~3-month gap between `Wbear` end (2023-05-31) and `W1` start
  (2023-08-01) — so it is a rough multi-year proxy, not one continuous equity curve.
- `fundamentals_macd_blend` and `golden_cross_conviction` carry `signal_params`, but the signal blend
  (`scoring.combined_score` / `buy_threshold`) is **inert in both backtest and live entry decisions** —
  the evaluator's `signals_map` is reserved/unused on both paths (feature 097 made scoring
  technical-only), and the blend now survives only in the screener (`ScreenSymbols`). So these two run
  here — and fire live — as a plain MACD-crossover and a plain SMA golden-cross respectively. The real
  backtest↔live divergence is not signals but the **firing universe**: a backtest evaluates exactly the
  symbols passed to `run_backtest`, whereas live evaluates `resolve_universe`
  (`allowlist ∪ watchlist ∪ held ∪ signal-eligible`, minus denied), so a strategy that is neither
  watchlist-bound nor signal-eligible only re-checks names already held.

---

## Table 1 — Sharpe (ranked by mean Sharpe)

`mean` = average of the 4 windows' Sharpe; `worst` = min window Sharpe; `+w` = # windows with a
positive Sharpe.

| # | strategy | mean | worst | Wbear | W1 | W2 | W3 | +w |
|--:|---|--:|--:|--:|--:|--:|--:|:--:|
| 1 | fundamentals_macd_blend | **1.22** | −0.31 | 2.07 | 1.74 | −0.31 | 1.37 | 3/4 |
| 2 | dip_buyer_vol_stop_m35 | 1.09 | −0.98 | 2.71 | 1.79 | −0.98 | 0.82 | 3/4 |
| 3 | dip_buyer_vol_stop | 1.08 | −0.80 | 2.33 | 1.80 | −0.80 | 0.98 | 3/4 |
| 4 | dip_buyer_vol_stop_m25 | 1.05 | −1.16 | 2.70 | 1.85 | −1.16 | 0.82 | 3/4 |
| 5 | dip_buyer_regime_filtered | 1.00 | −1.19 | 2.33 | 1.84 | −1.19 | 1.00 | 3/4 |
| 6 | squeeze_breakout_trend | 0.67 | −0.16 | 0.88 | 1.17 | −0.16 | 0.78 | 3/4 |
| 7 | squeeze_mq_confirmed | 0.66 | −0.44 | 1.88 | 1.22 | −0.44 | −0.04 | 2/4 |
| 8 | golden_cross_conviction | 0.45 | −0.24 | −0.24 | 1.24 | 0.37 | 0.42 | 3/4 |
| 9 | quality_dip_buyer | 0.41 | −0.46 | 0.82 | 1.40 | −0.46 | −0.12 | 2/4 |
| 10 | squeeze_macd_mq | 0.34 | **+0.25** | 0.25 | 0.50 | 0.32 | 0.29 | **4/4** |
| 11 | range_mean_reversion | 0.18 | −0.63 | 0.28 | 1.50 | −0.63 | −0.45 | 2/4 |
| 12 | clenow_momentum_regime | −0.00 | −1.46 | 1.35 | 0.78 | −0.68 | −1.46 | 2/4 |
| 13 | range_mean_reversion_v2 | −0.01 | −1.02 | 0.19 | 0.13 | 0.68 | −1.02 | 3/4 |
| 14 | range_mean_reversion_v3 | −0.16 | −0.46 | −0.46 | −0.07 | 0.31 | −0.42 | 1/4 |
| 15 | zscore_trend_filtered | −0.18 | −1.64 | −0.60 | 1.54 | −1.64 | 0.00 | 1/4 |

---

## Table 2 — Return % (ranked by compounded)

| # | strategy | Wbear | W1 | W2 | W3 | compounded |
|--:|---|--:|--:|--:|--:|--:|
| 1 | fundamentals_macd_blend | +54.99 | +33.97 | −7.73 | +20.09 | **+130%** |
| 2 | dip_buyer_vol_stop_m35 | +38.29 | +33.85 | −15.41 | +10.43 | +73% |
| 3 | dip_buyer_vol_stop | +30.34 | +33.49 | −12.03 | +10.52 | +69% |
| 4 | dip_buyer_vol_stop_m25 | +34.72 | +32.04 | −15.60 | +8.01 | +62% |
| 5 | dip_buyer_regime_filtered | +29.15 | +31.41 | −15.65 | +9.79 | +57% |
| 6 | squeeze_breakout_trend | +15.42 | +11.37 | −2.66 | +8.74 | +36% |
| 7 | squeeze_mq_confirmed | +25.22 | +13.56 | −5.29 | −0.47 | +34% |
| 8 | golden_cross_conviction | −6.79 | +15.32 | +5.42 | +6.91 | +21% |
| 9 | quality_dip_buyer | +6.91 | +22.54 | −7.95 | −2.52 | +17% |
| 10 | squeeze_macd_mq | +1.89 | +3.53 | +1.60 | +1.66 | +9% |
| 11 | clenow_momentum_regime | +20.52 | +12.26 | −7.43 | −13.00 | +9% |
| 12 | range_mean_reversion | +0.54 | +5.91 | −0.92 | −0.67 | +5% |
| 13 | zscore_trend_filtered | −0.72 | +6.03 | −1.66 | 0.00 | +3% |
| 14 | range_mean_reversion_v2 | +1.78 | +0.82 | +10.31 | −16.94 | −6% |
| 15 | range_mean_reversion_v3 | −6.77 | −0.77 | +2.64 | −5.64 | −10% |

---

## Table 3 — Max drawdown % (per window)

| strategy | Wbear | W1 | W2 | W3 |
|---|--:|--:|--:|--:|
| fundamentals_macd_blend | 16.35 | 10.71 | 24.05 | 8.38 |
| dip_buyer_vol_stop_m35 | 3.78 | 8.50 | 19.46 | 12.19 |
| dip_buyer_vol_stop | 2.91 | 8.16 | 17.77 | 9.75 |
| dip_buyer_vol_stop_m25 | 2.48 | 7.81 | 19.70 | 7.31 |
| dip_buyer_regime_filtered | 5.51 | 7.94 | 18.42 | 7.20 |
| squeeze_breakout_trend | 10.06 | 4.90 | 11.35 | 8.75 |
| squeeze_mq_confirmed | 8.24 | 6.29 | 13.47 | 5.03 |
| golden_cross_conviction | 22.66 | 6.50 | 19.90 | 16.25 |
| quality_dip_buyer | 3.80 | 8.83 | 18.79 | 16.14 |
| squeeze_macd_mq | 7.70 | 5.14 | 4.00 | 5.57 |
| range_mean_reversion | 1.36 | 0.73 | 2.20 | 1.65 |
| clenow_momentum_regime | 14.03 | 17.70 | 9.99 | 13.95 |
| range_mean_reversion_v2 | 17.15 | 5.85 | 11.83 | 27.93 |
| range_mean_reversion_v3 | 20.83 | 7.39 | 14.19 | 13.30 |
| zscore_trend_filtered | 0.99 | 0.73 | 2.20 | 0.00 |

---

## Findings

- **Highest returns/Sharpe: `fundamentals_macd_blend`** (mean Sharpe 1.22, compounded +130%) — but the
  ugliest drawdowns (16% Wbear, 24% W2) and heavy turnover (90–126 trades/window). Return-per-unit-risk
  is not proportionally ahead of the dip-buyers.
- **Best clean cluster: the dip-buyer vol-stop family** (`_m35`/`_m3.0`/`_m25`, mean Sharpe ≈1.05–1.09,
  compounded +62–73%) — strong up years (+30–38%) with far smaller drawdowns than the leader. The
  vol-stop multiplier barely matters. All share the same weakness: a −12 to −16% **W2 (2024-25)** year.
- **Steadiest: `squeeze_macd_mq`** — the only strategy positive in **all four** windows (worst Sharpe
  +0.25), but low magnitude (+9% total). The pick if never having a losing year matters most.
- **Bottom third:** the mean-reversion `z × efficiency` family (`range_mean_reversion*`,
  `zscore_trend_filtered`, `clenow_momentum_regime`) — near-zero-to-negative mean Sharpe; either too
  sparse (`zscore` fires 0–4 trades/window) or churn-heavy with poor risk-adjusted results.

### Feature-152 (VOO market-regime gate) validation

The benchmark/reference-symbol operand (feature 152) is **wired and correct** on staging — a
`source_symbol="VOO"` component resolves to real VOO 200-day-slope values and the AC-4 coverage-gap
path fires precisely. But the motivating hypothesis (a VOO-200d-rising gate fixes the dip-buyer's bad
year) is **not supported by the data**:

- **2024-25 (W2):** VOO's 200-day slope stayed **positive** the whole window, so `mkt > 0` never
  blocked an entry — the gated variant `dip_buyer_market_regime_voo` was byte-identical to the ungated
  `dip_buyer_vol_stop_m25`. The −15.6% loss was **idiosyncratic single-name blowups** (MSTR −$2.8k, KKR
  −$2.4k, NVO, GOOG, LULU, MARA, SMCI ≈ the entire net loss), not a broad-market decline.
- **2022 bear (Wbear):** VOO's 200-day slope was negative ~82% of the window, so the gate **did** fire
  (blocked 40 → 17 trades). But it **hurt**: baseline `dip_buyer_vol_stop_m25` +34.7% (Sharpe 2.70) vs
  gated `dip_buyer_market_regime_voo` +22.7% (Sharpe 2.04). The dip-buyer already gates on **per-symbol**
  trend (`px > sma200`) + a vol-stop, so it was buying names still in their own uptrends and making
  money; a broad-market VOO gate just removed good entries.

**Conclusion:** a VOO-200d market-regime gate is **redundant-to-harmful** on a strategy already gated on
per-symbol trend. Feature 152 works; this particular gate does not improve this strategy.

---

## Live-strategy decision (operator, 2026-08-24)

- **Kept live:** `fundamentals_macd_blend`, `dip_buyer_vol_stop`, `squeeze_breakout_trend`.
- **Deactivated:** all other registered strategies (including the feature-152 experiment
  `dip_buyer_market_regime_voo` and the debug `dbg_regime_voo_inverted`).

### Live-universe wiring (operator, 2026-08-24)

To make the kept-live strategies actually evaluate live (rather than re-checking only held names —
see the firing-universe note in Methodology):

- **Schwab watchlist** re-bound: all 29 symbols now bind to `dip_buyer_vol_stop` (previously
  `range_mean_reversion`/`_v3`). Watchlist membership feeds `resolve_universe` for every one of the
  owner's live strategies (the live loop unions binding *symbols* regardless of the binding's
  `strategy_id`), so this also puts the 29 names into `squeeze_breakout_trend`'s and
  `fundamentals_macd_blend`'s universes.
- **`fundamentals_macd_blend`** set `signal_eligible=true`, so the platform-wide active-signal term
  additionally joins its universe (`resolve_universe` = `watchlist ∪ held ∪ signals`). Its
  `signal_params` carry no `symbols` allowlist, so this passes the allowlist×eligibility guard.
