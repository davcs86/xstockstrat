# Implementation Spec: fix-a-filtered-listopportunities

**Status**: `pending`
**Created**: 2026-11-26
**Feature**: `docs/roadmap/features/365-fix-a-filtered-listopportunities/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/fix-a-filtered-listopportunities`

---

## Execution Summary

The fix follows design.md's Chosen Approach exactly. In `_read_opportunity_queue`, the bare `else:`
of the no-rows branch becomes `elif not await opps.has_fresh(user_id):`, reusing the existing
`OpportunitiesRepository.has_fresh` (recon.md Patterns to REUSE). Steps 1 and 2 are one atomic unit.
The new `await opps.has_fresh(...)` turns three existing test harnesses red (a plain-`MagicMock`
stub raises `TypeError`; an `AsyncMock()` repo returns a truthy `MagicMock`, which suppresses the
cold-path kick). The stubs that repair them and the new RED regression tests land in the same
commit. Step 3 corrects the one doc sentence the change makes false.

There are no proto, migration, config, env-var or cross-service changes (product-spec Fix Scope;
recon.md Dependencies). The last migration stays `029_seed_fundamentals_blend_strategy`.

**Consumer surfaces (C-14).** The product spec names `xstockstrat-ui` `/trader/positions/[symbol]`
(plus a filtered `/insights/opportunities`) and the agent MCP `list_opportunities` tool. It also
states "No UI or tool code change: the response shape is unchanged; only the server-side recompute
side effect is removed." So no `xstockstrat-ui` or `xstockstrat-agent` step is needed. That is a
recorded decision, not an omission. Both surfaces get the fix through the unchanged
`ListOpportunities` RPC.

**Scenario coverage (C-15).**

| Scenario | Covered by | How |
|---|---|---|
| `@AC-1` filtered read, no matches, fresh queue untouched | Step 2 | Kick-spy test on both read paths, plus a real-kick test asserting `_compute_opportunities` is never awaited and `valid_until` is unchanged |
| `@AC-2` symbol filter for an absent symbol does not recompute | Step 2 | Kick-spy test on both read paths, with the fresh read patched because the fake ignores `symbol` (D-6) |
| `@AC-3` cold read still revalidates in the background | Step 2 | Kick-spy test, plus a real-kick test: first read `computing` true, then after draining the kick a follow-up read gives `computing` false |
| `@AC-4` filtered read over an all-stale queue still revalidates | Step 2 | Kick-spy test on both read paths, plus a real-kick test asserting the stored rows get a `valid_until` later than the test's start time |

For AC-2 the `valid_until` Then clause rests on the kick-spy proxy: no full kick means no writer
ran (O-6). Step 2's Verification states this.

## Step Dependencies

- Steps 1+2 land together. Trigger (`reference/step-constraints.md` §C): Step 1 changes what
  `_read_opportunity_queue` awaits on its repo argument. Three existing test call sites then fail
  until Step 2 stubs `has_fresh`:
  - `tests/test_opportunities_repo.py:657` — a plain `MagicMock` raises `TypeError` on the await.
  - `tests/test_opportunity_compute_state.py:45` `_opp_svc` — an `AsyncMock()` returns a truthy
    `MagicMock`, so the cold-path kick and `computing` disappear.
  - `tests/conftest.py:298` `_BC_METHOD_FOR` — without a mapping, `has_fresh` would route as
    `fetch`.

  Step 2's new tests are also the RED half of Step 1's red→green cycle. The unit is one consumer
  surface (backend, `xstockstrat-analysis`) and two adjacent steps.
- Step 3 requires Step 1, because it documents the new behaviour. It stands alone (docs, no
  verification coupling).
- Cross-feature (design.md D-4): merge 365 before `366-opportunity-live-only-rotation`. 366 must
  keep the `elif` fall-through and the "one compute stamps a single `valid_until`" constraint.
  Re-verify `330-fix-live-enrich-ttl-seed`'s reader-line citation at merge time (context.md
  sdd-review overlap).

---

