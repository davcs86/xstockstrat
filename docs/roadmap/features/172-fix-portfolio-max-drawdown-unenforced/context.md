# Context Log: fix-portfolio-max-drawdown-unenforced

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-04 (/sdd-triage --from-report)

- Bug surfaced via `docs/reports/2026-09-04-comment-audit-triage.md` item 2 (comment-audit pass).
  No GitHub issue — Issues disabled on this repo; the dated report is the routable artifact.
- Severity: SEV-3.
- Routed to SDD path (Track C).
- Created: feature.md, product-spec.md, acceptance.feature (regression scenario), context.md, status.md.
- Affected services: `xstockstrat-portfolio` (`internal/service/portfolio_service.go`).
- Triage verification: **confirmed** at `portfolio_service.go:722` (`GetFloat(
  "portfolio.risk.max_drawdown_pct", 0.10)`) and `:750` (`_ = maxDrawdownPct // drawdown requires
  historical P&L tracking — handled by snapshots over time`). Re-confirms the existing
  `services/xstockstrat-portfolio/docs/context-constitution-findings.md` (Dead/orphaned code) entry
  and the "Read but not yet enforced" note in the portfolio `CLAUDE.md` Config Keys table.
- Root cause hypothesis: drawdown tracking was never built; the read + `_ =` suppressor were left as a
  placeholder. Same class as `trading.risk.daily_loss_limit`.
- Recommended design depth: **quick** → `/sdd-design fix-portfolio-max-drawdown-unenforced quick`.
  Rationale: SEV-3, single service, would be a `skip` — EXCEPT there is a real scope fork with very
  different blast radius (Path A "implement drawdown halt" needs historical P&L state + possibly a DB
  migration + notify wiring, i.e. a real feature; Path B "document honestly" is doc-only). One
  adversarial round decides implement-vs-document before spec, avoiding rework. If Path A is chosen and
  a migration/second service enters scope, re-run design at `full` depth.
- Development branch: `feature/fix-portfolio-max-drawdown-unenforced`.

---

## Session 2026-09-04 — sdd-review product-spec

- Product spec approved (PASS WITH WARNINGS). Status: draft → spec-ready.
- Added FR-1 (end the read-then-discard via Path A enforce OR Path B document) + path-dependent
  `## Consumer Surface(s)`; tagged @AC-1 @FR-1 (path A) / @AC-2 @FR-1 (path B).
- All code claims verified: portfolio_service.go:722 (GetFloat) / :750 (`_ = maxDrawdownPct`);
  trading.risk.daily_loss_limit is a real documented-not-implemented sibling.
- Warnings (advisory, carry to design): (a) criterion-9 — the Path A/B fork MUST be collapsed and
  recorded in context.md at /sdd-design; (b) @AC-2's code-state `Then` is slightly implementation-
  flavored (acceptable for a Path-B doc fix). NOTE for /sdd-spec: if Path A, state migration NNN
  (next free portfolio migration is 016) per C-07; refresh the stale findings-doc line numbers
  (findings cites :769/:797; actual :722/:750).
- Overlap: CLEAN (portfolio migration tip 015 → next 016, no contention; 175 touches a different
  portfolio file). Design depth: quick (SEV-3, one Path A/B decision + blast-radius).

---

