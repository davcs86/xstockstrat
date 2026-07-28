# <Strategy> backtest — <purpose> (<date>)

**Scope:** <strategy_id(s)>, <N symbols>, <single config | parameter sweep over {…}>, <window>.
**Method credibility:** <exact reproduction of oracle at <baseline>, or note if unverified>.

## 1. TL;DR
- <one-line headline result and recommendation>
- <the single most important number, in context vs a baseline>
- <the main caveat in one line>

## 2. Setup
- **Strategy:** entry `<rule>`; exit `<rule>`; parameter under test `<name> ∈ {…}`.
- **Symbols:** <list; note which are in-sample vs out-of-sample if relevant>.
- **Aggregation:** independent per-symbol (own capital, summed PnL / averaged return) — see
  aggregation.md. State this; it is not the sequential-capital portfolio.

## 3. Verification gate
- Oracle: <source>. Result: <PASS to the digit | list of mismatches>.
- Indicator checkpoints matched: <e.g. BX 2024-12-17 z=-1.489…, er=0.142…>.
- Benign drift noted: <e.g. one boundary trade shifted by the rolling-window advance, if any>.

## 4. Results — per symbol
| Symbol | Trades | Return % | PnL | (vs oracle / vs baseline) |
|---|---:|---:|---:|---|
| … | | | | |

## 5. Results — basket
| Config | Trades | Sum PnL | Avg return % |
|---|---:|---:|---:|
| … | | | |

## 6. Read
- <what the numbers mean; where the ranking is robust vs fragile>
- <per-symbol scatter, if any — "each symbol wants a different <param>">

## 7. Recommendation
- <do / don't ship; which config; fixed value vs a conditional rule>

## 8. Caveats
- Single period vs out-of-sample: <state which>.
- Independent aggregation ignores portfolio capital contention / correlation.
- Any strategy mutation made during the run was restored to <original>.
