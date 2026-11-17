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

## Session 2026-11-17 — sdd-design (round 4 and its gate)

- Round 4 attacked the consolidated draft design.md. One blocking defect (a deadlock between the
  delisting removal and `UpdateBinding`) fixed by never waiting on a lock (debate D-25). D-26, D-27
  added (New York calendar date, rebuild before recovery alerts, one snapshot per sync call).
- **Round-4 gate, operator rulings (2026-11-17):**
  - **Run a fifth round** (the cap) before approval.
  - **C-16 sign-off**: portfolio `@AC-1 @feature-154` changes — the cross-user enumeration returns the
    distinct set minus flagged-delisted symbols. 281 `@AC-4` and `@AC-5` keep their text and are read
    as rules of the expiry prune: the delisting removal takes a flagged symbol off a system-managed
    list even if it was added manually.
  - **Scenario amendments approved (C-15)**: AC-8 gains "And no quote or price read names ROKU after
    it is flagged" and its scan line reads "after the next scan of Tech that follows
    xstockstrat-portfolio's next delisting refresh"; a Background line is added: "xstockstrat-portfolio's
    delisting refresh runs after every watchlist change and after every asset-set load".
  - **Acknowledged**: the approved 15 s value also bounds each alert send; portfolio stops sending at
    the first failed alert and the rest are re-sent after the lease.

## Session 2026-11-17 — sdd-design (round 5 and its gate)

- Round 5: proposer consistency pass applied to the draft design.md (incl. a UI fix: a flagged row
  shows the badge in place of a readiness skeleton that would never resolve); adversary found one
  blocking defect in the backfill-results merge, fixed (debate D-29). Petition P-1 (REOPEN D-5) logged.
- **Round-5 gate, operator rulings (2026-11-17):**
  - **Round cap overridden**: "override round cap, until design is sound". The skill's hard cap of 5
    debate rounds is lifted for this feature by explicit operator instruction. Stopping criterion used
    from here: a round whose adversary returns no blocking objection and no text edit; the design then
    comes back to the operator for approval (P-04 still applies).
  - **P-1 declined**: recovery stays on trading-day loads only. FR-2 amended to "re-evaluated by every
    successful asset-set load on a trading day" (C-15, operator-approved).
  - **FR-12 clarified**: the recovery alert is sent only if the flag alert had been claimed for sending.
  - **Caller check**: the two new marketdata RPCs require the caller header and portfolio's mTLS peer
    identity (debate D-30).

## Session 2026-11-17 — sdd-design

- Phase 0 Recon: wrote recon.md (services: marketdata, portfolio, ingest, agent, ui, notify, analysis;
  key reuse patterns: the 281 `pruneListTx` SKIP LOCKED deleter, `classification_repo.go`, the
  `refuseUnservable` pull edge).
- Phase 1 Grilling: 6 rounds (full; cap overridden by the operator). Chosen approach: marketdata owns a
  per-symbol profile and a copy of the watchlist union, and its asset-load hook is the only decider;
  portfolio pulls on its prune tick, removes from system-managed lists, sends and acknowledges the flag
  alert. Rejected: a marketdata → portfolio push, gating `markWarm`, per-read decoration RPCs, an
  in-memory union (14 locked alternatives in debate.md).
- **Round-6 gate (2026-11-17)**: operator approved the design, and the second Background line ("every
  asset-set load in these scenarios that names no date runs on a trading day") (C-15).
- Constitution rules touched: C-03, C-04, C-05, C-07, C-09, C-10, C-12, C-13, C-14, C-15, C-16, C-18,
  F-01, F-06, F-07, PLAT-9. Floor breaches: none in any round.
- C-16 CHANGE sign-offs on record: 282 marketdata `@AC-15` (2026-11-16), platform `@AC-17 @feature-282`
  for flagged symbols (2026-11-16), portfolio `@AC-1 @feature-154` (2026-11-17), and the reading of 281
  `@AC-4`/`@AC-5` (2026-11-17).
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks — each needs a spec step or an explicit check)

- [ ] Recovery alert at-most-once (accepted) — emitter step in marketdata.
- [ ] Hook timeout can miss a reset or the flagged-set rebuild (accepted) — WARN + counter in the hook step.
- [ ] Re-sent flag alert names only the lists removed on its own tick — portfolio alert step.
- [ ] Recovery between a claim and a send (accepted, FR-12 "claimed") — covered by tests of the sync step.
- [ ] Weekend/holiday recovery lag (operator ruling) — hook step and its closed-day test.
- [ ] A sync spanning a load can remove a just-relisted, just-re-added symbol — documented residual.
- [ ] Marker timing on a system-managed list before portfolio's tick — UI/e2e step.
- [ ] Another instance's flag invisible to backfills until the next load — backfill step note.
- [ ] Resumed job can show FAILED results absent from `failed_symbols` (R-9) — ingest step test.
- [ ] Job-level fundamentals failure carries no per-symbol results — ingest step note.
- [ ] Union depends on portfolio's tick; deploy-era first-unservable dates — rollout note step.
- [ ] Re-verify at spec time: config seed number (052 last, 053 claimed by 345), migration numbers from
  `git log --all` and every `origin/feature/*`, the two portfolio importers of `marketsession`.

