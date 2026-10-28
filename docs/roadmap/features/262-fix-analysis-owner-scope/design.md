# Design: fix-analysis-owner-scope

**Created**: 2026-10-22
**Rounds**: 2 (full; termination: approved)
**Approved by**: operator @ 2026-10-22 (design gate r2: "APPROVED as synthesized, including the deletion-first Step 3 test-mock rule")
**Grounded in**: recon.md

---

## Chosen Approach

Three code steps plus a docs Step 0, all inside `services/xstockstrat-analysis`. There are no proto,
migration, config, trading or `main.py` changes. The change is internal-only: there is no consumer surface
(UI segment or Agent tool) to update (C-14). Its effect is that the live loop's per-owner entry state is
seeded only from that owner's trading orders.

**Step 0 (docs, at /sdd-spec, before code).** Append `@AC-9 @FR-4 @regression` to `acceptance.feature`
after `@AC-7`. The scenario has blend enabled and a live strategy `"s-2"` owned by `"u-a"` on `"MSFT"`, and
the fundamentals-universe resolve raises. Expected:
- the boot pass completes without raising;
- `("u-a","s-2","MSFT")` is seeded;
- no `ListOrders` goes out for the blend strategy;
- a warning names the failed resolve.

This scenario is additive, so it needs no C-16 sign-off. It closes the review's open FR-4 item:
`_resolve_fundamentals_universe` at `entry_backfill.py:90` was not covered by any FR or AC
(context.md, sdd-review session).

**Step 1 (FR-1/FR-2): owner-scoped `ListOrders`.** In `app/engine/entry_backfill.py:63-82`
(recon.md:246-248):
- Mint `pass_trace_id = uuid.uuid4().hex` once per pass, following the precedent at `servicer.py:3604`.
- Inside the existing per-pair `try` (`entry_backfill.py:70-76`, recon.md:74-76), build
  `md = owner_metadata(user_id) + [("x-trace-id", pass_trace_id)]`. An `owner_metadata` `ValueError` for an
  empty or `"system"` owner (`app/identity.py:6-10`, recon.md:45) then stays pair-local.
- Call `ListOrders(ListOrdersRequest(user_id=user_id, strategy_id=strategy_id, symbol=symbol), metadata=md)`.
  The body `user_id` is load-bearing: trading adds no owner predicate when it is empty
  (`trading_repo.go:229-231`, recon.md:65, :176-178). The header keeps the call correct if trading later
  scopes non-admin reads by `x-user-id`.
- Replace the "owner-implicit" comment at `:64-65` (recon.md:220) with two lines: the 3-tuple key
  constraint, and "body user_id is load-bearing: trading treats empty as all users".
- Add imports for `uuid` and `app.identity.owner_metadata`.
- Include `pass_trace_id` in every new warning and in the "boot pass complete" info log (`:123`), so
  trading-side traces can be matched to the analysis pass (operator trace-id decision 2026-10-21).

**Step 2 (FR-3/FR-4): failure isolation in `run_once`** (recon.md:253):
- (a) Wrap the strategies `db_pool.fetch` (`:59-61`): warn and return.
- (b) Wrap `_resolve_fundamentals_universe` (`:89-91`): fall back to `set()`. The existing blend skip
  (`:110-111`) then drops the blend pairs. That skip stays ahead of `resolve_universe` and of any
  `ListOrders`, which preserves 193 `@AC-3` (recon.md:113-116, :233). This is `@AC-9`.
- (c) Wrap `_drain_system_signals` (`:94`): fall back to `set()`. Add no comment claiming it protects
  production.
