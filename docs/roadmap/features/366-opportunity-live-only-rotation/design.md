# Design: opportunity-live-only-rotation

**Created**: 2026-11-26
**Rounds**: 5 (full; termination: approved, after the operator approved at the design gate with the Floor clear)
**Approved by**: user @ 2026-11-26 (operator decision at the design gate, round 5: "Approve")
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-16, R-1..R-16, O-1..O-25)

---

## Chosen Approach

This is the round-5 synthesis. It honors D-1..D-16 and the operator decisions on O-5, O-6 and O-12, and
it brings back none of R-1..R-16. All code paths below are under `services/xstockstrat-analysis/`.

**Consumer surfaces (C-14).** The change reaches `xstockstrat-ui` `/insights/opportunities` and
`/trader/positions/[symbol]`, and the `xstockstrat-agent` tool `list_opportunities`. It reaches them
only through the existing `ListOpportunities` rows and their per-row `valid_until` ("expires") field.
No proto change and no UI or agent code change (recon.md:6, recon.md:107). The visible effect is that
more live-covered signal symbols carry their live-strategy rows over successive computes.

### 1. Chunk and cursor (D-1, D-5; operator decisions O-6 and O-12)

- Step 2b replaces the conviction sort and the `[:max_live_only]` slice (recon.md:21-26). The chunk is
  taken from `pool = sorted(competitive_pool)`. It starts at `bisect_right(pool, cursor)`, wraps to 0,
  and reuses the identity-resume algorithm of `live_loop.py:459-510` (recon.md:60-66). The cursor is
  the last-evaluated normalized symbol. An empty pool leaves the cursor untouched and writes nothing.
- `opportunity.max_live_only_symbols_per_compute` (`int_positive`, default 20) becomes the per-compute
  chunk limit. It wins over the cycle bound (R-1 is locked).
- The cursor advances on **every** compute, including read-driven stale and cold kicks (operator,
  'Every recompute').
- The FR-2a shortfall is computed from the full pool before chunking (recon.md:67, recon.md:141). It
  is logged at INFO and labelled in computes. It fires only when (pool bucket, N, cycle_days) changes.
  At homelab scale (about 350 symbols, N=20) the shortfall is the expected default outcome, not an error
  (operator, 'Accept both').
- New key `opportunity.live_only_cycle_max_days` (int, default 3, bounds [1,30]) is read once per
  compute with `int_positive` (recon.md:69, recon.md:113).

### 2. Carried rows (D-4, D-6, D-10, D-12, D-15)

A stored row from an earlier chunk is carried into this compute's replace only when **all** of these
predicates hold. All of them are evaluated before step 3 (recon.md:27):

- **(a)** The row is live-only by provenance.
- **(b)** `sym` is in `competitive_pool` and not in this compute's chunk. `competitive_pool` already
  excludes held symbols (`- held_norm`, recon.md:23-24).
- **(c)** `strat in _capped_live(sym) and (sym, strat) not in denied_covered_set`, where
  `denied_covered_set = set(denied_covered)` is built once after `servicer.py:5455` (D-15).
  - For a non-held `sym`, this holds exactly when `sym` is in `resolved.universe` for that strategy,
    including the blend (`live_loop.py:147,150,155-156`). This restores D-6's universe test with no
    second `resolve_universe` pass (R-15).
  - The `_capped_live` half (recon.md:18) takes cap slots in the same pre-deny order as the fresh path,
    so the FR-7 per-symbol cap holds on carried rows.
  - A carried pair that becomes denied is rejected here, before `carried_symbols` is built, so it
    cannot collide with the step-5 muted placeholder on the opportunities PK (R-2).
  - The non-held precondition rests on **both** (a) and (b). The spec documents that dependency.
- **(e)** The row is kept only while `valid_until > now AND now - computed_at < cycle`. A row aged
  exactly one cycle is dropped (`>=`), which pins the FR-8 boundary (recon.md:129). The age clause
  matters only after `cycle_max_days` is lowered, and it must not be deleted as dead code.
- **(f)** Three-way action check (D-10). Drop the row when the current signal resolves to no action
  (`_resolve_action_tag(...) is None`). Keep it without comparing when its provenance holds
  `fundamentals_unavailable` or `formula_unreadable` (the stored UNSPECIFIED override). Otherwise
  require the current action to equal the stored action. `best_direction_by_symbol` is built before
  step 3 with step 3's tie rule.

