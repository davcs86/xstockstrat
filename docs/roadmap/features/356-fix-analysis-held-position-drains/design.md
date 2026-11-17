# Design: fix-analysis-held-position-drains

**Created**: 2026-11-17
**Rounds**: 5 (full; termination: approved)
**Approved by**: user @ 2026-11-17 (operator approval at the design gate after round 5; Floor clear)
**Grounded in**: recon.md
**Debate register**: debate.md (D-1..D-16, R-1..R-15, O-1..O-9, P-1..P-3)

---

## Chosen Approach

The two analysis consumers of portfolio `ListPositions` stop trusting `next_page_token` and fail
closed (`fails.md:3311`). Both route through one shared helper. Internal-only change: there is no new
consumer surface. The existing surfaces it protects are the live loop, the entry backfill, the
`ScreenSymbols` `held` marks and the opportunities queue (Insights and Agent `list_opportunities`).

**1. Shared drain helper (D-1, D-2, D-6, D-8).** In `services/xstockstrat-analysis/app/handlers/servicer.py`,
add `_drain_positions_paged(stub, user_id, metadata) -> list` and `_PositionsPageError(Exception)`.
They sit next to `_fetch_historical_fundamentals_paged`, which `live_loop.py` already imports
(recon.md:51-63). The helper replaces the two identical loop bodies: `live_loop.py:563-590`
(recon.md:17-22) and `servicer.py:6404-6437` (recon.md:32-37). It raises `_PositionsPageError`,
never a `ValueError` (recon.md:102), in three cases. It never returns partial rows.
- (a) Any exception in the page body (await, row collection, token read) is wrapped `from e`.
- (b) A non-empty `next_page_token` equal to the token sent.
- (c) The cap is used up (`_MAX_DRAIN_PAGES = 50`, recon.md:38) with a token still pending. A WARNING naming the user and the cap is logged first.

The `try` wraps only the page body. The `next == sent` check and the cap raise run outside it, so the
guard's own error is never re-wrapped (D-6). The page-size and cap constants are unchanged (R-4, R-7).
Portfolio clamps the page size to 100 and uses a strict keyset cursor, so in practice the bound is
5,000 positions per owner. The duplicate-token guard defends against server defects and fakes (D-8).

**2. Live-loop drain and cycle (D-3, D-4, D-10).** `live_loop._drain_held` keeps its `None`-portfolio
early return and its `owner_metadata` `ValueError` before any RPC (recon.md:18-19, :67). It reduces
the helper's rows to a set. On `_PositionsPageError` it records `record_live_loop_drain_failure("held")`
and re-raises without logging, so `@AC-16 @feature-294` is kept with no double count (recon.md:54,
:101). The per-cycle loop (recon.md:24-27) catches `except _PositionsPageError` before the existing
`except ValueError` (`live_loop.py:409`). It logs one WARNING naming the first strategy and the owner,
and adds the owner to a per-cycle `failed_owners` set. The owner's later strategies are skipped
without another drain or log line. This mirrors the entry-backfill short-circuit (recon.md:28-31, :53).
The cycle does not broaden to `except Exception` (R-2). The entry backfill needs no code change
(recon.md:76-79).

**3. Servicer drain and callers.** `_drain_held_symbols` reduces the helper's rows to the summed
market-value dict (recon.md:36). Callers:
- `ScreenSymbols` (recon.md:39) gets a guard: on `_PositionsPageError` it logs a WARNING, marks no row `held` and still returns results.
- `_compute_opportunities` (recon.md:40-42) is unchanged. The raise reaches the kick path `_run` (recon.md:43-46), which already counts `recompute{full,failed}` and leaves the stored queue in place. There is no empty-map fallback (R-5).

**4. Daily refresh counter (D-11; operator decision r3).** In the per-user `except Exception` of
`_opportunity_refresh_tick` (`servicer.py:6061-6063`), add `telemetry.record_opportunity_recompute("full", "failed")`
after `failed += 1`. Also add `exc_info=True` to the WARNING. This reuses the existing instrument
and label set: no new instrument, no `kind=daily` (R-10), no daily `ok` (R-12), and no count inside
`_compute_opportunities` (R-11). `_log_items_tick` is untouched. The result per failed user: a WARNING
with traceback, `recompute{full,failed}` +1 with no user attribute, the previous queue kept, and the
schedule advanced. Partial failure writes an ordinary tick; no tick is written when every user fails
(R-8). The counter covers every exception the per-user catch handles (accepted scope).