- (d) Split the row loop (`:99-121`) into three phases:
  - **Row-scoped parse.** Wrap `_row_to_strategy_definition(d)` in a `try`. On `Exception`, warn with
    `strategy_id` and `user_id` and continue, without adding the owner to `failed_owners`. The function is
    strict and raises `KeyError` on a missing key and `ParseError` on bad `definition_json`
    (`servicer.py:7193-7220`, verified r2).
  - **Owner-scoped prep.** Skip the row if its owner is already in `failed_owners`. Otherwise drain held
    and watchlist into locals, then commit both to the caches together. This closes the partial-cache
    `KeyError` at `:114`. On `Exception`, warn, add the owner to `failed_owners`, and continue.
  - **Owner-signal drain** (`:106-109`). It gets its own `try`. On failure it falls back to
    `system_signals` with a warning and does **not** poison the owner. Only a held/watch failure poisons an
    owner (open objection 2, adopted).
  - **Row-scoped resolve.** The blend skip runs first. Then `resolve_universe` runs in its own `try` (warn
    and continue, no `failed_owners`), and pairs are appended unchanged.
  - Every handler catches `Exception`, so `CancelledError` still propagates.
- (e) At end of pass, emit one warning per failed owner listing every skipped `strategy_id`.
- (f) Loop over the `gather(..., return_exceptions=True)` results at `:122` and warn on each `Exception`.
- (g) Correct the "never raises" docstring at `:50-53`.

**Step 3 (FR-5/FR-6, last): delete dead repository methods.**
- Delete `StrategiesRepository.get_by_id` (`strategies.py:89-97`) and `.update` (`:110-124`), and rewrite
  the `:100` docstring (recon.md:56, :261). Grep finds 0 callers in `app/`.
- Use the **deletion-first** test rule (operator-approved r2). Every single-line `get_by_id` mock is
  already followed by an explicit `get_by_owner_and_id`:
  - (i) Delete each `get_by_id` line whose next line already sets `get_by_owner_and_id`. In
    `tests/test_analysis_servicer.py` these are 119, 684, 799, 812, 986, 1008, 1075, 2175 (`repo.`), 2285,
    2815, 2892, 3119, 3170, 3451 (`repo.`), 4036, 4149, 6216, 6234, 6252, 6269, 6286, 6407, 6427 and 7592.
    In `tests/test_readiness_opportunities_source_symbol.py` they are 61 and 189.
  - (ii) At `:1975/:1984` and `:2003/:2012`, assign `get_by_owner_and_id = AsyncMock(return_value={...})`
    directly and drop the alias.
  - (iii) Delete `:4500`; the `(uid, sid)` mock already exists at `:4503-4505`. Reword the `:4501-4502`
    comment.
  - (iv) Retarget `:6335` to `get_by_owner_and_id.assert_not_awaited()`. The disable path never calls it
    (`servicer.py:3412-3415`).
  - (v) Reword the stale "get_by_id" comments at `:978` and `:1007`.
- No test references `_strategies_repo.update`.
- Also reword the `servicer.py:3174` comment, and set the analysis `CLAUDE.md:230` entry to
  "ListOrders(user_id, strategy_id, symbol) + owner x-user-id".

**Tests (P-06 red-before-green):**
- `@AC-3`: runs on the real `LiveEvaluationLoop`, via the `_live_loop` helper
  (`tests/test_owner_header_guard.py:139`). The helper moves to `tests/conftest.py` because it now has a
  second consumer (C-13). A `"system"` row comes before a `"u-a"` row. The test is red today because the
  real `owner_metadata` `ValueError` escapes `run_once`. Green means u-a is seeded and caplog names
  `s-sys`/`system`. If the conftest move collides with another feature, the fallback is a side effect that
  reproduces the real semantics.
- `@AC-8`: an `AsyncMock` `_drain_held` raises `RuntimeError` for `"u-b"` only.
- `@AC-2`: an owner-filtering `ListOrders` fake, `async def _list_orders(req, metadata=None)`. Also add
  `metadata=None` to the existing fakes at `tests/test_entry_backfill.py:153` and `:227` (recon.md:103).