## Session 2026-11-17 — sdd-spec

- Generated implementation-spec.md with 32 steps. Status → implementation-ready.
- Tree: `claude/story-delisted-symbol-handling@21c4a2e` (contains `origin/main-dev@4c87ea8`, docs-only
  delta). Same deviation from `docs/sdd/tree-freshness.md` as the review and design sessions: the story
  PR is unmerged and `feature/delisted-symbol-handling` does not exist yet, so the spec was grounded on
  the story branch. `main-dev` moved `78ab5ca` → `4c87ea8` since recon (features 350 and 353); neither
  touches a file this feature edits, and every recon `path:line` used in the spec was re-checked.
- No discovery subagent was available in this session; discovery ran inline with the checklist of
  `.claude/skills/sdd-spec/reference/discovery-checklist.md`.
- Key codebase findings:
  - Migration numbers re-derived: marketdata `010`, ingest `017`, config `054` (`052` is last on the
    tree, `053` is claimed by feature 345). Only `origin/main-dev` and the story branch are visible in
    this sandbox, so Steps 5, 10 and 17 re-derive the number from every `origin/*` ref at execute time.
  - The two portfolio importers of `marketsession` are `internal/service/offline_valuation.go:17` and
    `internal/testdata/offline_pnl.go:9`. Its test uses the unexported `ny`, so the re-homed test loads
    the location itself. Portfolio's CI coverage total was measured: 73.2% with the package, 79.1%
    without it — the move cannot breach the 40% gate.
  - Existing marketdata and portfolio tests build their service with no profile store and a nil
    marketdata client; the hook and the tick step are therefore no-ops in those cases by construction.
  - No descriptor-parity guard covers `WatchlistBinding`, `BackfillJob` or the two marketdata backfill
    responses, so the proto unit is two steps.
  - `scripts/config-wiring-stored.json` must be regenerated against a scratch Postgres in the same
    commit as the seed (precedent: feature 347 Step 11).
- Atomic units (`**Lands with**`): Steps 1+2 (proto + stubs), 3+4 (calendar move + its test), 8+9+10
  (hook and reader + tests + config seed), 22+23 (`WatchlistStore` gains a method + its fake).
- Assumptions made by the spec, listed in its "Assumptions" table for `/sdd-review impl-spec` (not
  operator decisions): A-1 request/response shapes of the two RPCs; A-2 counter name
  `marketdata.delisting.hook_failures{reason}`; A-3 JSON shape of `ingest.backfill_jobs.symbol_results`;
  A-4 a failed symbol without a per-symbol result is stored `FAILED` with an empty reason (rolling
  deploy); A-5 the rollout note lives in `services/xstockstrat-marketdata/CLAUDE.md`; A-6 alert wording;
  A-7 a skipped symbol is logged at INFO; A-8 the UI badge uses variant `warning`; A-9 new symbol names.

### Open Threads — where each design Open Risk landed

- [x] Recovery alert at-most-once → Step 8 (WARN on a cut-off send), Step 9.
- [x] Hook timeout can miss a reset or the rebuild → Step 8 (WARN + counter), Step 9.
- [x] Re-sent flag alert names only its own tick's lists → Steps 22, 23.
- [x] Recovery between a claim and a send → Step 14.
- [x] Weekend/holiday recovery lag → Step 9 (closed-day case).
- [x] A sync spanning a load → documented in Step 13.
- [x] Marker timing before portfolio's tick → documented in Step 24.
- [x] Another instance's flag invisible until the next load → documented in Step 15.
- [x] Resumed job with FAILED results outside `failed_symbols` → Step 19.
- [x] Job-level fundamentals failure carries no per-symbol results → Step 19.
- [x] Union depends on portfolio's tick; deploy-era first-unservable dates → rollout note, Step 8.
- [ ] Still open for execute time: the three migration numbers against every `origin/feature/*` ref.

## Session 2026-11-17 — sdd-review impl-spec (advisory), round 1

- Tree: `claude/story-delisted-symbol-handling@4746789` (contains `origin/main-dev@149351d`; features 353
  and 354 merged in since the spec was written).
- Result: 2 failures, 27 warnings, 6 notes (advisory — did not block). All applied to
  implementation-spec.md: F1 (Step 2 Files as exact generated paths), F2 (Step 31 coverage threshold),
  W1–W27 (stale citations W1, W2, W13, W14, W16, W19, W20, W22; vacuous RED W10, W21, W22; guard AC-12
  W12; removal result gains `Left` W15; pgxmock feasibility and local RED W17, W18; proto field numbers
  W3; verification commands W4, W5; file-count notes W6, W8, W24; `<NNN>` seed reference W9; unused
  Files entry W11; `profileDBSymbolPrefix` W7; `GetWatchlistReadiness` left unchanged and documented
  W23; agent CLAUDE.md bullet W25; rollout note moved to `docs/runbooks/delisting-rollout.md` per
  design §10 W26; assumptions A-8 extended, A-10 and A-11 added, A-7 marked for operator confirmation
  W27).
- W18 adapted: the pgxmock `@AC-6` case asserts the list query's bound symbols and returns no rows,
  because `WatchlistRepo` transactions use `r.pool.Begin`, which pgxmock cannot substitute.
