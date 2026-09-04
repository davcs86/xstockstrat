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