- Row-vs-owner split: one u-a row missing `display_name` plus one valid u-a row. The valid row is seeded.
- `@AC-4`, `@AC-5`, `@AC-9`: make the relevant call raise, then assert with caplog.
- Header guard (`test_owner_header_guard.py:175`): replace the `MagicMock` with
  `RecordingStub({"ListOrders": SimpleNamespace(orders=[])})`. Assert `trading.calls` is non-empty first
  (fails.md:2659). Then check each call for `x-user-id == ["bob"]`, a non-empty `x-trace-id`, and
  `req.user_id == "bob"`.

**Merge order:** 244 merges first. Its overlap is ADJACENT at `entry_backfill.py:56-61`, and a textual
rebase conflict is expected. `main.py:174` (the supervised-loop helper) stays with 259. 262's guards are
in-function and do not need that helper.

## Rejected Alternatives

- Mechanically renaming `get_by_id` to `get_by_owner_and_id` in the test mocks (r2's Step 3 rules for :684,
  :799 and :4500): rejected. Every site already sets `get_by_owner_and_id` on the next line, so a rename
  creates duplicate assignments where the later one silently wins. It would also bake wrong line-level
  instructions into a step body that cannot be edited once approved (F-09).
- Atomic cache writes without `failed_owners`: rejected because `system` and empty owners would re-drain
  and re-warn on every row.
