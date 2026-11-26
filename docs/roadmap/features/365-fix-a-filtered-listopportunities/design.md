# Design: fix-a-filtered-listopportunities

**Created**: 2026-11-26
**Rounds**: 2 (full; termination: approved)
**Approved by**: user @ 2026-11-26 (operator decision at the design gate: approve the round-2 design as synthesized — `elif not await opps.has_fresh(user_id)`; manual recompute out of scope; merge 365 before 366. Floor clear.)
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

**Production change (one line plus a comment, D-1/D-5).** In `_read_opportunity_queue`
(`services/xstockstrat-analysis/app/handlers/servicer.py:4758-4828`, recon.md:20), the bare
`else:` of the no-rows branch at servicer.py:4790 (recon.md:23) becomes
`elif not await opps.has_fresh(user_id):`. The cold and all-stale body keeps its current
indentation and runs unchanged.

- A constraint comment of at most 2 lines goes on the `elif` line. It names the case that falls
  through: "fresh-but-filtered-empty falls through deliberately: no kick, empty page (365 FR-1);
  reached only when the user has no fresh row."
- The comment at servicer.py:4792, "every no-rows branch revalidates in the background"
  (recon.md:23, recon.md:91), becomes false. Drop it, or reword it to "cold or all-stale:
  revalidate in the background".
- Reuse `OpportunitiesRepository.has_fresh` (`app/repositories/opportunities.py:340-348`,
  recon.md:32, recon.md:42). Production code does not call it today. Add no new repo method and
  no new SQL.

**Resulting behaviour.**

- **Fresh rows exist but the filter matches nothing (FR-1, AC-1/AC-2).**
  - `rows` stays the empty filtered fresh read (servicer.py:4765-4774, recon.md:21) and every `q`
    flag keeps its default (`_OpportunityQueueRead`, servicer.py:516-526, recon.md:27).
  - There is no kick, `computing` and `compute_failed` are false, and `served_include_expired` is
    False.
  - So the source facet (servicer.py:4824-4828, recon.md:26) stays on `include_expired=False`, and
    the feature-190 O7 facet-freshness pairing holds.
- **The user has no fresh row (FR-2, AC-3/AC-4).** The existing body runs byte-for-byte:
  - `count_for_user` (4791);
  - `q.kick_full = True`, still set before the state read (4792 vs 4798, recon.md:85);
  - then the cold path (4793-4806, recon.md:24) or the all-stale path (4807-4819, recon.md:25).
- **Statement order.** `has_fresh` runs before `count_for_user`, not instead of it.
  - On the pooled path it uses the same budgeted connection: `OpportunitiesRepository(bc)` is
    built at servicer.py:611/4703, and `BudgetedConn.fetchval` exists at
    `app/repositories/read_budget.py:52`.
  - This keeps ANALYSIS-14 intact (recon.md:18, recon.md:32, recon.md:93).
- **Where the kick fires does not move.** The gate changes only *whether* `q.kick_full` is set.
  The kick still fires in the caller's `finally`, after the connection is released
  (servicer.py:4721-4725, recon.md:19, recon.md:49).

**Consumer surfaces (C-14).** There is no caller code change (recon.md:75-77).

- `xstockstrat-ui` `/trader/positions/[symbol]` polls `useOpportunities` every 15s with a symbol
  filter. With this fix that poll no longer triggers a full recompute against a fresh queue.
- The agent MCP `list_opportunities` tool gets the same read semantics. It loses the
  `min_conviction=1.01` side effect, which forced a recompute (D-2).
- No proto, migration, config or cross-service change is needed (recon.md:68-75).

**Single step, test-first.** The step's Files list must name every item below.

- **(a) `tests/test_list_opportunities_deadlines.py`: kick-spy tests on both the pool and no-pool
  paths.** These use the `read_path` fixture and the `_record_kicks` spy (recon.md:44). The test
  plan follows D-6.
  - **`_FakeOppRepo` is not filter-blind.** It applies `include_expired`, the `min_conviction`
    floor and DISMISS/SNOOZE, and ignores only `sources`, `action_filter` and `symbol`
    (tests/test_analysis_servicer.py:4531-4557). Its `has_fresh` is a real implementation
    (:4515-4517). This corrects recon.md:43.
  - **Unpatched, seeded fake.** AC-1 (fresh rows, `min_conviction=1.01`), AC-3 (no rows) and AC-4
    (stale rows only, `min_conviction=1.01`) run over the unpatched fake, with rows seeded by
    `_row(fresh=True/False)`.
  - **Patch only for AC-2.** AC-2 (a symbol filter, which the fake ignores) is the only test that
    patches the `include_expired=False` read. Override `has_fresh` only where the seeded rows
    cannot express the case.
  - **All-dismissed/snoozed case.** Seed fresh rows plus DISMISS/SNOOZE actions in `fake.actions`
    and assert no kick. No patch is needed.
  - **`valid_until` and follow-up-read Then clauses (O-6).** Kick-spy tests never run a recompute,
    so they cannot check these clauses of AC-1..AC-4. Either:
    - add one real-kick test for AC-3/AC-4 (stub `_compute_opportunities` and drain
      `_opportunity_recomputing`, as in `tests/test_opportunity_compute_state.py:76-98`); or
    - state in the step's Verification that "kick called / not called" is the accepted proxy for
      those clauses.