Composition:

- `carried_symbols` is built from the pre-step-3 predicates only. Step 3 suppresses the `(sym, "")`
  row only for those symbols (D-12; recon.md:139).
- Carried rows are appended after step 5, the universe cut and the validity stamp (recon.md:28-30), and
  before the `symbol_score` fold. A fresh row wins on an `opportunity_key` collision (D-6). The dedup
  removes a carried row only on such a collision.
- A carried row keeps its stored `computed_at`, `valid_until` and `composite_score`. It joins the
  `symbol_score` fold (D-4).
- Dispositions survive with no extra work, because they are joined at read time by `opportunity_key`
  (D-9). Carried rows count in `GetStrategyAnalytics` queue_share with no rule change (D-8).
- If the carried-rows read fails, the whole compute fails, and the previous queue, carried rows and
  cursor stay intact (D-3; recon.md:85-86).

### 3. Validity stamp (D-7; operator decision O-5)

- A fresh live-only row is stamped `valid_until = now + cycle_days × 24h`. This overrides
  `opportunity.valid_window_hours` for live-only rows, with no 168h cap (operator, 'Accept both').
  Other rows keep `session_end + window_hours` (recon.md:30). This resolves recon risk R-1
  (recon.md:121-129) with option (b).
- The heal (`replace_symbols`, recon.md:41) applies the same live-only stamp to live-only rows and
  resets their age (recon.md:138). `replace_symbols` never writes the cursor, because the heal does not
  advance rotation.

### 4. Read side (D-11, D-14, D-16; composes with 365)

`_read_opportunity_queue` (recon.md:33-37) replaces any `has_expired` idea (R-4, R-8, R-10) with one
`opps.read(include_expired=True, same filters)`, split in Python:

- **(i)/(ii)** Any in-scope expired row that is not live-only selects today's stale branch.
- **(iii)** Fresh with no expired rows: serve the `include_expired=True` rows as read, and run the
  185 @AC-8 heal.
- **(iv)** Fresh with expired rows, which can only be expired live-only rows: re-issue today's
  unchanged `include_expired=False` read, sequentially on the same budgeted connection (ANALYSIS-14),
  and run the 185 @AC-8 heal. It never sets `kick_full` (R-14). A branch's rows are always served from
  a read whose WHERE matches that branch, never Python-filtered (D-14, R-11, R-12).
  - Branch (iv) is the documented routine steady state. Under a 3-day cycle and a daily refresh, about
    one chunk sits expired for roughly 24 h.
  - Branch (iv) increments a new label-free module-level `Counter("analysis.opportunity.read_reissue")`
    beside `_OPPORTUNITY_RECOMPUTE` (`telemetry.py:444-446`), through a named helper (R-16).
- **(v)** No rows: fall through to 365's no-rows branch, `elif not await opps.has_fresh(user_id):`.
- The predicate-(e) lookahead is not adopted (operator, 'Accept ~24h gap'). Expired live-only rows are
  hidden from fresh reads until their next compute.

### 5. Atomic persist (D-2, D-13; recon.md:31, recon.md:136)

- `_compute_opportunities` returns `(rows, new_cursor)`. Its callers at `servicer.py:4952-4953` and
  `:6070-6071` take the pair.
- `_replace_and_stamp_compute_state(..., cursor=None)` (recon.md:31, recon.md:73) opens one
  `pool.acquire()` and `conn.transaction()`. Inside it, in order:
  - `replace_for_user(conn=conn)` (recon.md:40). Its INSERT binds `COALESCE($14::timestamptz, now())`.
    A fresh row passes `None`, and a carried row passes its stored `computed_at`.
  - `write_cursor(conn)` when the cursor is not `None`. The first insert uses
    `valid_until = to_timestamp(0)` (R-6), and `ON CONFLICT` updates only `live_only_cursor` (D-13), so
    the empty-universe freshness gate (recon.md:131-135) is never clobbered.
- The feature-177 empty-universe upsert stays best-effort, outside and after the transaction (operator,
  'Keep best-effort'). It sets only `computed_at` and `valid_until`, so it cannot clobber
  `live_only_cursor`.
