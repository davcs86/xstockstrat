# Recon: fix-a-filtered-listopportunities

**Created**: 2026-11-26
**From**: product-spec.md
**Tree**: origin/feature/fix-a-filtered-listopportunities@f51270ef. This commit does not contain origin/main-dev@34f68c57, but `git diff --stat HEAD origin/main-dev -- services/xstockstrat-analysis` is empty, so every cited analysis line is the same on main-dev. The discovery digests were UNSTAMPED; every citation below was re-grepped at this commit.
**Affected services**: xstockstrat-analysis
**Severity**: SEV-3 (Track C)

---

## Objective

A `ListOpportunities` read with a filter (`min_conviction`, `sources`, `action_filter` or `symbol`) that matches nothing reaches the no-rows branch of `_read_opportunity_queue`. That branch sets `q.kick_full = True` without checking anything else, so the read kicks a full background recompute even when the user's queue still has fresh rows. The UI `/trader/positions/[symbol]` page polls with a symbol filter every 15s, so this repeats. The fix gates the full kick on "no fresh rows exist for the user", using the existing `has_fresh` repo method. The cold path (no rows ever, no still-fresh empty stamp) and the all-stale path keep their current kick and response flags.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.13)
  - Handler: `ListOpportunities` read phase at `services/xstockstrat-analysis/app/handlers/servicer.py:4697-4718`. The pool path uses `budgeted_read(self._db_pool, budget_ms / 1000)` and `self._opps_repo_factory(bc)` (4700-4709). The injected-repo test path is at 4710-4718.
  - The kick fires in the caller's `finally`, after the connection is released: `servicer.py:4721-4725`. `if q.kick_full: self._kick_opportunity_recompute(user_id, propagation_meta)` sits at 4722-4723.
  - The bug site is `_read_opportunity_queue` at `servicer.py:4758-4828`.
    - The filtered fresh read is at 4765-4774 (`include_expired=False`, `sources=req_sources`, `action_filter=...`, `sort=...`, `symbol=req_symbol`).
    - The surgical heal for fresh rows is the `if rows:` branch at 4775-4789.
    - The no-rows `else` branch is at 4790-4819. It runs `n = await opps.count_for_user(user_id)` at 4791 and then `q.kick_full = True  # every no-rows branch revalidates in the background` at 4792.
    - The cold branch (`n == 0`) is at 4793-4806. It does `state_repo.get(user_id)`. A still-fresh stamp leaves both flags false. Otherwise it sets `compute_failed` once `_opportunity_compute_failures >= _OPPORTUNITY_COMPUTE_MAX_ATTEMPTS`, else it sets `computing`.
    - The all-stale branch (`n > 0`) is at 4807-4819. It sets `q.served_include_expired = True` and re-reads with `include_expired=True` using the same filters.
    - The source facet is at 4824-4828. It is computed on page 0 at the served freshness and does not depend on the request filters.
  - The `_OpportunityQueueRead` dataclass is at `servicer.py:516-526` (fields `served_include_expired`, `computing`, `compute_failed`, `kick_full` at 524, and `retry_symbols`).
  - The response is built at `servicer.py:4750-4756` (`computing`, `compute_failed`, `available_sources`).
  - Repository `services/xstockstrat-analysis/app/repositories/opportunities.py`:
    - `read` at 204. It excludes dismissed and snoozed rows (`snooze_until > now()`, ~277) and exempts muted and unavailable rows from the floor (~255-261).
    - `count_for_user` at 332 counts all rows, whatever their validity.
    - `has_fresh` at 340-348 runs `SELECT EXISTS (SELECT 1 FROM analysis.opportunities WHERE user_id = $1 AND valid_until > now())`. It uses `fetchval`, which is allowed on `BudgetedConn`.
  - Last migration: `029_seed_fundamentals_blend_strategy.up.sql` (`services/xstockstrat-analysis/migrations/`). This fix needs no migration.
  - Config read on this path: `opportunity.signal_rank_weight` only (`servicer.py:4761`), plus `opportunity.read_db_budget_ms` in the caller (~4693). There are no new keys.
  - Per-row `valid_until` writers:
    - The full compute stamps one uniform window (`servicer.py:5955-5963`).
    - The surgical heal gives healed rows a new window and keeps the existing `valid_until` on still-unavailable rows (`servicer.py:5204-5217`, `5311-5320`).
    - So rows of mixed freshness can coexist for one user.

## Patterns to REUSE

