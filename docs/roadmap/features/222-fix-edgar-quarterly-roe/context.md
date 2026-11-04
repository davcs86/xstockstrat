# Context: fix-edgar-quarterly-roe  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: EDGAR quarterly rows stored a single-quarter ROE (~¼ of annual) while P/E on the same row was already TTM. The fix puts quarterly `roe` on a TTM-net-income basis with an annualize-what's-available fallback. It did not heal already-stored rows (pinned to earliest filing); healing needed 223's `derivation_version` plus one re-backfill, hence merge order 222 then 223. The bias was not cosmetic: it moved AXP `fscore.composite` from ~0.589 to ~0.461, below the `fundamentals_macd_blend` entry gate (> 0.5), biasing live scoring and PIT backtests.
**Why (irrecoverable rationale)**: Operator decided both forks via AskUserQuestion 2026-10-06. Fallback is Σ × 4/n. Stored-row repair is delegated to 223's `derivation_version` + conditional upsert because one mechanism heals both defects with one re-backfill instead of two passes. Flow facts are keyed by their own start/end, not the filing's fy/fp, because a 10-Q's prior-year comparative column shares the filing's fy/fp and keying on it can silently pick the comparative.
**Rejected alternatives**:
- Multiply the single quarter by 4 — ignores available earlier quarters, adds seasonal bias.
- Return nil ROE when fewer than 4 quarters exist — early-history rows lose ROE and fscore treats them as missing.
- Retuning the fundamentals formula's `roe_good`/`roe_bad` params (or sector-specific thresholds, handled by feature 217 `@AC-14`) — out of scope by deliberate choice: the defect was the ROE basis, so do not "fix" AXP's low score by moving thresholds. No further reason was written down.
- Average equity as denominator — neither the acceptance criteria nor vendor `returnOnEquityTTM` use it; period-end equity keeps vendor parity.
**Scars & gotchas**:
- The three earlier-quarter AXP net-income figures in `@AC-1` (2,500 / 2,600 / 2,700M) are illustrative placeholders, not XBRL facts; no sec.gov egress was available and the triage instruction to replace them during /sdd-spec was never carried out. Only Q2-2026 NI 2,885M and equity 30,264M are real staging values. `@AC-1` / `ttm_roe_test.go` is a synthetic check, not real-data.
- Shipping the code did not change stored values until 223's re-derivation ran (earliest-filing idempotency pin); now binding as MARKETDATA-13.
**Permanent deviations**: Borderline — shipped code adds a last-resort fallback when `trailingNetIncome` finds zero quarter facts: it uses the row's own `net_income` as n=1, i.e. single-quarter ×4 (`services/xstockstrat-marketdata/internal/edgar/edgar_client.go:453-459`). That is the "×4 of the single quarter" option design rejected, kept only as last resort; no rationale was written.
**Cross-feature signal**: 222 and 223 are a matched pair — a derivation-semantics fix in `buildPeriod`/`annualizeQuarterlyROE` is incomplete until stored rows are re-derived (produced MARKETDATA-13 and the `DerivationVersion` golden-hash guard). Found during an AXP strategy review: with `analysis.backtest.fundamentals.enabled=true` on staging, the `fundamentals_macd_blend` +0.38 backtest edge was computed on biased ROE and stale D/E, so strategy-evaluation results predating the 222+223 re-backfill are suspect.
**Deferred follow-ons**:
- `fundamentals_macd_blend` exit-rule backtest comparison, deferred until 222+223 land and AXP-class periods are re-backfilled. Three arms: control; AND-gate + VTS stop; hysteresis + VTS stop. Candidate hysteresis exit rule: `OR(AND(macd crosses_below macd.signal, fscore.composite < 0.5), fscore.composite < 0.35, vts crosses_below 0)`. `vts` = Volatility Trailing Stop Direction formula `7f595658-2a7f-4ddb-a83a-5fc3d625472d` {period 22, multiplier 3.0}. Operator constraint: no live strategy edit until results are approved. This plan existed only in the pruned context log.
- Replace the illustrative `@AC-1` NI figures with real AXP XBRL facts once sec.gov egress is available.
**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-11-04 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: Candidate MARKETDATA-15: "EDGAR flow facts are keyed by the fact's own period; never by the filing fy/fp (comparative columns share it)" — currently only a code comment and service CLAUDE.md prose. MARKETDATA-13 already covers the stored-row lesson.
**Pruned artifacts**: product-spec.md, design.md, implementation-spec.md — last present at 1ed63958.
