# Context: delisted-symbol-handling

**Feature**: `docs/roadmap/features/352-delisted-symbol-handling/feature.md`
**Product Spec**: `docs/roadmap/features/352-delisted-symbol-handling/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/352-delisted-symbol-handling/implementation-spec.md`

---

## Session 2026-11-16 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator's request, verbatim: "file a new feature on stop failing for symbols after they are delisted".
- Source of the observations: the 2026-11-16 fundamentals backfill after feature 348; record in
  `docs/roadmap/features/348-fix-edgar-historical-fundamentals/context.md` (sections "DO staging — the 8
  failed symbols, diagnosed" and "Watchlist clean-up after the DO failures").
- Number 352 reserved by `scripts/sdd-allocate-feature-number.py`.

### Operator decisions (asked and answered in this session)

- **D-1 Scope**: both the backfill outcome and the post-add watchlist lifecycle.
- **D-2 Disposition**: remove from system-managed "Signals" watchlists; keep and mark on user-created
  watchlists. Stored bars and fundamentals are kept (the operator did not object to that premise).
- **D-3 Job status**: per-symbol outcome and reason; a delisted symbol is `skipped`, not `failed`.
- **D-4 SHPH kind of case**: same state as a real delisting, after a configurable confirmation window;
  clears when the symbol reappears.
- **D-5 Explicit backfill of a flagged symbol**: attempted; `skipped` only when the source cannot serve
  it and the symbol is flagged.
- **D-6 Rename / reuse**: out of scope; follow-up `ticker-rename-and-reuse` to be filed.
- **D-7 Surfaces**: agent watchlist and backfill tools, `/insights` watchlists page, alert on
  transition. The standalone servability-check tool was offered and not selected.

### Assumptions made in this session (not decided by the operator)

- A flagged symbol on a user-created watchlist is "marked" *and* no longer requested by
  watchlist-driven work (FR-5). Basis: D-1 includes "stops being kept warm and re-requested".
- Held positions keep being valued (FR-6). Basis: MARKETDATA-16 / R11, an existing guarantee.
- `skipped` applies to every backfill data kind, not only fundamentals (FR-7). Basis: D-3 was asked
  about "a backfill job" in general.
- Recovery does not re-add a symbol to "Signals" (FR-2). Basis: "Signals" entries come from
  `ingest_signal`; a new signal re-adds it through the normal path.
- The UI marker reuses the existing `UNSERVABLE_REASON` texts of
  `services/xstockstrat-ui/src/lib/opportunityShared.tsx` (AC-15).
- Story artifacts are filed from `claude/story-delisted-symbol-handling` into `main-dev`;
  `feature/delisted-symbol-handling` is created when design starts.

### Verified in code (`main-dev` at `78ab5ca`)

- Gate at add time only: `refuseUnservable` → `GetSymbolServability` in
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go`.
- Classification: `services/xstockstrat-marketdata/internal/service/asset_servability.go`.
- Failure path: `BackfillFundamentals` in
  `services/xstockstrat-marketdata/internal/service/marketdata_service.go`; error text from
  `services/xstockstrat-marketdata/internal/edgar/edgar_client.go` (`no CIK for ticker %q`).
- Job status contract: `BackfillJob` in `packages/proto/ingest/v1/ingest.proto` (`failed_symbols`,
  `error`, `BACKFILL_STATUS_PARTIAL`).
- Not verified here: the list of watchlist-driven requesters (FR-5) and how `xstockstrat-ingest`
  derives `PARTIAL` from marketdata's response — left to `/sdd-design` recon.

## Session 2026-11-16 — sdd-story (operator follow-up on the open questions)

- **D-8** Confirmation-window default: 5 days. The unit (calendar or trading days) was not stated;
  the scenarios read it as calendar days and the unit stays an open question.
- **D-9** Delisted state is platform-wide, per symbol, in a new symbol/company profile record. Operator:
  "create something like a symbol/company profile. It will be useful for additional metadata." This
  feature stores only the delisted state in it; other metadata is out of scope (my reading, to keep
  the feature minimal). Added FR-13 and AC-19.
- **D-10** Alerts: one per symbol. Added AC-18.
- **D-11** **C-16 sign-off**: the operator signed off changing feature 282's "only the first
  asset-set load prunes the warm set" guarantee (FR-5).
- The operator answered four of the five open items. "Record of the automatic removal" (ledger event
  or not) was not answered and stays open. Mapping of the answer "Per symbol" to the alert-volume
  question is my reading.

## Session 2026-11-16 — sdd-story (second operator follow-up)

- **D-12** Removal from "Signals": "Alert is enough" — no ledger event. Added AC-22.
- **D-13** Window unit: trading days. Scenario dates reworked (first-unservable 2026-11-09, a Monday);
  added AC-20. This supersedes the calendar-day reading noted under D-8 above.
- **D-14** Profile rows: "Lazy write is fine". My reading: a row is created the first time there is
  state to record for a symbol (first unservable observation); nothing is pre-populated. Whether a
  backfill naming an unservable symbol on no watchlist also starts a row is left open for design.
  Added AC-21.
- **D-15** Profile owner: `xstockstrat-marketdata` ("marketdata makes more sense to me"). Consequence
  recorded as an open question: portfolio must learn of a transition from marketdata, a direction
  that does not exist today.
- "Per symbol" = alert volume (D-10) was my reading; the operator saw it restated and did not correct it.

## Session 2026-11-16 — sdd-review product-spec (rounds 1 and 2, findings addressed)

- Tree: `claude/story-delisted-symbol-handling` (contains `origin/main-dev@78ab5ca`). Deviation from
  `docs/sdd/tree-freshness.md`: the target would be `main-dev`, but the story PR #1563 is not merged,
  so the review ran on the story branch, which holds the feature directory.
- Round 1: FAIL — unchecked open questions; no migration strategy. Fixed: design-work items moved to
  § Design Inputs, migration strategy and config-key obligations added, trading-domain notes added,
  AC-23 and AC-24 added.
- Round 2: PASS WITH WARNINGS (8 warnings, 3 notes), all addressed. Two needed the operator:
  - **D-16** any source error on a flagged symbol, permanent or transient, is `skipped` (AC-26).
  - **D-17** a flag persists and is re-evaluated when the symbol is on no watchlist (AC-27).
- Clarified from D-14: the profile row is written on the first unservable observation and holds the
  first-unservable date before the flag (FR-1, FR-13, AC-21); a servable load resets it (AC-25).
- Overlap scan: no FAIL-level collision. Rebase risks and the existing
  `marketdata.symbol_classification` table are listed in product-spec § Design Inputs.
- Round 3: PASS WITH WARNINGS (4), all addressed. **D-18** (operator): a recovery also emits one
  alert per symbol (AC-29). FR-1 counting rule made explicit — elapsed trading days, first-unservable
  date is day 1, NYSE session date in America/New_York, a day with no successful load only passes
  (AC-28); this wording is the reviewer's and mine, consistent with D-13, not a separate operator
  ruling. FR-9 defines `empty`; FR-11 and the consumer surface name `manage_watchlist` and
  `manage_watchlist_symbols`.
- Round 4: PASS, no warnings. Notes left for design: alert wording when no system-managed list was
  involved.

## Session 2026-11-16 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Warnings: none (rounds 1–3 findings all addressed above).
- Overlap findings: no FAIL-level collision; WARN-level same-file overlaps with 347, 348
  (`marketdata_service.go`), 343 (`tools.py`), 340 (`marketdata.proto`, textual). No merge-order row.
- Recommended design depth: full (6 services, additive proto on 3 contracts, new marketdata table, a
  new marketdata → portfolio direction, C-16 CHANGE to feature 282).

## Session 2026-11-16 — sdd-design (Phase 0 recon, round 1 and its gate)

- Tree: `claude/story-delisted-symbol-handling` (contains `origin/main-dev@78ab5ca`); same deviation
  from `docs/sdd/tree-freshness.md` as the review (story PR #1563 unmerged). Mode: full.
- Phase 0: wrote recon.md. Recon added `xstockstrat-analysis` as a watchlist reader. The spec's Design
  Input expecting CHANGE scenarios in the portfolio and agent 282 suites did not hold; only marketdata
  `@AC-15` changes under spec D-11.
- Round 1 (debate.md): pull direction (portfolio → marketdata), `marketdata.symbol_profile`,
  transitions by conditional `UPDATE … RETURNING`, shared NYSE calendar, outcome model in `common/v1`.
- **Round-1 gate, operator rulings (2026-11-16):**
  - **C-16 sign-off**: platform `@AC-17 @feature-282` ("a held offline unservable symbol stays valued
    and warm across later refreshes") changes for flagged symbols only — a held flagged symbol leaves
    the warm set at each load and the next quote read re-warms it; it stays valued (debate D-11).
  - **Declined**: changing portfolio `@AC-19 @feature-282`. A replace-all update still drops a stored
    unservable symbol, flagged or not (debate R-10). FR-4 "kept and marked" therefore holds until a
    replace-all update of that list.
  - **Flag alert emitter**: portfolio, after its removal, stating how many system-managed lists the
    symbol was removed from (debate D-10).

## Session 2026-11-17 — sdd-design (round 2 and its gate)

- Round 2 (debate.md): O-4..O-16 closed; adversary raised O-17..O-30, no Floor breach. Synthesis
  adopted D-12..D-17 (removal only from a fresh response; no reset on an empty list; bounded hook
  context with the 282 prune first; boot load of the flagged set; alert rules; binding rules).
- **Round-2 gate, operator rulings (2026-11-17):**
  - **Steer**: run round 3 on the simpler variant — the asset-load hook is the only decider of profile
    state; portfolio's sync only supplies the watchlist symbols (debate D-19).
  - **Alert delivery**: at-least-once, acknowledgement after send, unacknowledged claims re-claimable
    (debate D-18).
  - **Spec amendments approved** and applied to product-spec.md: FR-4 (a replace-all update still drops
    a flagged symbol), FR-12 (portfolio sends the flag alert after the removal with the count and names
    of lists; at-least-once; marketdata sends the recovery alert, only if the flag had been reported),
    Affected Services (+ `xstockstrat-analysis`). No scenario renumbered.
- Open going into round 3: O-24 (deadlock, expected moot under D-19), O-25 (shared timeout key), O-27
  (AC-21 timing, expected resolved by D-19).

## Session 2026-11-17 — sdd-design (round 3 and its gate)

- Round 3 (debate.md D-20..D-24): persisted union `marketdata.watched_symbol`; the hook as five ordered
  conditional statements; alert-state enum with claim, 10-minute lease and a separate acknowledge RPC;
  fixed 15 s sync deadline; inbound internal-caller allow-list on marketdata. `state_as_of` dropped.
- **Round-3 gate, operator rulings (2026-11-17):**
  - **Run another round** (round 4) on the synthesized design before approval.
  - **Fixed invariants approved** (not config keys): hook time limit 30 s, flag-alert lease 10 minutes,
    sync deadline 15 s, 20 000 symbols per sync, 100 flag alerts claimed per sync.
  - **Accepted residuals**: the recovery alert is at-most-once; a hook timeout on a load where a symbol
    was servable can let it flag earlier than the 5-day rule (logged and counted).
  - **Scenario amendment approved (C-15)**: AC-29 Given becomes "ATCH is flagged delisted and its flag
    alert was sent". ID and outcome unchanged.
