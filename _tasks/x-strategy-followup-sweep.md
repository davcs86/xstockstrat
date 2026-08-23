# Strategy follow-up sweep — results & report (Part B)

**Namespace:** `xstockstrat staging`. **Frozen window (verbatim):** `start=2025-08-01`, `end=2026-08-01`,
`initial_capital=100000`, 33 symbols
`[AAPL,AI,AMAT,AMD,AXP,BX,CCI,CMG,GOOG,JPM,KKR,LMT,LRCX,LULU,LYFT,MARA,MSFT,MSTR,NKE,NVDA,NVO,SBUX,SMCI,SPG,TSLA,UBER,UNH,XLE,XRT,LLY,WSM,VOO,VTI]`.

> **Part A caveat governs every return figure below.** The aggregate `total_return` reported by the
> engine is a **33-leg serial parlay** — `RunBacktest` threads one running equity through the symbols
> in order and reinvests the whole balance into each next symbol
> (`services/xstockstrat-analysis/app/handlers/servicer.py:525-529,571,3630`), so `total_return = Π(1+rᵢ)−1`,
> not a portfolio return. `annualized_return` is additionally ~30× under-scaled (it divides by the
> concatenated multi-symbol curve length, not the window). **Rank on profit-factor and max-drawdown
> deltas only** until the sizing model is confirmed/redesigned. See `_tasks/x-backtest-metrics-audit.md`.

All three new strategies registered with `operation='register'`, `cooldown_days` omitted (platform
default 31), verified `warnings: []` with clean-JSON rule round-trips, and were backtested one run each
on the frozen window (one approval per run; each run mutates only its own feature-065 derived grade).

---

## Registered strategies (this session)

| strategy_id | components | entry_rule | exit_rule |
|---|---|---|---|
| `dip_buyer_vol_stop_m25` | rsi RSI{14}, px SMA{1}, sma200 SMA{200}, vts VTS{period:22, **mult:2.5**} | `rsi<35 AND px>sma200` | `vts crosses_below 0` |
| `dip_buyer_vol_stop_m35` | rsi RSI{14}, px SMA{1}, sma200 SMA{200}, vts VTS{period:22, **mult:3.5**} | `rsi<35 AND px>sma200` | `vts crosses_below 0` |
| `squeeze_macd_mq` | sqz SqzPctile{20,120}, macd MACD{12,26,9} (builtin, copied verbatim from `squeeze_breakout_trend`), mq ClenowMQ{90}, vts VTS{22,3.0} | `sqz crosses_above 0.25 AND macd.histogram>0 AND mq>0` | `vts crosses_below 0` |

`squeeze_macd_mq` is a strict **superset** of the `squeeze_breakout_trend` control: identical `sqz`,
identical `macd` builtin + `macd.histogram` accessor, identical `vts` exit — plus one added `mq>0` leg.

---

## Banked factorial rows (append these)

`annualized_return` column omitted deliberately — it is the broken field (Part A Q3). Metrics are the
engine's raw output; interpret returns per the caveat.

```
strategy_id                total_return  sharpe   max_drawdown  win_rate  total_trades  profit_factor  entry_fired
dip_buyer_vol_stop_m25       +1.3634     0.2600     0.6647       0.5556        72           1.4921        29/33
dip_buyer_vol_stop_m35       +2.0761     0.2923     0.7468       0.6119        67           1.5528        29/33
squeeze_macd_mq              +0.0752     0.0689     0.3797       0.3725        51           1.0492        27/33
```

backtest_ids: m25 `0fa7e495-def7-429f-b2c5-38120d5bab99`; m35 and squeeze_macd_mq run in the same
session (full per-bar diagnostics saved to the run-result attachments).

---

## B5.1 — Multiplier robustness curve for `dip_buyer_vol_stop` (curve-fit check)

| vts multiplier | total_return* | profit_factor | max_drawdown | win_rate | trades | entry-fired |
|---|---|---|---|---|---|---|
| **2.5** (`_m25`) | +136.3% | **1.492** | 66.5% | 55.6% | 72 | 29/33 |
| **3.0** (`dip_buyer_vol_stop`, banked) | +193% | **1.67** | — † | — | — | — |
| **3.5** (`_m35`) | +207.6% | **1.553** | 74.7% | 61.2% | 67 | 29/33 |

\* parlay return — compare **shape**, not magnitude. † banked m3.0 DD/win/trades not on hand; per the
task scope only the two new multipliers were run (m3.0 was not re-run — that would fire a 4th
grade-mutating approval for no new information).