## Session 2026-09-04 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-portfolio; notify reused not modified).
- Phase 1 Grilling: **3 rounds**, approved, no Floor breach.
  - R1: proposer recommended Path A citing recon's "cheap" premise (snapshots.equity). Adversary
    DISPROVED it — `snapshots.equity` is cashless position value (`portfolio_service.go:706` cash=0),
    so drawdown on it fires false alerts when a user de-risks to cash. Correct basis = broker
    `account_balances.equity`.
  - **User decision (R1 gate): Path A done correctly (re-scope).**
  - R2: corrected Path A — peak_equity HWM column (migration 016) + GREATEST at balance-sync +
    GetAccountDrawdowns query + evalDrawdown. Adversary: NEEDS WORK — (a) @AC-1 vacuous-green (evalDrawdown→bool
    never reaches emit) → extract `evaluateDrawdowns(rows,limit) []string` seam; (b) per-account vs
    portfolio-wide is a real fork (concentration sibling is portfolio-wide); (c) trading_mode string
    confirmable NOW (`trading.go:2119-2122` = mode.String(), matches — not a silent-no-op); (d) cash-flow
    contamination to document.
  - **User decision (R2 gate): per-account grain.** @AC reworded to per-account.
  - R3: cash-flow question — grep proves the platform models NO deposits/withdrawals (zero code hits);
    account_balances.equity is broker-synced verbatim; last_equity is prior-day close, not a cash delta.
    Nothing to net against. Cheap heuristics are net-negative (a masking heuristic in a risk alert is worse
    than the false positive). **Accept + document + named follow-up 'model funding events'**; scope @AC to
    trading-loss drawdown.
  - **User decision (R3 gate): approve.**
- Chosen approach: per-account drawdown over broker-authoritative `account_balances.equity` + persisted
  `peak_equity` HWM (migration 016, GREATEST at the existing balance-sync upsert, no Go signature change)
  + `GetAccountDrawdowns` query + pure `evaluateDrawdowns` seam (honest @AC-1 RED) + reuse `emitRiskAlert`
  (WARNING/"risk", honors notify PRESERVE gates). pgxmock query test + evaluateDrawdowns unit test.
- Migration 016 backfill: `SET peak_equity = equity` (no last_equity ref); `peak_equity` type must equal
  the `equity` column type (pin at /sdd-spec). trading_mode literal pinned to `trading.go:2119-2122`;
  pgxmock WithArgs binds it; cross-service string contract → portfolio findings log.
- Constitution: C-07 (016 + down), F-01 (new migration), C-08/P-06/C-15 (evaluateDrawdowns seam + pgxmock,
  no vacuous-green), C-16 (notify gates preserved; net-new portfolio @AC), C-14 (notify consumer surface),
  C-01 (trading_mode pinned). No Floor breach.
- Status: spec-ready → design-approved.
- Open Threads (→ /sdd-spec / execute): peak_equity column type; cash-flow contamination (accepted) +
  named follow-up; trading_mode cross-service string contract; migration DBA+owner approval at PR;
  findings-doc line-number refresh (cites :769/:797; actual :722/:750) at execute (teardown).

---

## Session 2026-09-04 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status → implementation-ready.
- Key codebase findings (all path:line verified this session):
  - `account_balances.equity` is **DOUBLE PRECISION** (`migrations/004_account_balances.up.sql:11`),
    so migration 016's `peak_equity` is `DOUBLE PRECISION` (resolves the design open-risk column-type pin).
  - Last portfolio migration is `015_watchlist_default_strategy` → next free is **016** (confirmed).
  - **New discovery affecting the plan:** the `queryRower` mockable interface (`portfolio_repo.go:19-21`)
    declares **only `QueryRow`**. Multi-row reads (`ListPositions`, `ListAccountBalancesByUser`) use
    `r.pool.Query` and the write `UpsertAccountBalance:380` uses `r.pool.Exec` — none pgxmock-testable.
    To honor the design's C-08 pgxmock mandate for the new multi-row `GetAccountDrawdowns` and the
    `GREATEST` upsert, Step 2 widens `queryRower` with `Query` + `Exec` (both satisfied by
    `*pgxpool.Pool` and pgxmock/v4 v4.9.0) and switches `UpsertAccountBalance` to `r.db.Exec`.
  - `checkRiskLimits` at `portfolio_service.go:721-751` (read `:722`, discard `:750`), caller `:305`;
    `emitRiskAlert:753-767` (WARNING/"risk" + ledger `portfolio.risk.drawdown_breach`) reused verbatim.
  - `trading_mode` literal pinned: `trading.go:2119-2121` writes `"TRADING_MODE_PAPER"`/`"TRADING_MODE_LIVE"`
    == `commonv1.TradingMode.String()`; `checkRiskLimits` passes `mode.String()` for the `$2` filter — matches.
  - Findings-doc stale line refresh (teardown, Step 6): `context-constitution-findings.md:20` cites
    `:769`/`:797`; actual `:722`/`:750` — corrected + marked resolved in the docs step.
