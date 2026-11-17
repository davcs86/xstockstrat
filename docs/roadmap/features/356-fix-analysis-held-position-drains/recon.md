# Recon: fix-analysis-held-position-drains

**Created**: 2026-11-17
**From**: product-spec.md
**Tree**: feature/fix-analysis-held-position-drains@403a0594 (detached on origin; origin/main-dev@149351de). The discovery digests were UNSTAMPED; every `path:line` below was re-grepped at 403a0594.
**Affected services**: xstockstrat-analysis (upstream and unchanged: xstockstrat-portfolio `ListPositions`)

---

## Objective

The analysis service has two held-position drains, `live_loop._drain_held` and `servicer._drain_held_symbols`. Both trust portfolio `ListPositions`' `next_page_token` and stop silently at a 50-page cap. On a page error they return the rows collected so far as a successful result. The fix makes both fail closed (`fails.md:3312`). Each drain rejects a token equal to the one it sent, treats a cap reached with a token still pending as a failure, and raises any page error to its caller. Each caller then handles the failure as FR-4 describes, so a duplicated or partial held set never feeds the live loop, the opportunity ranking or the screener `held` marks.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.13)
  - Live-loop drain: `_drain_held` at `services/xstockstrat-analysis/app/engine/live_loop.py:563-590`.
    - Returns `set()` when `self._portfolio is None` (`:566`).
    - Builds metadata with `owner_metadata(owner)` (`:567`), which raises `ValueError` for an empty owner.
    - Error path: `except Exception` → `log.warning` → `telemetry.record_live_loop_drain_failure("held")` → `return out` (`:582-585`).
    - The exit trusts the token: `page_token = resp.page.next_page_token; if not page_token: break` (`:587-589`).
    - After the loop it falls through to `return out` (`:590`), so the cap is silent.
  - Cap constants: `_DRAIN_PAGES = 50` (`live_loop.py:66`) and `_DRAIN_PAGE_SIZE = 1000` (`live_loop.py:67`).
  - Live-loop caller: the per-cycle loop at `live_loop.py:391-411`.
    - `held_cache` / `watch_cache` are per-cycle dicts (`:391-392`). An owner is cached only after both drains succeed (`:401-403`).
    - The only handler is `except ValueError as e:`, which logs "strategy %s skipped" and `continue`s (`:409-411`).
    - Today a raise from `_drain_held` would escape `_run_cycle`. A failed owner is not cached, so the next strategy of the same owner would drain it again.
  - Entry-backfill caller: `services/xstockstrat-analysis/app/engine/entry_backfill.py:146-160`.
    - Calls `held = await live_loop._drain_held(owner)` (`:148`), then `_drain_watchlist` (`:149`), inside `try`.
    - `except Exception` logs a WARNING naming the strategy and owner, then sets `failed_owners[owner] = [strategy_id]` (`:150-159`).
    - Later strategies of a failed owner are short-circuited at `:142-144` without another drain.
  - Servicer drain: `_drain_held_symbols` at `services/xstockstrat-analysis/app/handlers/servicer.py:6404-6437`.
    - Returns `{}` when `self._portfolio is None` (`:6413`).
    - Pages with `range(_MAX_DRAIN_PAGES)` (`:6417`) at page size `_BAR_PAGE_SIZE` (`:6423`).
    - Catches only `grpc.RpcError`, logs it and returns `held` (`:6428-6430`). There is no metric.
    - Sums per page: `held[norm] = held.get(norm, 0.0) + abs(p.market_value)` (`:6433`).
    - The exit trusts the token (`:6434-6436`), and the cap is silent (`:6437`).
  - Servicer constants: `_MAX_DRAIN_PAGES = 50` (`servicer.py:347`) and `_BAR_PAGE_SIZE = 1000` (`servicer.py:298`).
  - `ScreenSymbols` caller: `held = await self._drain_held_symbols(user_id, propagation_meta)` (`servicer.py:3935`), then marks rows with `if _normalize_symbol(r.symbol) in held: r.held = True` (`:3936-3940`). There is no try/except here, so a raise today aborts the RPC.
  - `_compute_opportunities` caller: `asyncio.gather(...)` at `servicer.py:5365-5370`, without `return_exceptions`.
    - It gathers `_drain_active_signals`, `_drain_held_symbols`, `_drain_watchlist_bindings` and `_drain_source_weights`.
    - A raise propagates out of the gather. The sibling awaitables keep running and are not cancelled.
  - Recompute failure path: `_run` in `servicer.py:4940-4961`.
    - `_compute_opportunities` → `_replace_and_stamp_compute_state` (`:4943-4944`) sits inside `try`.
    - `except Exception` increments `_opportunity_compute_failures[user_id]` (`:4952-4954`), logs "opportunity recompute failed for user=%s" (`:4955-4956`) and calls `telemetry.record_opportunity_recompute("full", "failed")` (`:4958`).
    - The stored queue is untouched because the replace call is never reached.
  - Telemetry: `record_live_loop_drain_failure(source)` and `record_opportunity_recompute(kind, outcome)` in `services/xstockstrat-analysis/app/telemetry.py` (instruments `analysis.live_loop.drain_failures`, `analysis.opportunity.recompute`).
  - Last migration: not needed (no schema change). The `services/xstockstrat-analysis/migrations/` listing was not walked for the next NNN.
  - Config-read pattern: not applicable. Both caps stay module constants (product-spec Fix Scope).