- One `try` around the whole per-row body (recon's first cut): rejected because it cannot tell a malformed
  row from a failed owner prep. Either one bad row poisons the owner, or `failed_owners` is never filled.
- Adding the owner to `failed_owners` on a parse failure: rejected because one bad row would silently drop
  the owner's other valid strategies.
- A per-pair trace id: rejected because a boot pass is one logical unit of work, and a per-pass id is
  enough once it is logged.
- Recording "no trace id available" instead of minting one: rejected because it contradicts the operator's
  standing trace-id decision (2026-10-21).
- Copying `live_loop.py:522` into an `AsyncMock` side effect for `@AC-3`: rejected because the copy goes
  stale silently when the drain changes, and the real-loop helper already exists.
- Scoping the `:89-91` blend-universe guard out to a follow-up: rejected because it leaves a whole-pass
  abort in place, when the fix is one `try` that reuses the `:110-111` skip.
- Owner-scoping `get_by_id`/`update` instead of deleting them: rejected because they would duplicate
  `get_by_owner_and_id`/`update_locked` (C-18), and FR-5 settles it with 0 callers in `app/`.
- Sending only the `x-user-id` header without the body `user_id`: rejected because
  `trading_repo.go:229-231` fails open on an empty body `user_id`.
- Catching only `ValueError`: rejected because FR-3/`@AC-8` require any drain failure to be isolated.
  Catching `Exception` still lets `CancelledError` propagate.

## Open Risks

- [ ] Concurrent edits to `tests/test_analysis_servicer.py` from 215, 244 and 245. The deletion-first rule
  reduces these to one-line deletion conflicts. A resurrected `get_by_id` line on the bare `AsyncMock` repo
  is dead rather than failing, so it would go unnoticed. To be addressed at Step 3 (rebase check: `grep
  get_by_id tests/` returns 0).
- [ ] Moving `_live_loop` into `tests/conftest.py` may collide with other features that edit `conftest.py`
  or `test_owner_header_guard.py`. If it does, fall back to the side effect that reproduces the real
  semantics. To be addressed at Step 2.
- [ ] Textual rebase conflict with 244 at `entry_backfill.py:56-61` (adjacent lines). To be addressed at
  /sdd-spec (merge-order.md row) and at Step 1 (rebase).
- [ ] The "no callers" claim for `get_by_id`/`update` rests on grep, so a dynamic `getattr` call would not
  show up. To be addressed at Step 3 (full test suite run).
- [ ] If the separate trading-side `ListOrders` report later scopes by header rather than body, the trading
  change must keep accepting this call shape (body `user_id` + `x-user-id` + `x-trace-id`). Tracked
  outside this feature (`docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md`).
- [ ] The live_loop drains still carry no `x-trace-id`. This is accepted on purpose, because adding one
  needs a signature change that is out of scope. To be recorded in context.md at /sdd-spec.

## Constitution Rules Touched

- `C-03`: honored by the per-pass `x-trace-id` on every backfill `ListOrders`, also logged. There is no
  waiver, and the work has no originating request, so it mints its own id per the operator decision.
- `C-11`: honored by running the full design debate (2 rounds) with an operator gate before any code.
- `C-13`: honored by moving `_live_loop` to `tests/conftest.py` once it has a second consumer, and by
  reusing `RecordingStub` instead of adding new fakes.
- `C-15`: honored by adding `@AC-9` to `acceptance.feature` at Step 0, before code. Every FR maps to an
  `@AC-*`.
- `C-16`: honored. The durable suites are PRESERVE only, and the feature's own `@AC-1..@AC-8` are covered by
  operator decisions (see below).
- `C-18`: honored by deleting the duplicate owner-agnostic repo methods rather than keeping parallel APIs.
- `F-09`: honored by fixing the deletion-first Step 3 rule now, before the step body is approved.
- `P-02`: honored. The proposer and adversary were mediated through synthesized state only.
- `P-03`: honored. Every line-level claim was re-verified against the worktree (Step 3 sites, the strict
  `servicer.py:7193-7220` parse).
- `P-06`: honored by writing each AC test red before the fix (`@AC-3` on the real loop reproduces the
  escaping `ValueError`).

## Business Rules Touched (C-16)

- PRESERVE `@AC-3` "the boot entry-backfill anchors the blend only inside the fundamentals universe"
  (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`, `@feature-193`).
  Not regressed: the blend skip (`:110-111`) stays ahead of `resolve_universe` and `ListOrders`, and the
  pair set is unchanged.
- PRESERVE `@AC-20` "Strategy id collision on instantiation", `@AC-21` "Same strategy_id for two users does
  not share scores or backtests" and `@AC-34` "Caller-chosen strategy id on instantiation"
  (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`). Not regressed: only
  `get_by_id`/`update` are removed, and the test deletions leave the explicit `get_by_owner_and_id` values
  in place.
- CHANGE 262 `@AC-1` (owner-scoped `ListOrders`: body `user_id` + `x-user-id`), `@AC-2`, `@AC-3` (a
  `system`/empty owner is skipped pair-locally), `@AC-4`, `@AC-5`, `@AC-6` (dead `get_by_id`/`update`
  removed), `@AC-7` and `@AC-8` (a drain failure is isolated per owner). Signed off by operator decisions
  2026-10-21 (scope is D-44/D-55/D-60, Track C; context.md, sdd-triage and sdd-review sessions) and
  2026-10-22 (design gate r2 "APPROVED as synthesized"; context.md). Recon (recon.md:150-153) notes that no
  durable `@AC-*` asserts the buggy behavior. These scenarios are the feature's own and are promoted at
  launch.
- EXTEND 262 `@AC-9` "a failed blend-universe resolve skips only the blend pairs". It is appended at Step 0
  and is additive, so it needs no sign-off.

## Rounds

- **Round 1 (full):** the recon approach was attacked on three blocking points: the `@AC-3` red test did not
  reproduce the real `owner_metadata` `ValueError`, `failed_owners` was ambiguous, and `@AC-9` was missing.
  All three were answered concretely in round 2.
- **Round 2 (full):** the approach stood. The one blocking objection was that the Step 3 test rule had to
  become deletion-first; this was re-verified against the worktree. Non-blocking amendments were adopted:
  - a separate `try` for the owner-signal drain;
  - `@AC-3` on the real loop;
  - `pass_trace_id` in the logs;
  - per-owner skip summaries;
  - a non-empty calls assertion;
  - the adjacent overlap with 244.
- **Termination:** approved. The operator approved at the r2 gate (2026-10-22) "as synthesized, including
  the deletion-first Step 3 test-mock rule", which resolves the last blocking objection. Floor clear (no
  `F-*` breach).