**Read — the edge is directionally robust, but m3.0 is a local PF peak, so trust the band not the
headline.**
- **Profit factor** across the swept band: 1.492 → **1.67** → 1.553. That is a **moderate
  inverted-U with the peak at the banked 3.0**, not a flat plateau and not a razor spike. PF stays
  **≥ 1.49 across the entire 2.5–3.5 range**, so the strategy's edge is *not* a single-point artifact —
  it survives a ±0.5 perturbation of the stop multiple with PF still ~1.5. But because 3.0 is a local
  maximum (~8–12% above the wings), the banked **1.67 headline is a mild best-case**; the honest,
  robustness-adjusted PF for this family is **~1.5**.
- **Max drawdown** rises monotonically with the multiplier (66.5% → 74.7%), exactly as the mechanism
  predicts: a wider Chandelier stop tolerates deeper adverse excursions before flipping `vts` below 0.
  This is expected sensitivity, **not** curve-fit.
- **Return** rises monotonically with the multiplier (parlay). Also mechanical (wider stop → fewer
  whipsaw exits → more upside retained, at the cost of DD), and — being a parlay — not a magnitude to
  bank on.

**Verdict:** treat `dip_buyer_vol_stop` as **robust in edge, sensitive in tuning**. Don't quote 1.67;
quote "PF ≈1.5 across mult 2.5–3.5, DD 66–75% rising with the multiplier." Flag the 3.0 PF peak so it
isn't over-fit in any future promotion. All three multipliers carry a **very high absolute DD (66–75%)**
regardless — a real risk-management concern independent of the parlay caveat.

## B5.2 — Triple-leg `squeeze_macd_mq`: MQ as an *additional* filter vs. as a *substitution*

| strategy | entry legs | total_return* | profit_factor | max_drawdown | win_rate | trades | fired |
|---|---|---|---|---|---|---|---|
| `squeeze_breakout_trend` (control, banked) | sqz + macd | +21% | 1.04 | 71% | — | — | — |
| `squeeze_mq_confirmed` (substitution, banked) | sqz + mq | **−20%** | **0.78** | 45% | — | — | — |
| `squeeze_macd_mq` (additional, **new**) | sqz + macd + mq | +7.5% | **1.049** | **38.0%** | 37.3% | 51 | 27/33 |

\* parlay return; rank on PF + DD.

**The question posed:** does MQ-as-additional-leg cut drawdown (the substitution took 71%→45%)
*without* surrendering profitability (which the substitution lost, +21%→−20%)? **Answer: yes, decisively.**

- **Drawdown:** 71% (control) → **38.0%** (additional). MQ-as-additional cut DD even **further than the
  substitution did** (45%) — a ~46% relative reduction versus the control.
- **Profit factor:** **1.049**, essentially at the control's 1.04 and far above the substitution's 0.78.
  The added `mq>0` leg gates out the entries that were dragging the profit factor down (trades fell to
  51 across 27 symbols) while preserving the profitable core the MACD leg supplies.
- **Profitability preserved:** stayed **positive** (+7.5% parlay) where the substitution flipped
  negative (−20%). On the trustworthy PF axis it holds the line at ~1.05.

**Verdict:** the additional-leg formulation is the **correct way to use MQ here** — it delivers the
drawdown reduction the substitution achieved *and then some*, without the profitability collapse the
substitution suffered. On the PF + max-DD ranking axis (the only one trustworthy pre-Part-A-fix),
`squeeze_macd_mq` **strictly dominates `squeeze_mq_confirmed`** and roughly halves the control's
drawdown at parity profit factor.

**Caveats:** PF 1.049 is only marginally above break-even and win rate is low (37.3%, typical of a
breakout-with-trailing-stop that lives on a few large winners); the edge is real but **thin**. The DD
improvement is the headline result, not the return. Worth a wider window / more symbols before any
live promotion.

---

## Bottom line

- **Multiplier sweep:** edge is robust in *direction* (PF ~1.5 across 2.5–3.5) but the banked 3.0/1.67
  is a local peak — bank the band, not the headline; DD is uniformly high (66–75%).
- **Triple-leg:** MQ as an *additional* leg is the winning formulation — DD 71%→38% at PF parity with
  the control and no loss of profitability, unlike the MQ *substitution* which went to PF 0.78 / −20%.
- **Every return figure is a serial-parlay artifact** (Part A). Do not act on absolute return
  magnitudes; decisions above rest on PF and max-drawdown deltas only.