## Patterns to REUSE

- **Per-cycle failed-owner skip (FR-4, live loop)** → reuse the entry backfill's `failed_owners` short-circuit (`entry_backfill.py:142-144`, `:150-159`). It runs the drain once per owner, skips that owner's later strategies without another drain, and logs a WARNING naming the strategy and owner. The live loop needs the same thing next to `held_cache` (`live_loop.py:391`). Design must decide whether the new handler sits beside or above the existing `except ValueError` at `:409`. It must not swallow or be confused with the empty or `system` owner skip that `ValueError` signals.
- **Held-drain metric (FR-4, `@AC-16 @feature-294`)** → reuse `telemetry.record_live_loop_drain_failure("held")` (today at `live_loop.py:584`). It has no owner attribute. It must fire once per failed owner per cycle. Today it is recorded inside the drain, so the entry backfill also counts its own held-drain failures. Moving the call to the caller would change that, so design must choose deliberately.
- **Opportunities recompute failure (FR-4, `@AC-5`)** → reuse the existing `_run` handler (`servicer.py:4949-4958`) unchanged. A raise from `_drain_held_symbols` already reaches it through the un-guarded `gather` at `:5365`. No new metric or code is needed there.
- **Token-loop consumer rule (FR-1..FR-3, FR-6)** → `fails.md:3312`, with its shipped reference in Go: `services/xstockstrat-portfolio/internal/service/portfolio_service.go:738,922`, and the RED fake `portfolio_pnl_paging_test.go:27-34` (`ignoreToken`, `pagingCallCap`). The rule is cited from the ledger evidence line and was not re-opened here. No Python equivalent exists in analysis: there is no `page_token` equality guard anywhere under `services/xstockstrat-analysis/app`, and no test fake that ignores `page_token`.
- **Shared helper vs in-place hardening** is open (operator decision 2026-11-17, recorded in context.md). The facts for that fork:
  - The two drains differ in return type (`set` vs `dict[str, float]` summed per symbol).
  - They use different page-size constants (`_DRAIN_PAGE_SIZE` vs `_BAR_PAGE_SIZE`, both 1000).
  - They use different metadata (`owner_metadata(owner)` vs the inbound `propagation_meta`).
  - Their error scope differs (`Exception` vs `grpc.RpcError`), and so does metric ownership (a counter vs none).
  - The two cap constants are separate, each 50.
  - The out-of-scope sibling drains (`live_loop.py:178,535,601`; `servicer.py:6006,6369`) share the loop shape. A helper shaped for them is speculative scope (CLAUDE.md behavior 2).