- An all-sell pool yields `rows == []` with a non-null cursor. The cursor still advances and the empty
  stamp still applies.
- The no-pool injected path (`servicer.py:4710`) passes `conn=None`. The test fakes at
  `tests/test_analysis_servicer.py:4501` and `:5778` (recon.md:76) gain a `conn` kwarg.
  `compute_state.get` (recon.md:45-47) selects `live_only_cursor`.

### RED tests (P-06)

Each of these tests is written red first:

- The rotation order, wrap and churn tests (AC-1..AC-12).
- An invariant test that every pool symbol has at least one row.
- The signal-flip keep and drop tests for (f).
- A real_pg cursor decode and no-clobber test (D-13).
- A real_pg atomicity and restart test (recon.md:79).
- **Deny:** a carried `(AAPL, squeeze_breakout_trend)` row whose strategy then denies AAPL leaves
  exactly one row for that `opportunity_key`, the muted placeholder. The test also asserts that the
  `(AAPL, "")` row has parity with a never-carried denied non-chunk symbol.
- **Held, denied and carried:** a held, denied symbol with a carried row present drops the carried row.
  The test is documented as pinning predicate (b), not only (a).
- **All-sell pool:** the cursor advances, the empty stamp applies, and `live_only_cursor` survives the
  upsert.
- **Mixed binds:** a real_pg `executemany` with mixed `None` and datetime `$14` values. The new INSERT
  is added to the bound-param-referenced guard (`tests/test_opportunities_repo.py:236+`, recon.md:78).
- **Lowered cycle:** lowering the cycle from 5 to 3 drops a 4-day-old carried row.
- **Re-read counter:** `read_reissue` increments on branch (iv) only.
- A parity test pins `best_direction_by_symbol` against step 3's iteration order and strict `>`.

### Touchpoints

- **Migrations** (both numbers are re-derived at `/sdd-spec`, recon.md:108-111):
  - analysis `030`: `ADD COLUMN live_only_cursor TEXT NULL`, with a down migration that drops it.
  - config `056`: seeds `opportunity.live_only_cycle_max_days` = 3.
- **Config:** add the bounds entry `{1,30}` next to `configServiceImpl.ts:137` (recon.md:54, recon.md:72).
  Add rows to `tests/test_config_zero_clamps.py:61` and `tests/test_config_read_classification.py:56`
  (recon.md:81).
- **Docs (C-05):**
  - `services/xstockstrat-analysis/CLAUDE.md:274` and `:295`, and the `valid_window_hours` row (the
    live-only override).
  - `services/xstockstrat-analysis/CLAUDE.md` § Observability: the `read_reissue` instrument, and the
    exact message text of the shortfall log.
  - `docs/patterns/config-governance.md:538` (cap becomes chunk limit; `get_int` becomes
    `int_positive`), plus a row for the new key.
  - `services/xstockstrat-analysis/docs/opportunities.md:7` (branches (i)-(v), the cursor transaction,
    and the steady-state note on (iv)).
  - `docs/patterns/database.md`, if it lists the `opportunity_compute_state` columns.
- No proto change and no new inter-service edge (recon.md:107, recon.md:116).
- **Sequencing:** the rebase order is 365, then 308 and 330, then 366 (recon.md:137). O-7 is the
  `/sdd-spec` gate.

## Rejected Alternatives

- `R-1` Derive the per-compute live-only limit from `ceil(pool/cycle_days)`. Rejected because it
  contradicts the operator's FR-2a ruling that the per-compute limit wins, and it lets the trace cost
  grow with pool size.
- `R-2` Test carry eligibility only through `_new_live_strats` / `live_by_symbol` (`resolved.union`).
  Rejected because that includes deny-listed strategies, which collide on the opportunities PK with the
  step-5 muted placeholder.
- `R-3` Divergent per-row validity with no read-side staleness trigger. Rejected because the
  full-recompute kick fires only on a no-rows fresh read, so a partially stale queue never revalidates.
- `R-4` An unscoped `has_expired`, where any expired row of the user selects the stale branch. Rejected
  because it disables the 185 @AC-8 surgical heal, and it lets out-of-scope rows flip a filtered read.