- Overlap findings: no migration, proto-field or config-key collision. Config migration ordering hazard
  with feature 345 (it claims `053`, this feature takes `054`) — a merge-order row is pending the
  operator's decision. Same-file overlaps with 343, 344, 345, 337, 341, 347, 348, 339, 340 and 322 are
  rebase-level.
- Unresolved carried into execution: none from round 1.

## Session 2026-11-17 — sdd-review impl-spec (advisory), round 2

- Tree: `claude/story-delisted-symbol-handling@b33f655` (contains `origin/main-dev@149351d`).
- Result: 0 failures, 8 warnings, 4 notes (advisory — did not block). All applied to
  implementation-spec.md.
- The two with behavioural weight: (1) AC-6 now has a real local RED — the per-list statements move
  into `removeDelistedInTx(ctx, tx pgx.Tx, …)`, driven in a pgxmock test through
  `ExpectBegin`/`Begin` (Steps 20–21); (2) the `/insights` row passes only unflagged bound pairs to
  `useWatchlistReadiness`, so a flagged pair neither keeps the 30 s poll alive nor triggers analysis'
  on-read refresh (Steps 30–31).
- Others: runbook "how to defer" sentence and index position, broker-symmetry statement, test-name
  prefixes with pass-count floors (Steps 9, 14, 16, 21, 23, 25), anchored `SKIP LOCKED` grep, nil-notify
  guard and test construction (Steps 22–23), `go_gate` now fails below the CI threshold of 40.
- Adapted from the reviewer's text: the readiness request carries only the watchlist id and page, never
  the pairs, so the e2e proof is "a list whose only bound binding is flagged issues no
  `GetWatchlistReadiness` request", not a pairs assertion; the pairs filter is applied to `pageBound`,
  not `bound`, so the page slice stays aligned with the server's keyset cursor.
- Unresolved carried into execution: none from round 2.

## Session 2026-11-17 — sdd-review impl-spec (advisory), round 3

- Tree: `claude/story-delisted-symbol-handling@8df4f8f` (contains `origin/main-dev@149351d`).
- Result: 0 failures, 5 warnings, 2 notes (advisory — did not block). All applied to the spec: W1–W5
  and N1; N2 needed no change.
- Behavioural ones: the expiry-row DELETE in Step 20 bound two arguments but used `$3` (now `$2`, with
  the Step 21 mock arguments stated); the readiness roll-up in Step 30 counted flagged rows as
  "no-data" (the page now derives `readable` from `pageBound` for the hook pairs, `resolved`, the
  roll-up list and the roll-up visibility test).
- Pass counts are now enforced by the commands (`test "$( … | grep -c '^--- PASS')" -ge N`) in Steps
  4, 7, 9, 14, 16, 21, 23 and 25, with `-run` filters matching the prescribed test-name prefixes;
  scenario tests carry a `// @AC-<n>` comment.
- Unresolved ✗ / ⚠ carried into execution: none from round 3.


## Session 2026-11-17 — sdd-review impl-spec (advisory), round 4

- Tree: `claude/story-delisted-symbol-handling@6f0e12e` (contains `origin/main-dev@149351d`).
- Result: 1 failure, 3 warnings, 1 note (advisory — did not block). All applied to the spec:
  Step 9 (AC-4 and AC-5 are two tests, so the enforced `@AC-` count of 14 is reachable), Step 6
  (`ClaimableSymbols` lease bound as `make_interval(secs => $1)`; `Start` day bound as `$3::date`),
  Step 4 (anchored `-run` filter), Step 30/31 (paging), Step 30 line anchors.
- Behavioral one: a readiness page whose bound rows are all flagged no longer dead-ends pagination.
  The page token comes only from the server, and the hook is disabled when it gets no pairs. Fix:
  `useWatchlistReadiness` gains an optional `morePages` parameter that only widens `enabled`; the
  component passes the unflagged pairs and whether more bound bindings follow the page. The poll-alive
  test still uses the pairs only, and a list whose only bound bindings are flagged still issues no
  request. Step 30 now modifies the hook file; Step 31 gains a 26-binding e2e case.
- Unresolved ✗ / ⚠ carried into execution: none from round 4.

## Session 2026-11-17 — sdd-review impl-spec (advisory), round 5

- Tree: `claude/story-delisted-symbol-handling@ec3439d` (contains `origin/main-dev@149351d`).
- Result: CLEAN — 0 failures, 0 warnings, 0 notes (advisory — did not block). Rounds 1–4 returned 29,
  12, 7 and 5 findings; all were applied to implementation-spec.md.
- Unresolved ✗ / ⚠ carried into execution: none.
- Overlap findings (round 1, unchanged): no migration, proto-field or config-key collision. Config
  migration ordering against feature 345 (`053` there, `054` here): a merge-order row is pending the
  operator's decision. Same-file overlaps with pending features are rebase-level.
- For operator confirmation, not blocking: assumption A-7 (a skipped symbol is logged at INFO).

## Session 2026-11-17 — sdd-review impl-spec, operator decisions after the clean round

- **Merge order**: operator chose "345 renumbers if 352 lands first". Row added to
  `docs/roadmap/features/merge-order.md` (345 vs 352, conditional config-migration renumber; neither
  feature waits).
- **A-7 confirmed**: a flagged symbol skipped by a backfill is logged at INFO.

