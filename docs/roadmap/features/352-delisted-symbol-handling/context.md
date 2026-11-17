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