- `R-5` Carry eligibility on signal presence alone, with no action-consistency check. Rejected because
  the action is recomputed each pass from the current direction, so a carried row could keep an action
  the current signal contradicts.
- `R-6` A `'-infinity'` `valid_until` sentinel on the first cursor insert. Rejected because its asyncpg
  decode is unverified at the `servicer.py:4799` comparison and risks a TypeError. `to_timestamp(0)` is
  timezone-aware and safe under clock skew.
- `R-7` A "last successful compute" stamp on compute_state as the read-side staleness trigger. Rejected
  because it costs the same query and contradicts D-2's cursor-only on-conflict upsert.
- `R-8` A `has_expired` EXISTS sharing an extracted `read()` WHERE builder, called only in the rows
  branch. Rejected because it misses the no-rows branch, where 365's `has_fresh` turns true under the
  D-7 stamp, and it refactors the placeholder-anchored `read()` SQL.
- `R-9` Strict stored-action equality as carry predicate (f). Rejected because it drops carried 215
  `fundamentals_unavailable` and 289 `formula_unreadable` rows, whose stored action is the UNSPECIFIED
  override.
- `R-10` Scoping 365's `has_fresh` instead of testing for in-scope expired rows. Rejected because it
  rewrites 365's predicate after 365 lands, and it cannot tell an expired in-scope row from an absent
  one.
- `R-11` A Python re-sort of the fresh rows that mirrors `_SORT_ORDER_BY`. Rejected because it
  duplicates four SQL orderings that would drift (DRY), and the second read is cheap at queue sizes of a
  few hundred rows.
- `R-12` `MAX(...) FILTER (WHERE valid_until > now()) OVER (...)` inside `read()`. Rejected because it
  changes the stale branch's ordering and edits the placeholder-anchored `read()` SQL that R-8 guards.
- `R-13` A read-path DELETE of expired live-only rows. Rejected because it puts writes on the budgeted
  read-only DB phase (ANALYSIS-14) and races `_opportunity_lock`.
- `R-14` Setting `kick_full` in read branch (iv). Rejected because every expiry kick schedules another
  one a cycle later. The chains never merge, so the compute rate grows without bound, and each kick
  advances the cursor (O-12).
- `R-15` A second `resolve_universe` pass, or a per-strategy `resolved.universe` dict, for predicate
  (c). Rejected because it duplicates state that `denied_covered` already holds (C-18 DRY) and costs an
  extra pass. The set lookup is exact because carried symbols are non-held under (a) and (b).
- `R-16` A rate-limited per-user INFO log, instead of a counter, for the branch-(iv) re-read. Rejected
  because (iv) is the steady state on a 15 s poll, so a log line is noise. The Counter wrapper costs
  nothing extra and swallows errors.

Also considered, not locked: a predicate-(e) lookahead that treats rows expiring within one refresh
interval as expired. It is not adopted (operator, 'Accept ~24h gap'), and the operator may revisit it.

## Open Risks

- [ ] O-7: verify the carried-row re-INSERT against the 308 diff (R-4: no failure path may drop held,
  watchlist or muted rows), the 330 diff (live-enrich TTL, same function) and the 365 diff once it
  merges. 366 edits the head of `_read_opportunity_queue`, which 365 has just rewritten. To be
  addressed at `/sdd-spec` (gate), after rebasing 365, then 308 and 330.
- [ ] O-24 (C-05 / FR-2a): list `analysis.opportunity.read_reissue` in CLAUDE.md § Observability, and
  record the exact text of the D-5 shortfall log, because operators alert on that text. To be addressed
  at the `/sdd-spec` docs step.
- [ ] O-25: a failed empty-universe stamp after a committed cursor advance leaves each poll recomputing
  and advancing the cursor until a stamp succeeds. This is the existing 177 behaviour, amplified by
  O-12. The operator chose 'Keep best-effort' as the default. To be addressed when `/sdd-spec` records
  the residual as accepted.
- [ ] Branch (iv) is the common steady state, so most polls run two reads on the budgeted connection.
  `read_reissue` measures the cost but does not bound it. To be addressed at the read-side step
  (counter plus docs).
- [ ] Expired live-only rows are invisible for about 24 h between their expiry and the next compute that
  reaches their chunk. This is an accepted residual (operator, 'Accept ~24h gap'). To be addressed at
  the docs step (`opportunities.md`).