- Fresh-rows existence check → reuse `OpportunitiesRepository.has_fresh` (`app/repositories/opportunities.py:340`). It already exists and is not yet called by production code. It uses `fetchval`, so it is safe inside the budgeted read (ANALYSIS-14). Do not add a new repo method or SQL.
- Test fake → `_FakeOppRepo.has_fresh` already exists (`tests/test_analysis_servicer.py:4515`; class at 4499, `count_for_user` at 4512). Its `read` deliberately does not apply the filter kwargs (comment at 4531-4533, with a fails.md vacuous-green warning). To make the fresh read return `[]` over fresh rows, patch `read` (for example `AsyncMock(return_value=[])` on the fresh pass). Do not re-implement filtering in the fake.
- Kick spy + both read paths → `tests/test_list_opportunities_deadlines.py`. It provides `_row(symbol, fresh=...)` (38), `_State` (55), `_svc(rows, state)` (72), `_pooled` (82), `_record_kicks(svc)` (91), `_list(svc, **req)` (116) and the `read_path` fixture.
  - Template for AC-3: `test_g3_cold_read_under_max_failures_is_computing` (159).
  - Template for AC-4: `test_g3_stale_queue_serves_stale_kicks_and_uses_expired_facet` (177).
  - For AC-1/AC-2: a new test using `_svc(rows=[_row("AAPL")])` with `min_conviction=1.01` or `symbol=...` and a patched empty fresh `read`, asserting `computing is False`, `compute_failed is False` and `kicks["full"] == []`.
- Filter-forwarding precedent → `TestListOpportunitiesServerFilters190` (`tests/test_analysis_servicer.py:7854`). Its `_svc_with_row` is at 7860, and the class includes `test_symbol_filter_normalized_into_both_reads` (7917) and `test_stale_path_facet_uses_expired_freshness` (7951).
- Record kicks on `q` and fire them only after release (ANALYSIS-14, ANALYSIS-15). The gate changes only *whether* `q.kick_full` is set. It does not change where the kick fires.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-6 @FR-4 @feature-185` "A cold read is non-blocking and distinguishable from an empty universe" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`). A cold read returns an empty page with computing=true and kicks a background recompute. This is the FR-2 cold path the fix must keep.
- **PRESERVE** `@AC-7 @FR-4 @feature-185` "A persistently-failing cold compute renders a terminal error, not an infinite spinner" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`). The compute_failed semantics on the cold path stay unchanged.
- **PRESERVE** `@AC-8 @FR-5 @feature-185` "A data-unavailable row self-heals via a surgical read-time recompute" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`). The per-symbol heal lives in the `if rows:` branch (servicer.py:4775-4789). It is separate from the full kick and is untouched by the gate.
- **PRESERVE** `@AC-4 @FR-3 @feature-177` "An empty-universe user does not recompute on every poll" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`). The still-fresh empty stamp suppresses the recompute. The has_fresh gate must not break it. An empty universe has no rows, so `has_fresh` is false and the stamp logic runs unchanged.
- **PRESERVE** `@AC-1 @FR-1 @feature-190` "Min-conviction floor is applied by the server, not the client" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`). The filter semantics are unchanged. Only the recompute side effect is removed.
- **PRESERVE** `@AC-4 @FR-2 @feature-190` "Source filter returns only matching sources" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`). Same filter path.
- **PRESERVE** `@AC-6 @FR-3 @feature-190` "Action filter returns only the selected action" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`). Same filter path.
- **PRESERVE** `@AC-11 @FR-5 @feature-190` "available_sources reflects the full queue independent of active filters" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`). The empty filtered page must still carry the correct available_sources. The facet at servicer.py:4824-4828 runs after the branch and does not depend on the filters, but it depends on `q.served_include_expired`, which must stay false on the new fresh-but-filtered-empty branch.
- **PRESERVE** `@AC-13 @FR-6 @feature-190` "Pagination traverses the filtered, sorted result" (`services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature`). The empty filtered page stays a valid pagination terminus (`next_page_token` "").
- **PRESERVE** `@AC-1 @regression @feature-227` "A stalled price enrichment returns the stored rows unenriched within the deadline" (`services/xstockstrat-analysis/acceptance/fix-opportunities-read-hangs.feature`). The read-path deadline behavior is untouched.
- **PRESERVE** `@AC-4 @regression @feature-227` "An exhausted analysis DB pool fails the read fast" (`services/xstockstrat-analysis/acceptance/fix-opportunities-read-hangs.feature`). The extra has_fresh query must stay inside the single budgeted read connection.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-330` "a warm 15s re-poll of ListOpportunities is served from the live-enrich memo" (`services/xstockstrat-analysis/acceptance/opportunities-latency-fix.feature`). The UI position page polls at 15s and must not regress.
- No CHANGE or EXTEND rules were identified, so no sign-off is needed.
  - The feature's own @AC-4 (an all-stale filtered read still kicks) has no durable guarantee today. The promoter should treat it as a new scenario.

## Dependencies

- Proto/RPC: none. `computing`, `compute_failed` and `available_sources` are already set at servicer.py:4750-4756.
- Migration: none. The next free number would be `030` if one were ever needed.
- Config keys: none.
- Inter-service edges: none new.
- New env vars / ports: none.
- Callers: no code change.
  - The UI `useOpportunities` polls every 15s on `/trader/positions/[symbol]`.
  - The agent MCP `list_opportunities` is the other caller.
  - Neither file was opened in recon.

## Risks / Not-found