- **Test harness** → `services/xstockstrat-analysis/tests/test_live_loop_telemetry.py`:
  - `metric_sum` (`:32`), `_wire_drains(loop, list_positions=...)` (`:53-60`) and the `metric_reader` fixture.
  - The `_make_loop` and `_run_cycle` cycle pattern used by the `test_ac15_*` tests (`:87`, `:105`) is the model for `@AC-7`, which has two `o-1` strategies and exactly one `ListPositions` call.
- **Guard to keep green** → `tests/test_owner_header_guard.py:408-416` parametrizes `_drain_held` over an empty owner. It expects `ValueError` and zero `ListPositions` awaits. The hardened drain must still raise `ValueError` before any RPC.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-16 @FR-5 @feature-294` "A failed portfolio drain is counted as a degraded universe" (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature:11`).
  - A held-drain failure adds 1 to `drain_failures{source=held}`, with no owner id in the metric attributes.
  - The new raise-on-failure path must keep this, once per failed owner per cycle.
  - Its unit test `test_ac16_failed_held_drain_counted_without_owner` (`tests/test_live_loop_telemetry.py:121-127`) asserts `held == set()` after a raise. That assertion contradicts FR-4 and must change to `pytest.raises`. The metric == 1 and no-owner assertions stay.
  - This is a test edit, not a change to the guarantee: the scenario does not require a returned set.
- **PRESERVE** `@AC-8 @FR-3 @regression @feature-262` "A non-ValueError drain failure for one owner does not stop the backfill for other owners" (`services/xstockstrat-analysis/acceptance/fix-analysis-owner-scope.feature:32`).
  - The entry backfill isolates an owner whose held drain raises, and warns naming the strategy and owner (`entry_backfill.py:150-159`).
  - The hardened drain raises on more conditions, so this isolation must hold. No backfill code change is expected.
- **PRESERVE** `@AC-3 @FR-3 @regression @feature-262` "One owner whose drains fail does not stop the backfill for other owners" (`fix-analysis-owner-scope.feature`) — per-owner failure isolation in the backfill. It uses the same seam.
- **PRESERVE** `@AC-6 @FR-4 @feature-185` "A cold read is non-blocking and distinguishable from an empty universe" (`opportunity-compute-robustness.feature`) — a held-drain failure feeds the recompute-failure path. The cold-read `computing` signal and the background kick must not change.
- **PRESERVE** `@AC-7 @FR-4 @feature-185` "A persistently-failing cold compute renders a terminal error, not an infinite spinner" (`opportunity-compute-robustness.feature`) — repeated held-drain failures must still end in `compute_failed`.
- **PRESERVE** `@AC-10 @FR-5 @characterization @feature-289` "A formula execution timeout still fails the opportunities recompute" (`opportunity-compute-robustness.feature`) — a failed recompute logs the warning and keeps the stored rows. The held-drain failure reuses this path (`servicer.py:4949-4958`), and the new `@AC-5` adds a case beside it.
- **PRESERVE** `@AC-6 @FR-4 @feature-191` "Phase 0 drains execute concurrently" (`opportunities-latency-fix.feature`) — `_drain_held_symbols` stays one of the 4 concurrent `gather` drains, and raising must not serialize them. Its test stubs `svc._drain_held_symbols` (`tests/test_opportunities_latency.py:67,86,123`), so a change to the drain body does not affect that test.
- **EXTEND**: none named. The new `@AC-1..9` add failure, cap and success cases beside these guarantees. No existing scenario covers multi-page or single-page success for the held drains.
- **CHANGE**: none. No existing scenario asserts the old behaviour (a partial or duplicated result returned as success, or a silent cap).
- `docs/sdd/business-rules/platform.feature` has no held-drain or `ListPositions` paging guarantee.
- Note on the spec's "preserves `@AC-8 @feature-262`": that scenario covers backfill isolation. The owner-scoped results rule (FR-5) has no durable `@AC-*` today.

## Dependencies

- Proto/RPC: none changed. The drains consume `portfolio.v1.ListPositions` with `common.v1.PageRequest{page_size, page_token}` and read `resp.page.next_page_token`.
- Migration: none.
- Config keys: none (both caps stay module constants).
- Inter-service edges: unchanged. The analysis live loop and entry backfill call portfolio `ListPositions` with an owner-synthetic `x-user-id` (`owner_metadata`). The servicer calls it with the inbound `propagation_meta` (C-03).
- New env vars / ports: none.