- [ ] Predicate (c)'s deny equivalence relies on carried symbols being non-held, which (a) and (b)
  guarantee. A later change to either predicate could let a held, denied pair through. To be addressed
  at the compute step (the held+denied RED test).
- [ ] Freshness is judged by the app clock, not DB `now()`, so app/DB clock skew shifts the boundary.
  The same trade-off is already accepted at `servicer.py:4799`. To be addressed at the compute step
  (documented only).
- [ ] D-3 fails closed: a transient error on the carry read also blocks that compute's held and
  watchlist refresh. To be addressed at the compute step (356 @AC-5/@AC-10 tests).
- [ ] `best_direction_by_symbol` stays correct only while step 3 keeps its iteration order and its
  strict `>`. To be addressed at the compute step (parity test).
- [ ] After `cycle_max_days` is lowered, rows stamped under the old, longer cycle stay visible on fresh
  reads until the next compute (`opportunities.py:233`). To be addressed at the docs step plus the
  lowered-cycle RED test.

## Constitution Rules Touched

- `C-16`: honored. The 131 @AC-8 truncation CHANGE carries operator sign-off (context.md, 2026-11-26),
  and every other affected `@AC` is PRESERVE or an operator-covered EXTEND (see below).
- `C-05`: honored. The new key is stored namespace-relative as `opportunity.live_only_cycle_max_days`,
  seeded by config migration `056`, and read with `int_positive`. The doc touchpoints above (`CLAUDE.md:274`
  and `:295`, § Observability, `config-governance.md:538`, `opportunities.md:7`) keep the docs in step.
  O-24 tracks the Observability entries.
- `C-08`: honored. Every service step gets a paired test step. The RED list above names the behaviours
  those tests must cover.
- `C-11`: honored. The feature went through `/sdd-story`, an approved product spec, and a 5-round full
  design. Forks were raised to the operator at each gate (rounds 3-5) and recorded in context.md.
- `C-18`: honored. Predicate (c) reuses `denied_covered` (R-15), the persist goes through the single
  `_replace_and_stamp_compute_state` helper, and no ordering SQL is duplicated (R-11). The design adds
  no speculative options.
- `P-02`: honored. The proposer and the adversary exchanged state only through the mediated synthesis.
- `P-03`: honored. Every claim cites code or recon.md, and the unread 308/330/365 diffs are escalated as
  O-7 rather than guessed.
- `P-06`: honored. The RED tests are listed above, and each one is written red first.
- `F-01`: honored. No applied migration is edited. The work adds analysis `030` and config `056`, and
  the applied 041 description seed is not edited in place.
- `F-04`: honored. No path or symbol is invented. Anything not found stays in recon.md's Not-found list.
- `F-06`: honored. The cursor write shares the existing `replace_for_user` connection and transaction,
  and the branch-(iv) re-read reuses the read's budgeted connection. No new pool or connection is added.
- `F-07`: honored. The cycle bound and the chunk limit are config keys read through `WatchConfig`, with
  no literal in source.
- `ANALYSIS-14`: honored. The branch-(iv) re-read runs sequentially on the same `BudgetedConn` using
  `fetch` only, and nothing on the read path writes (R-13).

## Business Rules Touched (C-16)

- CHANGE `131@AC-8` "live-only truncation per compute" (archived with 131 and never promoted; the rule
  text lives in `services/xstockstrat-analysis/CLAUDE.md:274` and `docs/patterns/config-governance.md:538`).
  Truncation becomes rotation across computes with carried rows. Signed off by the operator
  @ 2026-11-26 (context.md, "sdd-story" session: 'Rotate across passes', C-16 CHANGE). Both rule-text
  sites are updated, and `get_int` is corrected to `int_positive` on `:538`.
- EXTEND `366@AC-12` "carried row older than one cycle is dropped". New case: the `>=` boundary at
  exactly one cycle. Covered by the operator decision 'Keep own age, max age' (2026-11-26).
- EXTEND: live-only `valid_until = computed_at + cycle_max_days`, overriding `valid_window_hours` for
  live-only rows. Covered by the operator decision O-5 'Accept both' (2026-11-26).