- **(b) `tests/test_opportunity_compute_state.py:45-53` `_opp_svc()`.** Add
  `svc._opportunities_repo.has_fresh = AsyncMock(return_value=False)` so the feature-185
  @AC-6/@AC-7 guards stay green (O-1).
- **(c) `tests/test_opportunities_repo.py:657-668` stub.** Add
  `has_fresh = AsyncMock(return_value=False)`. The stub is a plain `MagicMock`, so without this the
  `await` raises TypeError (recon.md:83, O-1).
- **(d) `tests/conftest.py:298`.** Set `_BC_METHOD_FOR` to
  `{"count_for_user": "fetchval", "get": "fetchrow", "has_fresh": "fetchval"}` (O-3, O-7).
  - This routes `has_fresh` through `fetchval`, so the `raise_on={"fetchrow": ...}` injection in
    `test_compute_state_timeout_kicks_once_then_unavailable` (:331-337) still hits the state read.
  - Optionally pin "a `has_fresh` timeout gives UNAVAILABLE with no kick", which matches today's
    `count_for_user`-timeout behaviour (recon.md:87).
- **(e) `tests/test_opportunities_repo.py`: one `real_pg` test of
  `OpportunitiesRepository.has_fresh` (O-2, O-8).**
  - A fresh row gives True; only expired rows gives False.
  - The fresh-plus-DISMISSed case is labelled a D-3 pin, not a behaviour test: the SQL never reads
    `opportunity_actions`.
- **(f) `services/xstockstrat-analysis/docs/opportunities.md:7`.** Change the feature-215
  symbol-filter sentence to say the stale (`include_expired=True`) read runs only when the user
  has no fresh row (O-4).
- **(g) This feature's `context.md`.** Record two things (O-5):
  - D-2: a manual recompute/invalidate path is out of scope.
  - The D-4 constraint: one compute stamps a single `valid_until` on every row it writes. Flag it
    as an input for 366's design.

Also confirm green, unchanged: `test_g3_fresh_empty_stamp_sets_neither_flag_and_kicks` (:168) and
`test_g5_stall_at_every_stage...` (:207) (recon.md:84, recon.md:86).

Verify: from `services/xstockstrat-analysis`, `uv run pytest --cov=app --cov-fail-under=40` plus
`ruff check` (recon.md:115).

**Scope decision (D-2, operator default).** A deliberate manual-recompute or invalidate path is
**out of scope**. Removing the `min_conviction=1.01` side-effect lever is intended, and any
replacement is a separate `/sdd-story`.

**Merge order (D-4).** 365 merges before 366-opportunity-live-only-rotation. 366 rebases over one
`elif` line plus its comment.

## Rejected Alternatives

- `R-1` A fused repo method returning `(has_fresh, count)`. Rejected because it nearly duplicates
  two existing helpers (C-18/DRY) to save one round-trip on a rare path.
- `R-2` Gating the kick on "the request carries any filter". Rejected because it stops the kick for
  cold or all-stale filtered reads, which breaks FR-2 AC-3/AC-4.
- `R-3` A filtered `include_expired=True` fallback read when the filtered fresh read is empty.
  Rejected because it diverges from the unfiltered fresh read and breaks the feature-190 O7
  facet-freshness pairing.
- `R-4` A production `is True` check on `has_fresh` to dodge the MagicMock-truthy trap. Rejected
  because it bends production code to a test mock; stub `has_fresh` in the fakes instead.
- `R-5` An explicit `if await opps.has_fresh(...): pass` with the body moved under `else:`.
  Rejected because it re-indents about 30 lines and enlarges 366's rebase; `elif` with a comment on
  the same line is just as visible.
- `R-6` Blanket test patching, with the fresh read forced to `[]` and `has_fresh` overridden in
  every scenario. Rejected because it gives up the fake's real filtering and risks a vacuous green
  (fails.md:801/1649/2656).

## Open Risks

- [ ] **Mixed freshness (D-3).** A symbol whose only row is a stale leftover from a heal now shows
  "no opportunity" on `/trader/positions/[symbol]`. Nothing revalidates it until the per-symbol
  heal or the daily refresh (servicer.py:5204-5217, 5311-5320; recon.md:37, recon.md:88).
  - The window is rare only while one compute stamps a single `valid_until` (D-4).
  - To be addressed at: the step's Verification (accepted behaviour, pinned by (e)), and
    re-evaluated in 366's design if 366 breaks D-4.
- [ ] **All-dismissed or all-snoozed fresh rows no longer kick (recon.md:89).** This is accepted,
  because a recompute cannot clear a disposition.
  - To be addressed at: step 1, test (a), the dismissed/snoozed no-kick case.
- [ ] **No no-DB way to force a recompute.** Removing the `min_conviction=1.01` lever leaves none,
  and there is no replacement RPC (D-2).
  - To be addressed at: out of scope; a separate `/sdd-story` if wanted.
