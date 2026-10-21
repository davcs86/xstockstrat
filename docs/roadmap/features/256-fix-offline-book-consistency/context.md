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

## Session 2026-10-21 — sdd-review product-spec

- Product spec approved (criteria: PASS WITH WARNINGS; overlap: WARN, no FAIL, no floor breach). Status: draft → spec-ready.
- OPERATOR DECISIONS (binding, recorded 2026-10-21):
  - Grouped by service+theme from the 2026-10-20 debt-radar scan; Track C.
  - Scope is D-47, D-48, D-49, D-63.
- Warnings (carried to /sdd-design):
  - Criterion 9 (Open Questions): Fix Scope still has an unchecked `- [ ] Proto changes: open` box, backed by OQ-1 and
    OQ-2. Design must resolve both and update the box before the spec gate. If OQ-1 picks a degraded marker, the
    additive `portfolio.proto` change needs the proto approval gate (C-04, `docs/runbooks/proto-versioning.md`).
  - Criterion 8 / FR-4, AC-3: requirement and Then clause are a disjunction (UNAVAILABLE or degraded marker). Design
    tightens AC-3 to the chosen outcome (C-15).
  - Criterion 8 / AC-1, AC-2, AC-6: some Then steps assert stream mechanics (cursor, redelivery). Testable at the
    consumer level; the final state assertions carry the observable outcome. Advisory.
  - Criterion 8 / AC-4: no example for `filled_qty` 0 with an unset price (un-confirm / bare re-confirm, `trading.go:933`).
    FR-5 validates price "on a fill". Design decides whether zero qty skips the price check and adds a non-regression row.
    Today `trading.go:894` checks only `FilledQty < 0` and `:924` never validates the price.
  - AC ordering: @AC-6 (FR-3) appeared before @AC-3. Resolved in this session (scenario moved after @AC-5).
  - Criterion 11 (Agent surface): design confirms whether the agent's error mapping already surfaces UNAVAILABLE and the
    FR-5/FR-6 errors; otherwise agent code and the strat-lab plugin skill change in the same PR.
  - FR-3 / OQ-2: the spec does not say whether the new retry bound also applies to the existing fill consumer
    (`portfolio_service.go:171-200`). Design states this explicitly.
- Overlap findings (all WARN, rebase-only; no config-key, proto field-number or migration collision):
  - `portfolio_service.go`: 264 (`:893-943` snapshot writer/broadcast), 257 (`:749-836` GetPnL), 251 (`:683`),
    242 (`:1004-1018` emitRiskAlert, implementation-ready), 248 (`:185-202`, `:220-221`, implementation-ready).
    This feature edits `:1117`, `:1129`, `:1159`, `:1213-1231`. Different functions.
  - `trading.go`: 267 (draft; `:688`, `:603`/`:1301`/`:1498`; its context.md:27 names the `:863-954` region but excludes
    the ConfirmOrder D-63 emit). Sequence the two trading.go branches. Also 249 (`:87-92`, `:3087`), 241 (`:2168-2176`),
    242 (`:1938-1944`, `:2751-2757`), 251 (`:1861`). Disjoint.
  - `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx`: 215 (in-progress) and 245
    (implementation-ready). Same file; rebase-only.
  - Low-risk shared context: `traderBff.ts` (263, draft) and 270-fix-ui-trader-feedback (draft, may touch the Book page
    or ConfirmFillDialog). Re-check if design touches the trader BFF or when 270's spec is written.
  - No live peer claims `portfolio.proto` or a `ConfirmOrder` field; any OQ-1 field takes a fresh next-free number,
    re-checked at spec time. Feature 240 (launched) is the trunk code being fixed.
  - Merge-order: no entry required (WARN-level only). Optional soft rows: 256 vs 267 (trading.go ConfirmOrder) and
    256 vs 264/257/251 (portfolio_service.go).
- Next: `/sdd-design fix-offline-book-consistency` (full).