## Risks / Not-found

- **Vacuous-green risk** (`fails.md:3350-3353`, `insights.md:4019-4022`): the RED test for each `@regression` scenario must drive the real `_drain_held` / `_drain_held_symbols` against a `ListPositions` fake that ignores `page_token`, for example one that always returns `next_page_token="t"`. A mocked drain that cannot raise or loop proves nothing. `_wire_drains`' default `ListPositions` returns `_EOF` (`test_live_loop_telemetry.py:55-57`), so a new fake is needed.
- **`gather` without `return_exceptions`** (`servicer.py:5365`): a raised held drain aborts Phase 0 as FR-4 intends, but the three sibling drains are left running unawaited. That is existing behaviour for any sibling raise. Design should confirm this is acceptable and note it rather than change it (out of scope).
- **Metric double-count / placement**: `@AC-16` requires once per failed owner per cycle. That holds if the counter stays in the drain and the caller drains a failed owner only once. A second recording in the caller would double-count it. Moving the counter to the caller would stop the backfill counting its own held-drain failures.
- **`ValueError` collision**: the cycle's `except ValueError` (`live_loop.py:409`) means "ownerless strategy". If the new failure signal is a `ValueError` subclass, or is caught as one, a held-drain failure would be treated as that skip and would not be cached as failed. Design must pick the exception type with this in mind.
- **`ScreenSymbols` behaviour change**: it has no try/except today (`servicer.py:3935`). FR-4 needs a new guard that logs a WARNING and marks no row, while still returning results. Recon found no existing scenario that asserts the `held` mark on the screener path.
- **Overlap** (context.md, sdd-review): `308-fix-analysis-per-symbol-isolation` edits `_compute_opportunities`. That is a rebase or manual-merge risk at `servicer.py:5365`, which this feature should not need to edit. `327-fix-analysis-evidence-dry` touches disjoint regions.
- **Not touched**: features 351, 353 and 354 (operator decision). Portfolio's own paging fix is 353.
- Not opened by recon: the analysis `docs/context-constitution.md` ANALYSIS-* entries and the `recon-checklist.md`. The fails.md:3312 Go reference was cited from its evidence line only.
- Discrepancy in the workflow input: the feature directory was given as `docs/roadmap/features/docs/roadmap/features/356-…`, a doubled prefix. Recon wrote to the real directory `docs/roadmap/features/356-fix-analysis-held-position-drains/`.

## Recommended Scope

These boundaries are advisory and feed the design round and `/sdd-spec`. Every step is red before green.

1. **RED tests.**
   - Add ignore-token, page-2-error and cap fakes for both drains (`@AC-1..3`, `@AC-7`, and the `@AC-5`/`@AC-6` caller cases).
   - Flip `test_ac16_failed_held_drain_counted_without_owner` from `held == set()` to `pytest.raises`.
   - Run against the current tree and record the failures.
2. **Harden the drains** with a shared helper or in place, as design decides.
   - Reject a token equal to the one sent, fail on reaching the cap with a token pending (WARNING naming the owner or user and the cap), and raise on any page exception.
   - Keep the `None`-portfolio early return and the `owner_metadata` `ValueError`.
   - Keep `record_live_loop_drain_failure("held")` firing once per failed owner.
3. **Callers.**
   - Live loop: add a per-cycle failed-owner set next to `held_cache` and a handler distinct from `except ValueError`.
   - `ScreenSymbols`: add a try/except that marks no row `held` and logs a WARNING.
   - `_compute_opportunities` and the entry backfill: no code change. Verify them by test.
4. **Success-path and preserve checks.** Cover multi-page and single-page success (`@AC-8`/`@AC-9`). Keep the existing `@AC-16 @feature-294`, `@AC-3`/`@AC-8 @feature-262`, the feature-185/289 recompute tests and `test_owner_header_guard.py:408` green. Run `uv run pytest --cov=app --cov-fail-under=40`.