## Session 2026-11-17 — sdd-execute sequential (mode entry, merge train, re-spec gate)

- **Operator instruction**: "Run execution in sequential mode, no checkpoints" — checkpoint reports are
  printed, no gate; execution stops only on a real blocker.
- **Operator answers at mode entry**: "Merge train 1563, check for conflicts with spec, restart execution
  with the same terms"; a throwaway local Postgres is approved for Step 10 artifact generation only
  (precedent: feature 347) — no staging or shared database is touched; scenario promotion and the
  integration PR happen at the end without a pause. The integration PR is not merged by the agent.
- **Merge train**: PR #1563 (story) merged into `main-dev` as `9a685196`; the append-only ledger conflict
  was auto-resolved by union.
- **Branch**: `feature/delisted-symbol-handling` created from `origin/main-dev@9a685196` (includes
  features 351, 353, 354).
- **Re-spec validation**: no blocker. Line shifts only in Steps 20, 22, 23, 24, 28; substantive additions
  in Step 24 (decorate `ListWatchlists` after the feature-351 ensure block, plus a `TestListWatchlists351_`
  run), Step 25 (Instruction 1a: locate lists by `watchlist_id`, uuid-shaped seed ids, the ensure and
  fail-open pages are both asserted decorated), Step 28 (the 351 docstring and runbook sentences are kept)
  and Step 32 (351 durable scenarios are PRESERVE; matching rows added to `design.md` § Business Rules
  Touched). Step count (32), `Lands with` units and the Scenario Coverage table are unchanged. Migrations
  marketdata `010` / ingest `017` / config `054` and all proto field numbers are still free on all 218
  origin refs.
- **Tooling**: `go1.27.0 ✓ · golangci-lint ⬇ v2.14.0 (go1.27, scratchpad bin) · migrate ⬇ v4.17.1 (scratchpad bin, Step 10 generation only) · uv ✓ · ruff ✓ · node ✓ 24.22.1 (/opt/node24) · pnpm ✓ 9.15.9 · buf via Docker codegen image · psql/initdb ✓ (Step 10 throwaway only)`

## Session 2026-11-17 — sdd-execute sequential, step log

### Step 1 — proto (unit 1+2) — done
- Additive fields and RPCs exactly as specced: `BackfillSymbolOutcome`, `BackfillSymbolResult`,
  `DelistedState` (common); `symbol_results` on `BackfillBarsResponse=4`, `BackfillFundamentalsResponse=3`,
  `BackfillJob=16`; `WatchlistBinding.delisted=4`; `SyncWatchlistDelistings` / `AckDelistingAlerts`,
  `DelistingAlertState`, `FlaggedSymbol`.
- TDD: N/A (proto). `buf lint` and `buf breaking` passed inside the codegen container; `buf breaking` ran
  against local `main-dev`, which is the same tree as the feature branch before this unit.

### Step 2 — proto-gen (unit 1+2) — done
- Generated with `python3 scripts/localenv-setup.py` (pinned Docker codegen image). 36 generated files
  changed, all in the step's `**Files**` list and all inside `common`/`marketdata`/`ingest`/`portfolio`;
  the 9 listed files that did not change are not staged.
- The first container run could not compile `gen/ts` (`tsc: not found`) because the workspace had no
  `node_modules`; `pnpm install --frozen-lockfile` fixed it. No lockfile change.
- TDD: N/A (proto-gen). Verification: marketdata `go build`, portfolio `go build` + `go vet`, trading
  `go vet`, ingest `pytest tests/test_backfill_jobs.py` (15 passed), UI `tsc --noEmit` — all passed.

### Step 3 — service: calendar move (unit 3+4) — done
- `marketsession.go` moved unchanged (`git mv`) to `packages/proto/marketsession/`; the two portfolio
  importers now use `contracts/marketsession`; `services/xstockstrat-portfolio/internal/marketsession/` is
  gone; both `CLAUDE.md` files updated.
- TDD: red N/A — relocation, no behavior change. Verification passed (no old import left, portfolio
  `go build`, `scripts/check-context-map.py` OK).
- `gofmt` re-sorted the import line in `offline_valuation.go` (`:17` → `:16`); no other change there.

### Step 4 — test: calendar characterization test re-homed (unit 3+4) — done
- `internal/service/marketsession_test.go`, package `service`, assertions unchanged.
- TDD: red N/A — characterization test of unchanged behavior. Green: the anchored `-run` → 5 PASS;
  `go_gate xstockstrat-portfolio` → 0 lint issues, all packages ok under `-race`, total 79.1%.
- Divergence from the step text: the New York location is loaded once in a file-local `sync.OnceValue`
  that `nyDate` calls, not inside `nyDate` on every call — `TestHolidays_2026_2028` uses `time.Time` as a
  map key, and a fresh `*time.Location` per call makes those lookups miss.