**5. Guard and doc updates (D-14, D-15, D-16).**
- Add `record_opportunity_recompute("full","failed")` to the allowlist `_drive` (`tests/test_telemetry_allowlist.py:46-56`). It exercises existing keys only.
- Append the caveat to the Instruments line of `services/xstockstrat-analysis/CLAUDE.md` § Observability (`:327`): `failed` counts kick-path and daily per-user failures, `ok` is kick-path only, and no failed/(ok+failed) ratio over `kind=full` is meaningful. The `loop tick ok` sentence at `:326` stays word for word.
- `packages/otel/produced-signals.tsv` row, conditional. `/sdd-spec` verifies the exported series name before `/sdd-execute`; this is not a PR gate (R-14). Through the Grafana Cloud MCP, over 30d or more, it runs (a) `count by (__name__) ({__name__=~"analysis_opportunity_recompute.*"})` and (b) `count by (kind, outcome, service_name, <environment label>) (analysis_opportunity_recompute_total)`, or the same per stack (R-15). It records the datasource, the environment that answered, each query and each result. The expected name is `analysis_opportunity_recompute_total` (a Counter with no unit, `app/telemetry.py:442-444`); the verified name wins. The row copies the existing `metric` layout with the literal `analysis.opportunity.recompute` (`telemetry.py:443`). If prod and dev both return nothing, no row is written and the operator decides at spec time; the code steps are not blocked.
- About that row: it exists by operator mandate (r4 gate), not because the code needs it. No alert or dashboard consumes the series today. It is the first counter (`_total`) row in a registry of histogram and `target_info` rows, and it does not set a convention.

**6. Tests, red before green (D-5 substance, D-9, D-12, D-13).**
- Before the RED run, the spec sweeps the existing bare-`MagicMock` portfolio and shared-truthy-token fakes (`test_owner_header_guard.py:314`, `test_unreadable_formula.py:743`, `test_readiness_materializer.py:55`, `test_watchlist_readiness.py:35`, `test_analysis_servicer.py:4804,6509`, `conftest.py:103`). For each, it states whether the path reaches a held drain and the expected new outcome.
- RED fakes ignore `page_token` (recon.md:56, :99). Fakes that target `_drain_held_symbols` and its callers raise a `grpc.RpcError` subclass; only AC-4 uses a non-gRPC exception.
- `test_ac16_failed_held_drain_counted_without_owner` flips from `held == set()` to `pytest.raises` (recon.md:74).
- AC-5 and the new `@AC-10 @FR-4 @regression` go in `tests/test_analysis_tick_telemetry.py`. They use the real `_compute_opportunities` and `_drain_held_symbols` and a whole-stub `svc._portfolio`, because `make_servicer` leaves `_portfolio` None (R-9, R-13). AC-10 drives `_opportunity_refresh_tick` with u-1 and u-2 and a fake that branches on `x-user-id`.
- The AC-5 When step is narrowed to the on-demand recompute path.

**Touchpoints:** `servicer.py`, `live_loop.py`, the analysis tests above, `services/xstockstrat-analysis/CLAUDE.md`,
`packages/otel/produced-signals.tsv` (conditional), and this feature's product-spec.md and acceptance.feature.
No proto, migration, config, pool or other-service change. Features 351, 353 and 354 are not touched.

## Rejected Alternatives

- `R-1` Harden `_drain_held` and `_drain_held_symbols` in place, each with its own token guard. Rejected because the token rule and every RED fake would be duplicated across identical loop bodies (DRY guard rail).
- `R-2` Broaden the live-loop cycle handler to `except Exception` for held-drain failures. Rejected because typed failures make it unnecessary, and it would change handling for the out-of-scope watchlist and signal drains.
- `R-3` Wrap only the `ListPositions` await in the helper. Rejected because errors while reading the response would escape unwrapped and abort the cycle or the `ScreenSymbols` RPC.
- `R-4` Add `max_pages`/`page_size` parameters to the helper. Rejected as YAGNI: no test patches the drain-page constants.
- `R-5` Catch `_PositionsPageError` in `_compute_opportunities` and fall back to an empty held map. Rejected because held symbols would rank at 0.0 in a normal-looking queue, the silent partial result `fails.md:3311-3312` forbids.
- `R-7` Request the server's honoured page size (500 or less) so the cap covers 25k positions. Rejected because it changes the request literal and is out of scope; follow-up only.
- `R-8` Describe the daily-refresh failure as counted in the loop tick. Rejected because `_log_items_tick` (`servicer.py:377-382`) emits no failed count.
- `R-9` Run the AC-5 test on a harness whose kick or `_compute_opportunities` is mocked. Rejected because the held drain and `_run` would never run, so the test is vacuous (`fails.md:3350-3353`).
- `R-10` New label value `kind=daily` on `analysis.opportunity.recompute`. Rejected because the operator required reusing an existing label set, and the daily pass is a full-scope recompute.
- `R-11` Count daily-refresh failures inside `_compute_opportunities`. Rejected because it double-counts the kick path, which already records at `servicer.py:4957`.
- `R-12` Record a daily-path `recompute{full,ok}`. Rejected because it goes beyond the steer and changes the meaning of the kick-path `ok` series.
- `R-13` Set `ListPositions` on the `make_servicer` `_portfolio`, or share one `side_effect` across both AC-10 users. Rejected because `_portfolio is None` and a shared side_effect cannot fail u-1 while u-2 succeeds, giving a vacuous result.
- `R-14` Hold the PR behind a PR-time Mimir verification gate for the tsv row. Rejected because it holds a SEV-3 fix behind an external lookup for a row nothing consumes; verification moves to `/sdd-spec`.
- `R-15` Verify the series with a query not scoped to an environment. Rejected because it cannot show which stack produced the series, and alerts key on the short `service_name` (OTEL-1).