- Scenario coverage (C-15): @AC-1 → Step 5 (evaluateDrawdowns seam) + Step 3 (GetAccountDrawdowns fetch);
  @AC-2 → Step 3 (UpsertAccountBalance GREATEST SQL-contract). Consumer surface (C-14): existing notify
  path only, no new UI/Agent step (restated in Execution Summary).
- Note: all new Go code lands in coverage-excluded packages (`internal/repository/`, `internal/service/`);
  no threshold moves, paired RED-before-green tests still required and specced.

---

## Session 2026-09-04T18:52:00Z — sdd-review impl-spec (advisory)

- Result: **PASS** — 0 failures, 0 substantive warnings, 1 informational note (advisory — did not block). Migration 016 + down-pair verified; trading_mode literal pin confirmed; stale findings lines reconciled; no Floor risk.
- Carried into execution:
  - Steps 3/5: coverage threshold not stated — [x] no action (internal/repository + internal/service EXCLUDED by ci.yml:244 COVERPKGS filter; pgxmock + unit assertions are the C-08 gate). Reviewer-verified exception.
- Overlap findings: CLEAN — migration 016 uncontested; one SOFT, disjoint-region overlap with 175 on services/xstockstrat-portfolio/docs/context-constitution-findings.md (172 = drawdown row, 175 = getEnvBool row) — rebase-only, non-blocking.

---

## Session 2026-09-04 — sdd-execute (sequential; stacked PR #3 of 5, base feature/fix-config-watcher-client-id)

Path A per-account drawdown enforcement. Go 1.27; golangci-lint v2.13.1 rebuilt from source with GOTOOLCHAIN=go1.27.0 (the packaged 2.5.0 refuses go 1.27 — see Deviation Log). Auto-proceed.

### Step 1 — migration 016: peak_equity HWM column [done]
- `016_account_balance_peak_equity.up.sql` adds `peak_equity DOUBLE PRECISION NOT NULL DEFAULT 0` (matches `equity` type) + seeds `peak_equity = equity`; `.down.sql` drops it. Offline-verified (up/down inverse, next free NNN 016). No DB apply — real apply runs in CI/deploy.
- Files: `migrations/016_account_balance_peak_equity.{up,down}.sql`. TDD: N/A (migration).
- Migration needs DBA + owner approval at the PR (noted).

### Step 2 — repository: HWM upsert + GetAccountDrawdowns + interface widening [done]
- Widened `queryRower` with `Query` + `Exec` (added `pgconn` import); switched `UpsertAccountBalance` to `r.db.Exec` and added `peak_equity` (bound to $6) + `peak_equity = GREATEST(...EXCLUDED.equity)` on conflict — HWM rises each sync, never falls; no Go signature change. Added `AccountDrawdown` struct + `GetAccountDrawdowns(user, mode)` via `r.db.Query`.
- Files: `internal/repository/portfolio_repo.go`. Build clean; golangci-lint 0 issues.

### Step 3 — pgxmock repository tests (AC-1 fetch shape, AC-2 GREATEST contract) [done]
- `TestGetAccountDrawdowns_ScopesToUserAndMode` (SELECT projection + user_id/trading_mode filter, 2 rows) and `TestUpsertAccountBalance_RaisesPeakEquityWithGreatest` (ExpectExec regex requires peak_equity + GREATEST clause). C-13: inline row literals, single consumer.
- Red→green: compile-RED (`GetAccountDrawdowns undefined`) on pre-Step-2 tree → both pass after Step 2 (`-race`). golangci-lint 0 issues.
- Files: `internal/repository/portfolio_repo_test.go`. Deviations: none.