### Step 28 — service: agent tools (delisted state, per-symbol backfill outcomes) — done
- Executed in a parallel worktree and landed out of step-number order (see Deviation Log, "parallel
  chains").
- `_watchlist_to_dict` marks every binding with `delisted` (+ `delisted_reason`, `first_unservable_date`
  when flagged); `_backfill_job_to_dict` used by both returns of `get_backfill_status`, `symbol_results`
  always present. Feature-351 docstring and runbook sentences kept. `mcp-tools.md` and the strat-lab
  `backtest` skill files updated in the same commit.
- TDD: AC-16 red: `{'delisted': {...}} != {'delisted': True}`; AC-14 red: `'BACKFILL_SYMBOL_OUTCOME_SKIPPED'
  != 'skipped'` (7 failed / 4 passed on the unmodified client) → green: 11 passed.
- Verification: ruff clean, full pytest 776 passed, plugin `validate.py` (+ `--self-test`), grep counts,
  `check-context-map.py` — all passed. The full suite ran once on the tree holding Steps 28 and 29.

### Step 29 — test: agent projections — done
- 8 new cases in `tests/test_watchlist_client.py`, 4 in `tests/test_client.py`. `py_gate` via `uv run`:
  ruff clean, 776 passed, coverage 88.22%. No skipped tests.
- Four of the new tests are guards that pass on the unmodified client (two proto-field guards, "no
  bindings", "no results → `symbol_results: []`"); two of them go beyond the step text.
- Noted, not changed: an enum number unknown to this agent build makes `.Name()` raise `ValueError`, the
  same behaviour as the existing `_refused_to_list`.

### Step 26 — service: analysis skips flagged bindings (unplanned unit 26+27) — done
- Blocker raised by the worker: `b.HasField("delisted")` raises `AttributeError` on the `SimpleNamespace`
  fake bindings of existing tests (88 failed / 1652 passed with Step 26 alone). **Operator decision
  2026-11-17: "Fold + fix fakes"** — one commit for 26+27, the three fake-binding builders build real
  `portfolio_pb2.WatchlistBinding`, two test files outside `**Files**` join the unit. Production code is
  exactly the step text (`servicer.py`, `live_loop.py`, one `HasField("delisted")` each).
- Deviations: unplanned fold + two extra test files (Deviation Log).

### Step 27 — test: flagged bindings leave the opportunity scan and the live loop (unplanned unit 26+27) — done
- TDD: AC-8 red: `assert {'AAPL','ROKU'} == {'AAPL'}` (3 failed / 1 passed on the unmodified drains; the
  pass is the "binding without `delisted` is unchanged" characterization case) → green: 4 passed,
  including "an all-flagged list never falls back to legacy `symbols`".
- `py_gate` via `uv run`: ruff clean, 1740 passed, coverage 91.57%. No skipped tests.
- Lesson for the ledger at the end of the run: a spec that adds a `HasField` check on a proto message
  must list every test double that fakes that message with a non-proto object.

### Step 17 — migration: ingest `018_backfill_symbol_results` (renumbered from `017`) — done
- Renumbered as Step 17 Instruction 1 prescribes: `origin/ccr-424ada30-29m2lv` (feature 355
  `mediated-source-extraction-instructions`, in flight) adds ingest `017_signal_source_extraction_instructions`;
  `018` is free on every origin ref. `feature.md`'s DBA row now says `018`; `design.md` still says `017`
  (approved artifact, not edited). A merge-order row (355 vs 352) records the same rule the operator chose
  for 345: whichever lands second re-derives its number — **this row is the agent's extension of that
  ruling, pending operator confirmation**.
- TDD: N/A (migration). Verified offline: up/down pair, `018` highest with no duplicate, down drops
  exactly the column up adds. No database started.
- Deviations: file names differ from `**Files**` (`018_…` not `017_…`) — Deviation Log.

### Step 18 — service: ingest stores per-symbol results per chunk and serves them merged — done
- `servicer.py`, `repositories/backfill_jobs.py` (`symbol_results` in `_UPDATABLE_COLUMNS`), service
  `CLAUDE.md` (names migration `018`). Verified on this commit alone: ruff clean, `pytest -q` 531 passed,
  grep checks pass, `webhook_handoff_loop.py` untouched.

### Step 19 — test: ingest chunk, retry, resume and read paths — done
- TDD: AC-11 red: `no update_job call carried symbol_results`; AC-14 red: `[] == [('AXIA', 3, …),
  ('PSKY', 2, …)]`; repo red: `non-updatable column(s) ['symbol_results']` (12 failed / 6 passed on the
  unmodified module; the webhook payload guard and the job-level-failure case pass before and after, as
  specced) → green: 18 passed.
- `py_gate` via `uv run`: ruff clean, 546 passed, coverage 87.01%. No skipped tests. Every case of
  Instruction 3 has a test (AC-11, 13, 14, 23, 24, 26; retry; whole-chunk failure; resume with the
  documented residual; merge precedence; job-level failure; A-4).

### Step 30 — service: `/insights` watchlist row shows the delisted marker — done
- `delistedMarker` helper (`lib/opportunityShared.tsx`), exported `Binding` with `delisted?`, `DelistedBadge`,
  the `readable` filter and `morePages` in `WatchlistReadiness.tsx`; `WatchlistDetail.tsx` imports
  `Binding`; `useWatchlistReadiness` takes optional `morePages = false`.
- TDD: AC-15 red: `TypeError: delistedMarker is not a function` (4 failed) → green: 14 passed.
- Verification: `pnpm run lint`, `tsc --noEmit`, `lint:dup` (0 clones), the two greps — all passed.
- Deviations (Deviation Log): a flagged bound row also omits the blocking-condition cell (a resolved
  readiness row from analysis would otherwise still show readiness text next to the badge); the badge is
  followed by a `delisted-detail-<symbol>` span `<reason> · since <date>`.

### Step 31 — test: marker unit test, fixtures and e2e — done
- TDD (e2e): AC-15 red with Step 30's four files restored to base: 4 failed (`delisted-badge-ROKU` not
  found; paging case badge count 25 vs 0) → green: all four feature-352 cases pass. The paging case's red
  was not isolated to the `morePages` instruction — it fails earlier on the missing badges.
- Green runs: Playwright `watchlists.spec.ts` + `screener.spec.ts` (chromium) → 51 passed, 1 failed
  (`screener.spec.ts:43`, not edited by this step); `screener.spec.ts` re-run alone → 25 passed (treated as
  a local dev-server flake; watch it in CI). `pnpm run test:coverage` → 732 passed, 2 skipped (pre-existing
  skips, not traced), 80.91% statements. Lint and `tsc --noEmit` pass.
- Deviations: e2e ran on host Playwright with `--timeout=180000 --trace off` (the dev-mode warm-up takes
  ~58 s here), not the Docker runner; `normBindings` in `e2e/helpers/watchlistMock.ts` now carries
  `delisted` through so write routes that rebuild bindings keep the field; `UnservableReasonName` type
  moved above `MockBinding` in the same file. C-12: fixture + `INVENTORY.md` row added.

### Step 20 — service: portfolio's never-waiting removal of flagged symbols — done
- New `internal/repository/delisted_removal_repo.go` (`SKIP LOCKED`, 2 occurrences); `signal_expiry_repo.go`
  untouched.
- TDD: AC-6 red (functions as zero-value stubs): `got {Removed:[] …}, want Removed=[KPTI]` (6 of 7 fail) →
  green: 7 PASS. `go build`, golangci-lint 0 issues.

### Step 21 — test: removal repository (pgxmock and real database) — done
- pgxmock run → 7 PASS; `go vet -tags dbtest` passes; `go_gate xstockstrat-portfolio` → 0 lint issues,
  all packages ok under `-race`, total 79.1%.
- **Skipped locally: all 9 real-database (`dbtest`) tests** (`PORTFOLIO_DB_TEST_URL` unset; no database is
  started to verify a step). The removal SQL is exercised only through pgxmock until CI's
  `portfolio-db-test` job runs on the integration PR — watch that job.
- The "partial result" database case seeds its two system-managed lists under two users (one user has one
  system-managed list).

### Step 22 — service: portfolio's delisting tick (unit 22+23) — done
- New `internal/service/delisting_sync.go`; `signal_prune.go`, `portfolio_service.go`, service `CLAUDE.md`,
  `docs/context-constitution.md` (PORTFOLIO-18). Greps for `syncDelistings`, `HeaderInternalCaller` and
  no-`emitEvent` pass; `check-context-map.py` OK.
- With an empty union or an empty removal set the sync RPC and the store call are still made (the repo
  no-ops on empty input).
- Alert wording (A-6): `"<SYM> is delisted (<REASON>, first unservable <date>). Removed from N
  system-managed watchlist(s): <names>."` + either `" N more system-managed watchlist(s) still hold it and
  will be updated on a later refresh."` or `" It was on no system-managed watchlist."`; a re-delivery
  starts with `"This may repeat an earlier alert. "` and names only this tick's lists.

### Step 23 — test: the delisting tick (unit 22+23) — done
- TDD: AC-6 red (`syncDelistings` returning at once): `store asked to remove [], want [[KPTI]]` (14 of 16
  fail) → green with `-race`: 16 PASS; existing `SignalPrune` tests unchanged. `go_gate` 79.1%.
- Test doubles: `delistingMarketData` wraps `stubMarketData` and `delistingNotify` wraps `recordingNotify`
  (the base stubs live in `portfolio_service_test.go`, outside the unit's `**Files**`). The timeout case
  drives `pruneOnce` with a 20 ms parent context because the 15 s deadline is a constant.

### Step 24 — service: decorate every watchlist response; filter the cross-user enumeration — done
- Twelve return sites decorated (11 matching lines — `ListWatchlists` is one call after the 351 ensure
  block); `ensureSignalListOnFirstPage` and `offline_valuation.go` not edited. Build, lint and
  `TestListWatchlists351_` pass.
- A first version filtered the store's slice in place (`slices.DeleteFunc`); the Step 25 AC-8/AC-4 tests
  caught it and it was fixed (filter into a new slice) before this commit.

### Step 25 — test: decoration parity across every watchlist RPC; enumeration filter — done
- TDD: red (helpers empty): all 12 parity rows fail with `ROKU delisted = <nil>`, as do AC-7, AC-19,
  AC-16, AC-8, AC-4 and the caller-supplied-state case; the AC-10 guard passes as specced → green with
  `-race`: 8 PASS; existing `ListAllWatchlistSymbols` and `TestListWatchlists351_` tests pass. `go_gate`
  79.1%.
- Instruction 1a followed (lists located by id; ensure page and `ensureErr` fail-open page both asserted).
- Known weakness, as specced: the AC-10 guard reuses `valuationCase.run()`, which calls the pure
  `valueOffline` and cannot see the service cache — it fails only if valuation is restructured to consult it.

### Step 5 — migration: marketdata `010_symbol_profile` — done
- `010` re-derived as free on every origin ref. TDD: N/A (migration). Verified offline: up/down pair,
  highest number, 5 `CHECK`s, down drops what up creates, only the `marketdata` schema. No database started.

### Step 6 — service: `ProfileRepo` — done
- `internal/repository/profile_repo.go`: 12 methods + 2 private helpers, no `Begin(`. Build and lint clean.
- Beyond the step text: `Candidates` is one statement (`bool_or(watched)` over a `UNION ALL`) so the list
  and the watched count share a snapshot; methods taking a symbol list return early on an empty list
  (`ReplaceWatched` does not).

### Step 7 — test: `ProfileRepo` (pgxmock + dbtest) — done
- TDD: red against zero-value signatures: all 12 `TestProfileRepo_` fail (e.g. `Candidates = [], 0, <nil>`)
  → green: 12 PASS under `-race`. `vet -tags dbtest` ok; the `CI=true` run fails closed; `go_gate
  xstockstrat-marketdata` → 0 issues, total 87.3%.
- **Skipped locally: all 8 real-database `TestProfileDB_*` tests** (`MARKETDATA_DB_TEST_URL` unset). They
  first execute in CI job `marketdata-db-test` on the integration PR — watch that job.
- `TestProfileDB_ReplaceWatched` deletes foreign rows of `marketdata.watched_symbol`; the AC-27 empty-union
  case fails with a clear message if foreign rows exist.

### Step 8 — service: delisting detection hook, window reader, flagged set, recovery alert (unit 8+9+10) — done
- New `internal/service/delisting.go`; `asset_servability.go`, `marketdata_service.go`, `telemetry/otel.go`,
  `cmd/server/main.go`, service `CLAUDE.md`, `docs/context-constitution.md` (MARKETDATA-16), new
  `docs/runbooks/delisting-rollout.md` (+ index row).
- Divergence: the hook does not call `ResetUnwatched` when the watched count is 0 (the SQL guard remains
  too); the INFO line reports `skipped=empty_union`.

### Step 9 — test: detection hook, window counting, warm-set removal, recovery alert (unit 8+9+10) — done
- TDD: AC-1 red (hook body disabled): `ROKU row … (present false), want date "2026-11-09"`, 24 more
  `TestDelisting_*` fail in the same run (AC-10 is the declared guard) → green: 28 top-level
  `TestDelisting_` PASS under `-race`; `go_gate` 87.3%; 14 `@AC-` comments.
- Beyond the list: `TestDelisting_QuotaWarningKeepsItsTitleAndCategory` (guards the `emitWarning` rewrite),
  `TestDelisting_HookContextIsBoundedAtThirtySeconds`; `testdata.ServableAssetsWith(symbols...)` is
  variadic rather than single-symbol.

### Step 10 — migration: config `054` seeds `assets.delisting_confirmation_trading_days` (unit 8+9+10) — done
- `054` re-derived as free; `053` is on no origin ref yet (feature 345's claim is spec-only).
- `scripts/config-wiring-stored.json` was **generated**, never hand-edited, against a throwaway local
  Postgres 16 (operator-approved, Deviation Log): with `054` held aside the committed JSON reproduced byte
  for byte; with `054` it gains 2 rows for the key. `config-heal-dryrun.py --fresh` left
  `dryrun-fresh.tsv` unchanged. The instance was stopped and its data directory deleted; no migration was
  verified and no test was run against it.
- Wiring gate: `check-config-wiring.mjs` (step-time and `--keys …`) silent, exit 0; `--final` exit 0 with
  two `REPORTED` readers-disagree lines for other features' keys (`marketdata/fundamentals.provider`,
  `platform/trading_state`); `--doc-check` exit 0; `config-wiring.test.mjs` 75 pass.
- Config contract: namespace `marketdata`, key `assets.delisting_confirmation_trading_days`, int, default
  5, bounds [1, 30] (Step 11), seeded by config `054`, read live through the WatchConfig-backed reader.

### Step 11 — service: SetConfig bounds `[1, 30]` for the confirmation window — done
- One registry row in `configServiceImpl.ts`.

### Step 12 — test: bounds and seed-migration shape — done
- TDD: red before Step 11: `✖ rejects marketdata/assets.delisting_confirmation_trading_days just outside
  [1, 30]` (383/384) → green 384/384; lint 0 errors; coverage 92.26%.
- Seed-shape test: red N/A — the Step 10 files had already landed in the previous unit.
- Divergence: "seeded value inside the bounds" is asserted against constants in the test, because
  `SCALAR_BOUNDS_REGISTRY` is not exported.
- Noted, not changed: `prettier --check` flags `configServiceImpl.ts` and `setConfigScalarBounds.test.ts`;
  not established whether the drift predates this step (the step's verification is lint + tests).

### Step 13 — service: `SyncWatchlistDelistings` / `AckDelistingAlerts` and the inbound caller check — done
- `authz.go`, new `delisting_sync.go`, `handler/marketdata_handler.go`, service `CLAUDE.md`,
  `docs/patterns/inter-service-mtls.md`. Build, lint, 10 handler matches, `check-context-map.py` OK.
- Noted, not changed: the handler's `toGRPCError` has no `Unimplemented` mapping (nothing here returns it).

### Step 14 — test: caller check, claim states, single-snapshot rule — done
- TDD: AC-17 red against `Unimplemented` stubs: `SyncWatchlistDelistings: unimplemented` (every sync, ack
  and handler test fails) → green: 17 top-level PASS under `-race`; `go_gate` 87.3%.

### Step 15 — service: per-symbol backfill results and the `skipped` outcome — done
- `marketdata_service.go`, `delisting.go`, `telemetry/otel.go`, service `CLAUDE.md`. Build and lint clean;
  `BackfillSkipped` wired; `SymbolResults` on both responses.

### Step 16 — test: one test per loop exit arm, the invariant, the metric — done
- TDD: AC-11 red (helper returning `FAILED` for every error): `failed_symbols = [PSKY], want empty` →
  green: 11 top-level PASS; existing backfill tests ok; `go_gate` 87.3%; 6 `@AC-` comments.

### Step 32 — docs: amend the three signed-off durable scenarios (C-16) — done
- Marketdata `@AC-15 @feature-282`, platform `@AC-17 @feature-282`, portfolio `@AC-1 @feature-154`: one
  clause each, `@feature-352` added to the tag line, IDs and existing tags kept. No other scenario edited.
- TDD: N/A (docs). Verification greps pass (3 tag lines, 3 files, `@AC-15 @FR-3 @feature-282` count 1).

## Session 2026-11-17 — sdd-execute sequential, feature end

- **Integrated-tree verification** (all chains merged, before Step 32): `go_gate` marketdata 87.3% and
  portfolio 79.1% (0 lint issues, `-race`), trading `go vet`; ingest 546 passed / 87.01%, analysis 1740
  passed / 91.57%, agent 776 passed / 88.22% (ruff clean each); config lint 0 errors + 384/384 tests; UI
  lint, `tsc --noEmit`, vitest; `check-context-map.py` OK.
- **Final wiring gate** `node scripts/check-config-wiring.mjs --final` → exit 0. Output:
  `REPORTED: services/xstockstrat-analysis/app/engine/fundsignal_loop.py:marketdata/fundamentals.provider:readers-disagree`
  and `REPORTED: services/xstockstrat-trading/internal/service/trading.go:platform/trading_state:readers-disagree`
  — both are other features' keys, reported not failing.
- **Merge-order gate**: 352 is not in the blocked column of `merge-order.md`; the two rows naming it (345
  config `053`, 355 ingest `017`) make the other feature renumber if 352 lands first. The 355 row was added
  by the agent in this run by analogy with the operator's 345 ruling and is pending operator confirmation.
- **Scenario promotion (C-16)**, approved in advance by the operator ("Do both without pausing"): all 29
  scenarios promoted verbatim with `@feature-352` — marketdata 16 (AC-1, 2, 3, 4, 9, 11, 12, 13, 20, 21,
  23, 25, 26, 27, 28, 29), portfolio 7 (AC-5, 6, 7, 10, 17, 18, 22), agent 3 (AC-14, 16, 24), UI 1
  (AC-15), `platform.feature` 2 (AC-8, AC-19). No duplicates found. Ingest, analysis and config get no
  suite file: their behavior is asserted through the marketdata, agent and platform scenarios.
- **Defect reports closed**: none — no report is named in the follow-ons of the features whose scenarios
  this feature changes (282, 154).
- **Not verified locally, first run in CI**: the 17 real-database tests (Steps 7, 21); the Playwright
  suite in the CI harness (one unrelated `screener.spec.ts:43` failure locally, passed on re-run).
- **Open items for the operator**: confirm the 355 merge-order row; approvals per root `CLAUDE.md`
  § Approval Flow (DBA + service owner for marketdata `010` and ingest `018`; owner + config team for
  `marketdata`/`assets.delisting_confirmation_trading_days`); `design.md` still says ingest `017`.

- **Final `main-dev` merge (before the integration PR)**: feature 355 had merged into `main-dev` (#1567)
  with ingest `017`, so 352's `018` is correctly ordered and the 355 merge-order row is marked resolved (no
  operator confirmation needed any more). Conflicts: the append-only `insights.md` (both kept, `main-dev`
  first) and three generated ingest stubs (regenerated with the Docker codegen image from the merged
  `ingest.proto`, never hand-merged). Re-verified after the merge: ingest 602 passed / 87.16%, agent 802
  passed / 88.36%, analysis 1740 passed, marketdata and portfolio build + vet, UI lint / `tsc` / vitest 732
  passed, `check-config-wiring.mjs --final` exit 0, `ledger-guard` clean.

## Session 2026-11-17 — integration PR #1574, CI watch

- PR opened: https://github.com/davcs86/xstockstrat/pull/1574 (auto-merge, squash, enabled by the operator
  on GitHub).
- CI failure 1: `Migration rerun (idempotent replay)` — `migration-rerun: ingest should be clean at 17,
  got: 18`. `scripts/migration-rerun.py` pins the top ingest migration; bumped `17` → `18` (Deviation Log).
  The checks after that line (post-R assertions, pass 4 with marketdata `010`) had not run yet.