R-6 (no new metric on the daily-refresh path) is not listed. The operator reopened it at the r3 gate (petition P-3), and D-11 replaces it.

## Open Risks

- [ ] Mimir may hold no `analysis_opportunity_recompute*` series, because a counter exports only after its first `add`. The tsv row would then wait on an operator call. Query prod and dev over 30d or more before declaring it absent. To be addressed at `/sdd-spec`.
- [ ] The produced-signals row would be the first counter (`_total`) row, and a later reader may take it as a convention. design.md records it as operator-mandated with no consumer. To be addressed at the tsv step.
- [ ] `recompute{kind=full,outcome=failed}` now merges a kick-path failure (retried on next read) with a daily-refresh failure (queue stale for about 24h). `ok` is kick-path only, so a failed/(ok+failed) ratio reads high. Only the CLAUDE.md caveat mitigates this. To be addressed at the CLAUDE.md step.
- [ ] The daily counter also counts per-user failures that are not held-drain failures: an `owner_metadata` ValueError, and lock or replace errors. Accepted scope; stated in the CLAUDE.md caveat step.
- [ ] If every user fails during a portfolio outage at the refresh hour, `recompute{full,failed}` rises by N, no `loop tick ok` is written, and all queues stay stale for about 24h. Accepted; recorded at the daily-refresh step.
- [ ] The effective fail-closed bound is 5,000 positions per owner, because portfolio clamps the page size to 100 (`portfolio_repo.go:137-138`). Accepted; R-7 is the follow-up.
- [ ] A transient held-drain failure at boot leaves the entry-backfill cooldown state unseeded until the process restarts (`entry_backfill.py:52-58,142-159,199-202`). Accepted; verified by test at the callers step.
- [ ] The D-9 sweep must land before RED, or existing bare-`MagicMock` fakes go red for the wrong reason. To be addressed at the RED step.
- [ ] AC-5 and AC-10 rebind the real `_compute_opportunities`, so they may need a rebase against `308-fix-analysis-per-symbol-isolation`. To be addressed at the RED/test step.
- [ ] `next == sent` misses an A to B to A token cycle; the 50-page cap is the backstop. Wrapping every page exception turns programming errors into owner skips, with `__cause__` preserved. Accepted; recorded at the helper step.
- [ ] The un-guarded `gather` at `servicer.py:5365` leaves sibling drains running when the held drain raises. This is existing behaviour and is out of scope (recon.md:100).

## Constitution Rules Touched

- `C-01` — honored by: the change stays inside the analysis service's own modules; the portfolio contract is unchanged.
- `C-03` — honored by: drains keep their current metadata (`owner_metadata(owner)` in the live loop, inbound `propagation_meta` in the servicer); header propagation is unchanged (recon.md:94).
- `C-08` — honored by: no proto change, so no proto gate is triggered.
- `C-11` — honored by: five full-mode rounds, operator decisions recorded in context.md, every assumption on record in debate.md.
- `C-15` — honored by: the new `@AC-1..@AC-10 @feature-356` scenarios, including the new `@AC-10` and the narrowed `@AC-5` When step, with red before green against fakes that ignore the token.
- `C-16` — honored by: every affected existing `@AC-*` is listed below as PRESERVE or EXTEND; there is no CHANGE.
- `C-18` — honored by: one shared helper with no alias or rename; `_BAR_PAGE_SIZE` naming accepted (O-2); the CLAUDE.md caveat is one appended clause.
- `P-01` — honored by: one writer for the feature docs.
- `P-02` — honored by: the debate register binds every round, and reopened entries came back only through operator-accepted petitions (P-1..P-3).
- `P-03` — honored by: record wording corrected against the code (O-3, O-4, O-6, O-7).
- `P-06` — honored by: open risks mirrored into context.md Open Threads.
- `F-07` — honored by: no Floor breach in any round; fail-closed behaviour returns no partial or duplicated held set.
- `PLAT-4` — honored by: the outbound `ListPositions` call keeps `x-user-id` / `x-access-scope` / `x-trace-id` propagation unchanged.
- `PLAT-N1` — honored by: the best-effort drain pattern ends for held drains (fail closed), and the RED output is recorded before green.