### Step 1 — service: gate the full kick on "no fresh row" in `_read_opportunity_queue`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: Service owner `xstockstrat-analysis` — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via `sed -n 4758,4828p services/xstockstrat-analysis/app/handlers/servicer.py`
  (re-read this session at `origin/feature/fix-a-filtered-listopportunities@2f120ed3`; the
  analysis tree is unchanged against `origin/main-dev@34f68c57`):
  - `async def _read_opportunity_queue(self, opps, state_repo, user_id, request, offset, q) -> None:` at L4758.
  - The filtered fresh read `rows = await opps.read(..., include_expired=False, sources=req_sources, action_filter=request.action_filter, sort=request.sort, symbol=req_symbol)` at L4765-4774.
  - `if rows:` heal branch at L4775-4789.
  - Bare `else:` at L4790, then `n = await opps.count_for_user(user_id)` at L4791 and
    `q.kick_full = True  # every no-rows branch revalidates in the background` at L4792.
  - Cold branch `if n == 0:` at L4793-4806 (`state = await state_repo.get(user_id) ...` at L4798).
  - All-stale branch at L4807-4819 (`q.served_include_expired = True` at L4809).
  - `q.rows = rows` at L4820; facet `opps.available_sources(user_id, include_expired=q.served_include_expired)` at L4824-4828.
- Reused helper (recon.md Patterns to REUSE): `async def has_fresh(self, user_id: str) -> bool:` at
  `services/xstockstrat-analysis/app/repositories/opportunities.py:340-348`. It runs
  `SELECT EXISTS (SELECT 1 FROM analysis.opportunities WHERE user_id = $1 AND valid_until > now())`
  via `self._db.fetchval`. Production code does not call it today (grep for `has_fresh` in `app/`
  finds only the definition).
- Budgeted-read safety (ANALYSIS-14): the kick fires in the caller's `finally` after release
  (`servicer.py:4721-4725`, recon.md:19). `BudgetedConn.fetchval` exists
  (`app/repositories/read_budget.py:52`, design.md).
- Callers of `_read_opportunity_queue`: `servicer.py:4702` (pool path) and `:4711` (injected-repo
  path) in production, plus `tests/test_opportunities_repo.py:664` (grep `_read_opportunity_queue`
  over `app tests`). Neither production caller changes.

**Lands with**: `Step 2`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `_read_opportunity_queue`, replace the bare `else:` at L4790 with
   `elif not await opps.has_fresh(user_id):`. Do **not** re-indent the body (L4791-4819); it runs
   byte-for-byte when the user has no fresh row (D-1/D-5; R-5 rejected).