- [ ] **Merge coupling with 366,** which edits `_compute_opportunities` and queue persistence in the
  same servicer. 366 must preserve the `elif` fall-through and the single-`valid_until`-per-compute
  constraint.
  - To be addressed at: merge time (365 first), with the D-4 constraint flagged in 366's design.
- [ ] **A `has_fresh` timeout on a cold read drops the kick,** the same as a `count_for_user`
  timeout today. No test pins this unless the optional test in (d) is added.
  - To be addressed at: step 1, item (d), optional test.

## Constitution Rules Touched

- `C-01` — honored by: the change stays inside xstockstrat-analysis and its own repository, with no
  cross-service or schema reach.
- `C-08` — honored by: `has_fresh` runs on the same budgeted read connection through `fetchval`,
  and the test harness maps it to `fetchval` (item (d)). Timeout behaviour matches today's
  `count_for_user` path.
- `C-11` — honored by: full-mode debate with recon grounding, a design-phase approval gate and a
  recorded operator decision; the ledger was checked.
- `C-13` — honored by: tests reuse the existing fixtures (`_FakeOppRepo`, `_row`, `_record_kicks`,
  `read_path`), with no new ad-hoc mocks beyond the `has_fresh` stubs.
- `C-15` — honored by: every AC-1..AC-4 maps to a named test. The kick-spy proxy for the
  `valid_until` Then clauses must be explicit in Verification, or one real-kick test is added
  (O-6).
- `C-16` — honored by: Business Rules Touched below. The CHANGE rows cite the operator decision.
- `C-18` — honored by: an existing repo helper is reused (no new SQL; R-1 rejected), and the
  constraint comment is at most 2 lines on the `elif` line.
- `P-05` — honored by: context.md records D-2, D-4 and the open risks as they happen.
- `P-06` — honored by: the test plan corrects the proposal's "fake does not filter" claim against
  the verified fake (D-6).
- `F-04` — honored by: every cited path:line was verified in recon or during the round-2
  synthesis. Recon.md:43's stale claim is corrected here, not repeated.
- `F-06` — honored by: there is no Floor breach and no unresolved blocking objection.
- `F-08` — honored by: every test item names its target file ((e) names
  `tests/test_opportunities_repo.py`).
- `ANALYSIS-14` — honored by: the extra query uses `fetchval` inside the budgeted read, and the
  kick still fires after release.

## Business Rules Touched (C-16)

- CHANGE `@AC-1` "A filtered read with no matches leaves a fresh queue untouched" (this feature's
  `acceptance.feature`). Altered guarantee: a filtered-empty read over a fresh queue no longer
  kicks. Signed off by the operator @ 2026-11-26 (context.md OPERATOR DECISIONS: root-cause
  decision, plus the design-gate approval of the `elif not await opps.has_fresh` design).
- CHANGE `@AC-2` "A symbol-filtered read for a symbol absent from a fresh queue does not recompute"
  (this feature's `acceptance.feature`). Altered guarantee: the `/trader/positions/[symbol]` 15s
  poll no longer recomputes. Signed off by the operator @ 2026-11-26 (same operator decisions).
- PRESERVE `@AC-3` "A cold read with no materialized queue still revalidates in the background" —
  not regressed: when `has_fresh` is False the cold path runs byte-for-byte.
- PRESERVE `@AC-4` "A filtered read over an all-stale queue still revalidates in the background" —
  not regressed: when `has_fresh` is False the all-stale path runs byte-for-byte, still serving
  stale rows and still kicking.
- PRESERVE `@AC-6 @feature-185` "A cold read is non-blocking and distinguishable from an empty
  universe" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`) —
  not regressed: the cold path is unchanged, and `_opp_svc` stubs `has_fresh=False` (item (b)).
- PRESERVE `@AC-7 @feature-185` "A persistently-failing cold compute renders a terminal error, not
  an infinite spinner" (same file) — not regressed: the `compute_failed` semantics on the cold
  path are unchanged (item (b)).
- The other PRESERVE rules listed at recon.md:55-64 (feature 185 @AC-8, 177 @AC-4, 190
  @AC-1/4/6/11/13, 227 @AC-1/4, 330 @AC-2) are untouched by the same arguments.
  - The `if rows:` heal branch and the filter semantics are unchanged.
  - The empty page keeps the `include_expired=False` facet and `next_page_token` "".
  - The extra query stays in the single budgeted connection.

## Rounds

- **Round 1 (full).** Added D-1..D-4 and R-1..R-4, and opened O-1..O-5 (O-1 blocking: the
  `has_fresh` stub blast radius).
- **Round 2 (full).** Added D-5/D-6 and R-5/R-6. Closed O-1..O-5, all adopted into the step's
  Files list. Opened O-6..O-8 (non-blocking test-plan refinements, folded into the Chosen
  Approach). The adversary returned SOUND, with no Floor breach.
- **Termination: approved.** The operator approved the round-2 synthesis at the design gate on
  2026-11-26. No reopen petitions were filed.
