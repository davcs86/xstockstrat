# Context Log: fix-portfolio-internal-position

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-17 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-11-17-portfolio-internal-position-reads-truncate-at-500-defect.md` (no GitHub issue — Issues disabled): portfolio internal position reads stop at the first 500 rows
- Source: feature 353 (`fix-listpositions-nextpagetoken-skips`) design § Open Risks follow-up
- Severity: SEV-2
- Routed to SDD path (Track C)
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md
- Affected services (from report): xstockstrat-portfolio
- Root cause hypothesis: The internal readers predate a working cursor (feature 353) and treated one 500-row page as all positions. Repo-level drain vs per-site loop is a design decision; enrichment must stay one batched call per RPC page (`@AC-1 @feature-178`).
- Recommended design depth: quick → `/sdd-design fix-portfolio-internal-position quick` (rationale: SEV-2, single service, no proto/migration/config)
- Development branch: feature/fix-portfolio-internal-position
- Twin: feature 358 `fix-trading-reconcile-reads` (trading `reconcileTick`), split by operator decision 2026-11-17.
- Reuse feature 353's dbtest harness (`seedPosition`, `testPool` exec-mode opts) and cursor codec; ledger insight on same-slot typed binds.
- Must PRESERVE `@AC-1 @feature-178` (`quote-fanout-batching.feature`) and the 353 `@AC-1` pagination guarantee.

## Session 2026-11-17 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings (criteria verdict PASS WITH WARNINGS, no fails, no floor breaches):
  - C-15: AC-1 Thens ("computed over all 501 positions") were not observable per reader. **Resolved** in this session: AC-1 gained an `<observable>` column naming a concrete assertion per reader (GetPortfolio total market value / 501 rows; GetPnL unrealized_pnl; broadcastSnapshot open_positions 501 + equity; checkRiskLimits concentration alert naming the 501st symbol).
  - C-15: AC-5 "30% concentration" had no limit value. **Resolved**: AC-1/AC-5 now pin `risk.concentration_limit_pct` at 0.20 (the code default in `checkRiskLimits`) with the position at 30% of total market value.
  - C-15 (advisory, open): AC-2 covers FR-5 only for GetPortfolio and GetPnL; AC-5 covers broadcastSnapshot and checkRiskLimits together, so a reader whose failure handling differs is not isolated. Design/spec may split AC-5 per reader. Note: `checkRiskLimits` and `broadcastSnapshot` currently `return` silently on a ListPositions error — FR-5's "each logs the failure" is new behavior.
  - Criterion 9 (advisory): one Open Question (repo-level drain vs per-site loop), deferred to `/sdd-design`. Acceptable for a bug spec.
  - C-14 (advisory, open): consumer-surface hook names `usePortfolio` / `traderBff.getPortfolio` were not verified; confirm in recon.
- Overlap findings (WARN, file-level, rebase-only; no config/proto/migration clash):
  - `services/xstockstrat-portfolio/internal/service/portfolio_service.go`: 357's four readers (:787, :932, :1214, :1283) vs `311-fix-position-fold-correctness` (spec-ready) at :260-261 / :419-420; disjoint regions, merge-conflict risk only.
  - Same file vs `312-fix-read-path-owner-trust` (spec-ready) at :435 (`acctID = "alpaca-default"` fallback); disjoint lines, rebase-only; re-check at impl-spec time since 312 touches the same identity path.
  - Consumed seam / merge order: FR-1..FR-4 depend on the `ListPositions` composite cursor from `353-fix-listpositions-nextpagetoken-skips` (code-completed, not launched) at `internal/repository/portfolio_repo.go:162,193-194`. 357 must not merge before 353 is on main-dev.
- Recommended design depth: quick (SEV-2 bug, single service, no proto/DB/config gates, overlap rebase-only).

### OPERATOR DECISIONS (binding, recorded 2026-11-17)

- Operator 2026-11-17: split from feature 358 (trading reconcile); scope is only portfolio's internal readers GetPortfolio, GetPnL, broadcastSnapshot, checkRiskLimits.
- Reuse feature 353's patterns where they fit: dbtest harness in services/xstockstrat-portfolio/internal/repository/dbtest_helpers_test.go (seedPosition, testPool exec-mode opts), the composite cursor codec, and the ledger insight on same-slot typed binds.
- PRESERVE @AC-1 @feature-178 (one batched enrichment per page) and feature 353 @AC-1.
- Do not touch features 351, 353 or 354.
- Red-before-green is mandatory.