2. Put a constraint comment of at most 2 lines on the `elif` line (C-18; CLAUDE.md "How to Act"
   #5). It names the fall-through, for example:
   `# fresh-but-filtered-empty falls through: no kick, empty page (365 FR-1)`.
3. Reword the now-false trailing comment on `q.kick_full = True` (L4792) to
   `# cold or all-stale: revalidate in the background`, or drop it. Keep the assignment where it is:
   before the `count_for_user` result is branched on, and before `state_repo.get` at L4798. The
   `test_compute_state_timeout_kicks_once_then_unavailable` timeout test relies on that order.
4. Keep `has_fresh` running *before* `count_for_user`, not instead of it. Add no new repo method and
   no new SQL (R-1 rejected). Do not add an `is True` check (R-4 rejected). Do not gate on filter
   presence (R-2) and do not add a filtered `include_expired=True` fallback (R-3).
5. When `has_fresh` is true, leave every `q` flag at its `_OpportunityQueueRead` default
   (`servicer.py:516-526`). `rows` stays the empty filtered fresh read and
   `served_include_expired` stays False, so the feature-190 O7 facet pairing holds.
6. Header propagation: no new outbound gRPC call (a DB read only), so §B does not apply.

**Verification**:
```bash
cd services/xstockstrat-analysis
grep -n "elif not await opps.has_fresh(user_id):" app/handlers/servicer.py   # exactly one hit
grep -n "every no-rows branch revalidates" app/handlers/servicer.py          # no hit
uv run ruff check . && uv run ruff format --check .
```
Behavioural verification comes from Step 2 (same atomic unit): run Step 2's full Verification.

---

### Step 2 — test: regression tests for the filtered-empty no-kick and the preserved cold/stale kicks; `has_fresh` harness stubs

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_list_opportunities_deadlines.py` — modify (design item (a))
- `services/xstockstrat-analysis/tests/test_opportunity_compute_state.py` — modify (item (b))
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify (items (c) and (e))
- `services/xstockstrat-analysis/tests/conftest.py` — modify (item (d))

**Reviewers**: Service owner `xstockstrat-analysis` — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `tests/test_list_opportunities_deadlines.py` (read this session):
  - helpers `_row(symbol, *, fresh=True, provenance=("uw",), age_s=0)` (L38; `conviction` 0.8,
    `opportunity_key` `f"{symbol}:sx"`, `valid_until` now±1h), `_State` (L55), `_svc(rows=(), state=None)` (L72),
    `_pooled` (L82), `_record_kicks(svc)` (L91), `_list(svc, ctx=None, **req)` (L116).
  - G3 templates: `test_g3_cold_read_under_max_failures_is_computing(read_path)` (L159),
    `test_g3_fresh_empty_stamp_sets_neither_flag_and_kicks` (L168, asserts `kicks["full"] == [True]`; it must stay green),
    `test_g3_stale_queue_serves_stale_kicks_and_uses_expired_facet` (L177).
  - `test_compute_state_timeout_kicks_once_then_unavailable` (L331, `FakeConn(raise_on={"fetchrow": TimeoutError()})`, asserts `kicks["full"] == [True]`).
  - `pyproject.toml:33` `asyncio_mode = "auto"`, so plain `async def test_*` runs without a marker.
- `_FakeOppRepo` (`tests/test_analysis_servicer.py:4499`) has a real `has_fresh` at L4515-4517
  (`any(r["valid_until"] > now ...)`). Its `read` applies `include_expired`, the `min_conviction`
  floor (with the denied/unavailable/formula_unreadable exemption) and DISMISS (`action == 2`) /
  live SNOOZE (`action == 1` with `snooze_until > now`) from `self.actions[(user_id, key)]`. It
  ignores only `sources`, `action_filter` and `symbol` (comment at L4531-4533; D-6 corrects
  recon.md:43). `replace_for_user` stores rows verbatim (L4509).
- `read_path` fixture (`tests/conftest.py:367`): params `["direct", "pool"]`. Pool mode routes the
  fake repos through `bc_routed`, so each wrapper method issues one statement named by
  `_BC_METHOD_FOR.get(name, "fetch")`. It then asserts one connection and
  `assert_budgeted_read_order`, whose statements must be in `_BC_STATEMENTS = ("fetch", "fetchval", "fetchrow")`.
- `_BC_METHOD_FOR = {"count_for_user": "fetchval", "get": "fetchrow"}` at `tests/conftest.py:298`.
- `_opp_svc()` at `tests/test_opportunity_compute_state.py:45-53`: `svc._opportunities_repo = AsyncMock()`
  with `read` / `count_for_user` / `replace_for_user` stubbed. Without a stub,
  `await svc._opportunities_repo.has_fresh(...)` returns a truthy `MagicMock`. The cold-path kick
  in `test_empty_universe_never_recomputes_synchronously` (expects `computing is True` and 4 kicks)
  and `test_fresh_empty_serve_kicks_self_heal_and_writes_new_row` would then disappear. Its
  `_drain()` pattern (L76-98) is the real-kick template.
- `tests/test_opportunities_repo.py:657-668` `test_stored_zero_signal_rank_weight_reaches_the_read`:
  `opps = MagicMock()` with `read`, `count_for_user`, `available_sources` as `AsyncMock`. It calls
  `svc._read_opportunity_queue(opps, None, "u1", ...)` directly.
- real_pg precedent: `@pytest.mark.real_pg` + `local_pg` fixture (`tests/conftest.py:439`, a
  session-scoped throwaway PostgreSQL; skips locally when no binary is found, fails under
  `CI=true`). `tests/test_fundsignal_emitted_real_pg.py:20-28` creates a pool, runs
  `CREATE SCHEMA IF NOT EXISTS analysis` and executes migration files from `_MIGRATIONS`.
  The DDL to execute: `migrations/011_opportunities.up.sql` (`CREATE TABLE IF NOT EXISTS
  analysis.opportunities`, with `valid_until TIMESTAMPTZ NOT NULL`) and
  `migrations/010_opportunity_actions.up.sql` (`analysis.opportunity_actions`).
- Other `AsyncMock()` opportunity repos (`test_loop_supervision.py:34`,
  `test_analysis_tick_telemetry.py:48`, `test_owner_scoped_completeness.py:78`,
  `test_owner_header_guard.py:361`, `test_opportunity_refresh.py:35/55/74/97`) never call
  `ListOpportunities` (grep `ListOpportunities` over those files: no hits). They need no stub.
  The remaining `ListOpportunities` callers (`test_analysis_servicer.py` via `_FakeOppRepo`,
  `test_unreadable_formula.py:560`, `test_read_budget_real_pg.py:78` with a real repo) use a real
  `has_fresh`.

**Lands with**: `Step 1`

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4`

**Instructions**:

Harness stubs. These keep the existing guards green; they are not RED.
1. **(d)** `tests/conftest.py:298`: set
   `_BC_METHOD_FOR = {"count_for_user": "fetchval", "get": "fetchrow", "has_fresh": "fetchval"}`.
   The `raise_on={"fetchrow": ...}` injection in
   `test_compute_state_timeout_kicks_once_then_unavailable` then still hits the state read (O-7).
2. **(b)** `tests/test_opportunity_compute_state.py` `_opp_svc()`: add
   `svc._opportunities_repo.has_fresh = AsyncMock(return_value=False)` next to the
   `count_for_user` stub. This keeps feature-185 @AC-6/@AC-7 and feature-177 @AC-4 green (O-1).
3. **(c)** `tests/test_opportunities_repo.py` `test_stored_zero_signal_rank_weight_reaches_the_read`:
   add `opps.has_fresh = AsyncMock(return_value=False)` (O-1).

New tests in `tests/test_list_opportunities_deadlines.py` **(a)**. Use the `read_path` fixture
(both paths) unless a test says otherwise. Reuse `_row`, `_svc`, `_record_kicks`, `_list`,
`_FakeOppRepo`. Use no new fixture module (C-13: every literal below has one consumer).

4. `test_ac1_filtered_empty_over_fresh_queue_does_not_kick(read_path)` — **RED pre-fix**.
   - Setup: `svc = _svc(rows=[_row("AAPL"), _row("MSFT")])`, `kicks = _record_kicks(svc)`.
   - Call: `resp, _ = await _list(svc, min_conviction=1.01)`. The unpatched fake applies the
     floor, so the fresh read is `[]`.
   - Assert: `list(resp.opportunities) == []`, `resp.computing is False`,
     `resp.compute_failed is False`, `kicks["full"] == []`, `kicks["retry"] == []`.
5. `test_ac2_symbol_filter_absent_symbol_over_fresh_queue_does_not_kick(read_path)` — **RED pre-fix**.
   - Setup: `svc = _svc(rows=[_row("AAPL")])`. The fake ignores `symbol`, so patch only the
     `include_expired=False` read (D-6): keep `orig = svc._opportunities_repo.read`, define
     `async def _fresh_empty(*a, **kw): return [] if not kw["include_expired"] else await orig(*a, **kw)`
     and set `svc._opportunities_repo.read = AsyncMock(side_effect=_fresh_empty)`. The side effect
     must be an `async def`: a sync lambda returning a coroutine would hand the servicer an
     un-awaited coroutine. Do not re-implement symbol filtering in the fake (fails.md:577 cousin).
   - Call: `_list(svc, symbol="SCKT")`.
   - Assert: empty page, `computing is False`, `kicks["full"] == []`, and the fresh read received
     `symbol == "SCKT"` (`read.await_args_list[0].kwargs`).
   - Also assert `svc._opportunities_repo.rows["u1"][0]["valid_until"]` equals the value captured
     before the call. This is the kick-spy proxy for AC-2's `valid_until` clause.
6. `test_ac3_cold_filtered_read_still_kicks_and_reports_computing(read_path)` — PRESERVE (passes
   pre- and post-fix).
   - Setup: `_svc()`, `_opportunity_compute_failures["u1"] = _OPPORTUNITY_COMPUTE_MAX_ATTEMPTS - 1`.
   - Call: `_list(svc, symbol="SCKT")`.
   - Assert: `computing is True`, `compute_failed is False`, `kicks["full"] == [True]`.
7. `test_ac4_filtered_read_over_all_stale_queue_still_kicks(read_path)` — PRESERVE.
   - Setup: `_svc(rows=[_row("AAPL", fresh=False)])`.
   - Call: `_list(svc, min_conviction=1.01)`.
   - Assert: `kicks["full"] == [True]`, `computing is False`.
8. `test_fresh_rows_all_dismissed_or_snoozed_do_not_kick(read_path)` — **RED pre-fix**. This is
   design Open Risk "all-dismissed/snoozed fresh rows no longer kick", accepted.
   - Setup: `svc = _svc(rows=[_row("AAPL"), _row("MSFT")])`. Set
     `svc._opportunities_repo.actions[("u1", "AAPL:sx")] = {"action": 2}` and
     `svc._opportunities_repo.actions[("u1", "MSFT:sx")] = {"action": 1, "snooze_until": datetime.now(UTC) + timedelta(hours=1)}`.
     No read patch.
   - Assert: empty page, `computing is False`, `kicks["full"] == []`.
9. `test_has_fresh_timeout_is_unavailable_without_kick()` — pool path only (`_pooled`), pins Open
   Risk "a has_fresh timeout drops the kick" (O-7).
   - Setup: `svc = _svc(state=_State())`, `kicks = _record_kicks(svc)`,
     `_pooled(svc, FakeConn(raise_on={"fetchval": TimeoutError()}))`.
   - Assert: `resp is None`, `_abort_code(ctx) == grpc.StatusCode.UNAVAILABLE`,
     `kicks["full"] == []`. This matches today's `count_for_user`-timeout behaviour, so it passes
     pre- and post-fix.
10. Real-kick tests on the direct path, with no `_record_kicks`. They close O-6 for AC-1/AC-3/AC-4.
    Add a local `_drain(svc)` copied from the `test_opportunity_compute_state.py:76-98` pattern,
    which loops `await asyncio.sleep(0)` until `"u1" not in svc._opportunity_recomputing`. It is
    inline because it has a single consumer file; if it gains a second consumer, move it to
    `tests/conftest.py`.
    - `test_ac1_filtered_empty_over_fresh_queue_leaves_valid_until_unchanged` — **RED pre-fix**.
      - Setup: `svc = _svc(rows=[_row("AAPL")])`, `before = svc._opportunities_repo.rows["u1"][0]["valid_until"]`,
        `svc._compute_opportunities = AsyncMock(return_value=[_row("AAPL")])`.
      - Call: `_list(svc, min_conviction=1.01)`, then `await _drain(svc)`.
      - Assert: `svc._compute_opportunities.await_count == 0` and
        `svc._opportunities_repo.rows["u1"][0]["valid_until"] == before`.
    - `test_ac3_cold_read_recompute_then_follow_up_read_not_computing` — PRESERVE.
      - Setup: `_svc()`, `svc._compute_opportunities = AsyncMock(return_value=[_row("AAPL")])`.
      - First `_list(svc, symbol="SCKT")` gives `computing is True`. Then `await _drain(svc)`.
      - A follow-up `_list(svc, symbol="SCKT")` gives `computing is False`, because the recompute
        materialized a fresh AAPL row. (The fake ignores `symbol`, so this read is served from the
        `if rows:` branch; the assertion is on the response flag only.) Also assert
        `_compute_opportunities.await_count == 1`.
    - `test_ac4_all_stale_filtered_read_restamps_valid_until` — PRESERVE.
      - Setup: `start = datetime.now(UTC)`, `svc = _svc(rows=[_row("AAPL", fresh=False)])`,
        `svc._compute_opportunities = AsyncMock(return_value=[_row("AAPL")])`.
      - Call: `_list(svc, min_conviction=1.01)`, then `await _drain(svc)`.
      - Assert: `_compute_opportunities.await_count == 1` and every
        `svc._opportunities_repo.rows["u1"][i]["valid_until"] > start`.

New real_pg test in `tests/test_opportunities_repo.py` **(e)** (O-2, O-8).

11. Add `@pytest.mark.real_pg async def test_has_fresh_against_real_postgres(local_pg)`.
    - Setup: `asyncpg.create_pool(local_pg, min_size=1, max_size=1, statement_cache_size=0)`, then
      `CREATE SCHEMA IF NOT EXISTS analysis`, then execute the text of
      `migrations/010_opportunity_actions.up.sql` and `migrations/011_opportunities.up.sql`. Resolve
      the path with `pathlib.Path(__file__).resolve().parents[1] / "migrations"`, as in
      `test_fundsignal_emitted_real_pg.py:17`. Both files are `IF NOT EXISTS`, so they are safe in
      the session-scoped database.
    - Use unique `user_id`s (for example `uuid.uuid4().hex`), because `local_pg` is shared across
      the session. Insert minimal rows (`user_id, opportunity_key, symbol, action, valid_until`).
    - Assert `await OpportunitiesRepository(pool).has_fresh(uid)`:
      - True for a user with one `now() + interval '1 hour'` row.
      - False for a user with only `now() - interval '1 hour'` rows.
      - False for a user with no rows.
    - **D-3 pin**, labelled in a 1-line comment as a pin, not a behaviour test: a user with one
      fresh row plus a DISMISS (`action = 2`) row in `analysis.opportunity_actions` for that key
      still gives True, because the SQL never reads dispositions.
    - Close the pool in `finally`.

**Verification**:
```bash
cd services/xstockstrat-analysis
# RED on the pre-Step-1 tree (execute's tdd-gate): items 4, 5, 8 and the AC-1 real-kick test fail.
uv run pytest -q tests/test_list_opportunities_deadlines.py tests/test_opportunity_compute_state.py tests/test_opportunities_repo.py
# GREEN after Steps 1+2: all of the above pass, including the unchanged
# test_g3_fresh_empty_stamp_sets_neither_flag_and_kicks, test_g5_stall_at_every_stage_* and
# test_compute_state_timeout_kicks_once_then_unavailable.
uv run pytest -q tests/test_analysis_servicer.py -k "ListOpportunities or Opportunit"
uv run pytest --cov=app --cov-fail-under=40
uv run ruff check . && uv run ruff format --check .
# C-13: no second inline copy of a domain literal
grep -n "def _drain\|from tests.conftest\|conftest" tests/test_list_opportunities_deadlines.py
```
Accepted proxy (O-6): for AC-2, "full kick not called" stands in for the `valid_until` unchanged
Then clause. AC-1, AC-3 and AC-4 also get real-kick assertions (item 10). The real_pg test (item 11)
skips locally when no PostgreSQL binary is present and runs under `CI=true`.

---

### Step 3 — docs: correct the feature-215 symbol-filter sentence in `docs/opportunities.md`

**Status**: `pending`
**Service**: `xstockstrat-analysis` (docs)
**Files**:
- `services/xstockstrat-analysis/docs/opportunities.md` — modify (design item (f))

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via `grep -n "filters both the fresh and the stale" services/xstockstrat-analysis/docs/opportunities.md`
  → L9. The sentence spans L8-10 under the L7 `ListOpportunities` bullet:
  "`ListOpportunitiesRequest.symbol` (normalized, empty = all) filters both the fresh and the stale
  read, so Signal-detail finds a symbol's row whatever its queue rank."
- design.md item (f) cites `:7`. The bullet starts there, but the sentence to change is at L9. This
  is a line-reference correction, not a scope change.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Reword the L8-10 sentence so it says that `symbol` (like every request filter) is forwarded to
   the fresh read, and that the stale (`include_expired=True`) read runs only when the user has
   **no** fresh row. So a filtered read that matches nothing over a fresh queue returns an empty
   page and kicks no recompute (feature 365).
2. Keep it to the minimum wording change. Do not touch the L7 stale-while-revalidate paragraph.
   The paragraph is still accurate ("a stale read serves the old rows and kicks a background
   recompute").

**Verification**:
```bash
grep -n "no fresh row" services/xstockstrat-analysis/docs/opportunities.md   # ≥1 hit near L9
grep -n "filters both the fresh and the stale" services/xstockstrat-analysis/docs/opportunities.md  # no hit
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