- EXTEND `@AC-6 @FR-3 @feature-244` stored-zero outline (`docs/sdd/business-rules/platform.feature`).
  New row: `analysis.opportunity.live_only_cycle_max_days`, stored 0 reads as 3 (recon.md:99).
- PRESERVE `132` deny list (FR-4) "deny-listed pair removed; muted placeholder" is not regressed:
  predicate (c) rejects a denied carried pair before `carried_symbols` is built, so only the muted
  placeholder remains (the deny RED test).
- PRESERVE `131` FR-7 per-symbol live-strategy cap is not regressed: predicate (c) requires
  `strat in _capped_live(sym)`.
- PRESERVE `@AC-6` / `@AC-7 @feature-185` (cold read is non-blocking; a failing cold compute shows a
  terminal error) (`acceptance/opportunity-compute-robustness.feature`) are not regressed: the cursor
  first insert uses `to_timestamp(0)`, and `ON CONFLICT` updates only the cursor, so the empty gate is
  never suppressed (D-13).
- PRESERVE `@AC-8 @feature-185` "surgical read-time heal" is not regressed: branches (iii) and (iv) both
  run the heal (D-11, D-14), and the heal applies the live-only stamp.
- PRESERVE `@AC-1` / `@AC-5 @feature-185` (the sentinel and its round-trip) are not regressed: carried
  rows are re-INSERTed with all stored fields.
- PRESERVE `@AC-8` / `@AC-9 @feature-190` (expiry sort and symbol-group contiguity) and `@AC-13 @feature-190`
  (pagination) (`acceptance/opportunities-server-side-filters.feature`) are not regressed: rows are
  always served from a read whose WHERE matches the branch (D-14), never re-sorted in Python (R-11).
- PRESERVE `177` empty-universe compute-state stamp (best-effort; never fails the write) is not
  regressed: the stamp stays outside and after the transaction (operator 'Keep best-effort'). The
  residual is recorded as O-25.
- PRESERVE `@AC-21 @feature-289` "formula_unreadable marker round-trips storage" is not regressed:
  predicate (f) keeps marker rows without comparing actions (D-10, R-9).
- PRESERVE `215` `fundamentals_unavailable` skip row (UNSPECIFIED override) is not regressed: it is kept
  by the same (f) rule.
- PRESERVE `@AC-1` / `@AC-2 @feature-365` are not regressed: branch (v) falls through to 365's
  `elif not await opps.has_fresh(user_id):` unchanged (D-11, R-10).
- PRESERVE `@AC-1` / `@AC-2 @feature-193` (the blend is evaluated only on the fundamentals universe) are
  not regressed: predicate (c)'s equivalence holds for the blend (D-15), and the chunk draws only from
  `competitive_pool`.
- PRESERVE `@AC-5` / `@AC-10 @feature-356` (a failed compute or refresh user keeps the previous queue)
  are not regressed: a carry-read failure fails the compute (D-3), and the cursor commits only with a
  successful replace (D-2).
- PRESERVE `@AC-10 @feature-200` "symbol score is deterministic" and `@AC-7 @feature-199` "composite is
  deterministic within one pass" are not regressed: carried rows keep their stored composite and join
  the deterministic `symbol_score` fold (D-4).
- PRESERVE `@AC-5 @feature-306` "gate has no form-mismatch kind" is not regressed: the new key is read
  namespace-relative and seeded by a config migration.

## Rounds

- **Rounds run:** 5 (full mode, hard cap reached).
  - Round 1 added D-1..D-5 and R-1..R-3.
  - Round 2 added D-6..D-9 and R-4..R-7, and closed O-1..O-4.
  - Round 3 added D-10..D-13 and R-8..R-10.
  - Round 4 added D-14 and R-11..R-14, and closed 10 objections, including the operator rulings on O-5,
    O-6 and O-12.
  - Round 5 added D-15, D-16, R-15 and R-16, and closed O-18..O-23.
- **Termination reason:** approved. In round 5 the adversary returned SOUND, with no Floor breaches.
  The operator approved the round-5 synthesis at the gate ('Approve', 2026-11-26).
- **Left open, all non-blocking:** O-7, O-24 and O-25. They are carried to `/sdd-spec` as Open Risks.
- **Reopen petitions:** none were filed.