- **Existing tests that the change will touch.** Each one must be updated or confirmed green. None of them asserts a kick on a filtered-empty read over a fresh queue.
  - `tests/test_opportunities_repo.py:657-668` (`test_stored_zero_signal_rank_weight_reaches_the_read`) builds `opps = MagicMock()` with only `read`, `count_for_user` and `available_sources` as `AsyncMock`. A new `await opps.has_fresh(...)` gets a plain `MagicMock`, which cannot be awaited, so the test would fail with `TypeError`. It needs `opps.has_fresh = AsyncMock(return_value=False)`.
  - `tests/test_list_opportunities_deadlines.py:168` (`test_g3_fresh_empty_stamp_sets_neither_flag_and_kicks`) asserts `kicks["full"] == [True]` for a no-rows user with a fresh empty stamp. `has_fresh` is false there, so the kick must stay (FR-2, @feature-177 self-heal).
  - `tests/test_list_opportunities_deadlines.py:331` (`test_compute_state_timeout_kicks_once_then_unavailable`) asserts a full kick even when `state_repo.get` (`fetchrow`) times out. This works today because `q.kick_full = True` is set *before* the state read (4792 vs 4798). The fix must keep `kick_full` set before `state_repo.get` on the `has_fresh`-false path.
  - The `test_g5_stall_at_every_stage...` test (207) parametrizes over FakeConn stages. The added `fetchval` goes through the same stage hooks, so the test should stay green. Confirm by running it.
- **Order of statements.** If `has_fresh` runs first and raises (budget timeout or pool error), no kick is recorded. That matches today's behavior, where `count_for_user` raises before line 4792. This needs no new handling.
- **Mixed-freshness queues** (from the surgical-heal `valid_until` writers above). One fresh row plus stale rows is possible. A filtered read that matches only a *stale* row would, after the gate, serve an empty page with no kick instead of today's stale row plus kick. This is consistent with the unfiltered path: when any fresh row matches, that path serves fresh rows only and never kicks. Design should state the decision explicitly. The default is to accept it, because the queue is not stale while a fresh row exists.
- **Fresh rows all dismissed or snoozed.** `read` excludes them (opportunities.py ~277, ~321), but `has_fresh` counts them, so the gate serves empty without a kick. Design should state this is intended and decide whether a scenario is warranted. The spec-review flagged this case with no AC.
- **Manual-recompute lever removed.** The 2026-11-25 homelab workaround `list_opportunities(min_conviction=1.01)` stops forcing a recompute. No refresh or invalidate RPC exists. The operator's default is that a deliberate manual-recompute path is **out of scope**. Design must record that decision and, optionally, a follow-up story.
- **Comment drift.** `servicer.py:4792` "every no-rows branch revalidates in the background" becomes false and must be updated.
  - Check `services/xstockstrat-analysis/docs/opportunities.md`. Recon found no "every no-rows" text there via grep. Its stale-while-revalidate paragraph (line 7) does not mention filters.
  - ANALYSIS-14 needs no text change, because `has_fresh` uses `fetchval`.
- **Cross-feature overlap.**
  - `366-opportunity-live-only-rotation` (spec-ready) changes `_compute_opportunities` and queue persistence (`replace_for_user`, per-row `valid_until`) in the same servicer. 365's AC-1/AC-4 `valid_until` fixtures must stay consistent with 366. The recommended merge order is to merge 365 before or with 366.
  - `330-fix-live-enrich-ttl-seed` cites a now-stale reader line inside `_read_opportunity_queue`. Re-verify at merge time.
  - `308` and `327` touch distant lines and are low risk.
- **Not found / not searched.** There is no dedicated real-Postgres test for `has_fresh`'s SQL; grep found only the fake. The UI and agent caller files and the `_kick_opportunity_recompute` internals were not opened.
- **fails.md trap.** Per the `_FakeOppRepo` comment, do not reproduce the filter SQL in the fake; that is the vacuous-green cousin of fails.md:577. Assert at the servicer-to-repo boundary with a patched `read`.

## Recommended Scope

The scope is a single step, test-first:

1. **RED tests** in `tests/test_list_opportunities_deadlines.py`, using the `read_path` fixture so both the pool path and the no-pool path run. Patch the fake's fresh `read` to return `[]`.
   - AC-1: rows are fresh and `min_conviction=1.01` → empty page, `computing`/`compute_failed` false, `kicks["full"] == []`.
   - AC-2: rows are fresh and a non-matching `symbol` filter is set → same assertions as AC-1.
   - AC-3: the cold read still returns `computing` and still kicks.
   - AC-4: a stale queue with a filter still serves stale and still kicks.
2. **GREEN** in `_read_opportunity_queue`'s `else` branch: call `await opps.has_fresh(user_id)` first.
   - If it is true, leave all of `q`'s flags at their defaults (`kick_full`, `computing`, `compute_failed` and `served_include_expired` stay false).
   - Otherwise run the existing `count_for_user` / cold / all-stale logic unchanged, with `kick_full = True` set before `state_repo.get`.
   - Update the 4792 comment.
   - Add `has_fresh = AsyncMock(return_value=False)` to `tests/test_opportunities_repo.py:657`.
3. Verify: `uv run pytest --cov=app --cov-fail-under=40` from `services/xstockstrat-analysis` and `ruff check`.

Out of scope (default, design to confirm): a manual-recompute RPC or lever, any proto, migration or config change, and any UI or agent change.
