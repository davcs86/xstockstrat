# Context Log: fix-edgar-quarterly-roe

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-06 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-10-06-edgar-quarterly-roe-not-annualized-defect.md`: EDGAR quarterly ROE is a single-quarter ratio, not annualized, while P/E on the same row is TTM
- Severity: SEV-2
- Routed to SDD path (Track C) — environment dev (staging)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services (from report): xstockstrat-marketdata
- Root cause hypothesis: `buildPeriod` (`edgar_client.go:401-406`) divides the period's own net income by equity regardless of period type
- Recommended design depth: quick → `/sdd-design fix-edgar-quarterly-roe quick` (rationale: SEV-2; TTM vs ×4 fallback and the re-derivation of already-stored rows are real design choices)
- `@AC-1` net-income figures for the three earlier quarters are illustrative placeholders — replace with the real AXP XBRL facts during `/sdd-spec` (the Q2-2026 2,885M and equity 30,264M are real staging values).
- **Downstream dependency (operator decision, #2 of the AXP review):** the `fundamentals_macd_blend` exit-rule backtest comparison (control vs AND-gate+VTS stop vs hysteresis+VTS stop) is **deferred until this fix and `223-fix-stored-edgar-periods` land and AXP-class periods are re-backfilled** — `analysis.backtest.fundamentals.enabled=true` on staging, so today's PIT fscore (and the strategy's +0.38 backtest edge) is computed on biased ROE and stale D/E. Candidate exit rule for the hysteresis arm: `OR(AND(macd crosses_below macd.signal, fscore.composite < 0.5), fscore.composite < 0.35, vts crosses_below 0)` with `vts` = Volatility Trailing Stop Direction formula `7f595658-2a7f-4ddb-a83a-5fc3d625472d` {period 22, multiplier 3.0}. No live strategy edit until results are approved.
- Development branch: feature/fix-edgar-quarterly-roe
