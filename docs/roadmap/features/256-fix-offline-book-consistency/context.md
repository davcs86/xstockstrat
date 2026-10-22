# Context Log: fix-offline-book-consistency

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-21 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-21-offline-book-consistency-defect.md` (Issues disabled).
- Source: repo-surveyor debt-radar scan `docs/repo-surveyor/debt-radar-findings.md` @ 4535695, findings **D-47**, **D-48**,
  **D-49**, **D-63**. All four re-verified on main-dev @ a053b0e and all reproduce in code. None excluded.
- Severity: SEV-2 (group). The surveyor rated D-63 alone lower; it is grouped here because it compounds D-47.
  Impact type: wrong-pnl-reported. Environment: dev (main-dev) @ a053b0e. Config-only: no.
- Operator decisions (2026-10-21): grouped by service+theme from the debt-radar scan; Track C for all SEV-2 (precedent #1264); batch launched via /sdd-batch with designGate halt.
- Routed to SDD path (Track C).
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1..5), context.md; report sidecar `.status` (`triaged`).
- Affected services: xstockstrat-portfolio (D-47, D-48), xstockstrat-trading (D-49, D-63). xstockstrat-ui is possibly
  affected for D-48's error/degraded state on the Book page.
- Root cause hypothesis: feature 240's best-effort choices on paths that no broker poll heals.
  - D-48 directly contradicts a recorded 240 decision: "a `GetOfflineStates` error is non-fatal (WARN, empty map)"
    (`240-offline-account-full-pnl/context.md:399`, `:771`). Design must explicitly supersede it.
  - The finite-value guard covered `fees` only (240 `design.md:67`).
- Line drift (scan @ 4535695 → a053b0e):
  - None for D-47 (`portfolio_service.go:1117`, `:1129`, `:1213-1231`), D-48 (`offline_valuation.go:99-103`) and
    D-49 (`trading.go:894-899`, `:1156-1167`).
  - The `recent_fills` decode is at `portfolio_repo.go:521-523` (cited `:518-520`).
  - The D-63 Warn is at `trading.go:951-954` (cited `:950-954`).
  - `DeleteOfflineRealized` Warn is at `portfolio_service.go:1159-1161`.
  - `deriveOfflineStatus` is at `trading.go:863-871`. Its `default` returns FILLED, which is what lets NaN and +Inf through.
- Overlaps:
  - **240-offline-account-full-pnl** (launched) is the origin of every site. Read its `context.md` (Steps 13–22) and
    `design.md` before design. No live conflict, because 240 is merged.
  - **251-fix-getpnl-source-service** (draft) and **257-fix-ledger-query-pagination** both edit
    `portfolio_service.go` (`GetPnL`, `:722-840`). This feature edits `:1117-1231` and `offline_valuation.go`. Different
    functions in the same file, so check merge-order and rebase.
  - **249-fix-ibkr-request-signing** cites `ConfirmOrder` only in passing. No conflict.
  - **267-fix-trading-order-state-audit** (same 2026-10-21 batch) edits `trading.go` `PlaceOrder`/`CancelOrder`/`ReplaceOrder`
    (`:586-1498`, the `UpsertOrder`/`ReclaimOrphanIntent` discards). This feature edits `ConfirmOrder` (`:888-958`). Same file,
    so rebase only.
  - **264-fix-portfolio-snapshot-surface** edits `portfolio_service.go:893-943` (snapshot writer/broadcast). Same file,
    different functions.
- Design fork for D-47: the fill consumer's "retryable" contract (`portfolio_service.go:171-200`) is an unbounded
  reconnect-from-failed-event with a 2s sleep. It has no bound or park, despite the surveyor's "bounded-retry/park" wording.
  Moving the offline sync consumer onto it as-is would let a poison sync event block the stream forever, so design must
  choose a bound and a park/skip policy (a constant or a config key).
- Recommended design depth: full → `/sdd-design fix-offline-book-consistency` (rationale: 2 affected services, which is the
  C-0 full trigger, plus the reversal of a recorded feature-240 decision and a possible read-contract change for D-48).
- Development branch: feature/fix-offline-book-consistency