## Business Rules Touched (C-16)

- PRESERVE `@AC-16 @feature-294` "A failed portfolio drain is counted as a degraded universe" (`services/xstockstrat-analysis/acceptance/signal-map-instrumentation.feature`). Not regressed: `_drain_held` records `drain_failures{held}` once per failed owner per cycle with no owner attribute, then re-raises. The test changes to `pytest.raises` (operator decision 2026-11-17).
- PRESERVE `@AC-8 @feature-262` "A non-ValueError drain failure for one owner does not stop the backfill for other owners" (`fix-analysis-owner-scope.feature`). Not regressed: `_PositionsPageError` is not a `ValueError`, and the backfill's `except Exception` isolation is unchanged (operator decision 2026-11-17).
- PRESERVE `@AC-3 @feature-262` "One owner whose drains fail does not stop the backfill for other owners". Same seam, unchanged.
- PRESERVE `@AC-6 @feature-191` "Phase 0 drains execute concurrently" (`opportunities-latency-fix.feature`). `_drain_held_symbols` stays in the 4-way `gather`.
- PRESERVE `@AC-6`/`@AC-7` `@feature-185` and `@AC-10 @feature-289` (`opportunity-compute-robustness.feature`). The kick-path recompute failure is unchanged; `@AC-7` `compute_failed` stays cold-read-only (`servicer.py:4784-4795`).
- PRESERVE `@AC-2 @feature-168` and `@AC-1`/`@AC-3 @feature-193`. These assume a complete held set, which the fix now guarantees or else fails.
- PRESERVE feature-097/158 daily opportunity refresh per-user isolation and loop-tick semantics. `_log_items_tick` is untouched and CLAUDE.md `:326` stays word for word.
- PRESERVE `@AC-41 @feature-294` (telemetry label-key allowlist). `_drive` gains the `("full","failed")` call; the key set is unchanged.
- EXTEND `@AC-51 @feature-294` "background full opportunity recompute fails → recompute{full,failed} +1" (`signal-map-instrumentation.feature:37-45`). It is now also triggered by daily-refresh per-user failures (`servicer.py:6061-6063`) as well as the kick path (`servicer.py:4957`). The scenario text is unedited, because its Given (`:40`) and Then (`:45`) already cover both. The `test_analysis_tick_telemetry.py:174-184` test stays kick-path-only at exactly 1. Operator decision 2026-11-17 (design gate r3).
- EXTEND `@AC-5 @feature-356`. The When step is narrowed to the on-demand recompute path. Operator decision 2026-11-17 (design gate r3).
- EXTEND `@AC-10 @feature-356` (new). A failed daily-refresh user is counted, the previous queue is kept, and the schedule advances. Operator decision 2026-11-17 (design gate r3).
- EXTEND `@AC-1..@AC-9 @feature-356`. These are the fail-closed held-drain rules. Operator decision 2026-11-17 (follow `fails.md:3311`).
- CHANGE: none.

## Rounds

5 rounds, full mode (all run by /sdd-batch on 2026-11-17).
- r1: shared helper chosen and the typed failure fixed (D-1..D-5).
- r2: wrap scope, cap bound and fake sweep (D-6..D-10).
- r3: record-accuracy and harness objections, plus petitions P-1 and P-2.
- r4: operator steer applied; daily-refresh counter and AC-5/AC-10 harness (D-11..D-14); P-3.
- r5: produced-signals verification and the @AC-51 EXTEND bookkeeping (D-15, D-16).

**Termination:** approved. The operator approved at the r5 gate with no open objection and no Floor
breach. Petitions P-1 (D-7), P-2 (D-5) and P-3 (R-6) are recorded as `user reopened`; D-11 supersedes
D-7 and D-12 supersedes D-5.
