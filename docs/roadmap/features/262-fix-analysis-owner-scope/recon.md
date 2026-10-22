# Recon: fix-analysis-owner-scope

**Created**: 2026-10-21
**From**: product-spec.md
**Affected services**: xstockstrat-analysis (fix site), xstockstrat-trading (read-only; `ListOrders` semantics)

---

## Objective

Make the boot entry-backfill owner-scoped and failure-isolated. Its `ListOrders` call must carry the row's
owner, both as the body `user_id` and as `owner_metadata(user_id)`, so one owner's fills never seed another
owner's entry state (D-44). One bad owner or a failed read must not end the pass for everyone (D-55). The
dead owner-agnostic `StrategiesRepository.get_by_id` / `.update` methods are removed, and their stale test
mocks are retargeted (D-60). This is a SEV-2 Track C fix. Scope is D-44, D-55 and D-60 only; the trading-side
`ListOrders` header-scoping report stays separate (operator decision, 2026-10-21).

## Codebase Map

- **`xstockstrat-analysis`** (Python)
  - Entry point: `app/main.py:174-176`. The backfill is started as an unretained
    `asyncio.get_event_loop().create_task(backfill_entry_times(live_loop, db_pool, servicer._trading, cfg_watcher))`.
  - Fix site: `app/engine/entry_backfill.py:49` `run_once(live_loop, db_pool, trading_stub, cfg_watcher)`.
    - `:50-53` docstring says "Never raises".
    - `:59-61` `rows = await db_pool.fetch(...)` is unguarded (D-55, FR-4).
    - `:63` `_backfill_pair(user_id, strategy_id, symbol)`. The comment at `:64-65` says "ListOrders stays
      owner-implicit". The call at `:71-73` is `ListOrders(ListOrdersRequest(strategy_id=strategy_id, symbol=symbol))`
      with no `user_id` and no `metadata=` (D-44). The `except Exception` at `:74-76` is already pair-local.
      The seeding writes are at `:80-82`.
    - `:89-91` `await live_loop._resolve_fundamentals_universe()` runs only when `blend_active`. It is unguarded,
      and no FR or AC covers it (an open question carried from sdd-review).
    - `:94` `system_signals = await live_loop._drain_system_signals()` is unguarded (FR-4).
    - `:98-118` is the per-row loop. The `:102-104` held/watchlist drains and the `:108` owner-signal drain are
      unguarded per-owner awaits (FR-3). `resolve_universe(...)` at `:112-119` reads `watch_cache[owner]` and
      `held_cache[owner]`.
    - `:122` `asyncio.gather(*tasks, return_exceptions=True)` already isolates the per-pair tasks.
  - Handler/servicer (owner-scoped sibling): `app/handlers/servicer.py:6315-6318`, a
    `ListOrders(ListOrdersRequest(strategy_id=strategy_id, user_id=user_id), metadata=propagation_meta)` call.
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`). None
    needed.
  - Config-read pattern: `entry_backfill.py:57`
    `cfg_watcher.get_int("analysis.strategy.max_concurrent_entry_backfill", 4)`. `:87`
    `cfg_watcher.get_bool("analysis.engine.fundamentals_blend_enabled", True)`.
  - Other key symbols:
    - `owner_metadata` — `app/identity.py:6-10`. It raises `ValueError` for an empty or `"system"` owner.
      `SYSTEM_IDENTITY = "system"` is at `:3`.
    - `LiveLoop._drain_system_signals` — `app/engine/live_loop.py:472`. It uses `_SYSTEM_READ_META` and never
      calls `owner_metadata`.
    - `LiveLoop._drain_owner_signals` — `live_loop.py:476`. It calls `owner_metadata(owner)` at `:478`.
    - `LiveLoop._drain_signals_with` — `live_loop.py:480`. It already catches `QuerySignals` RPC errors per
      page (`:501-503`) and returns the partial set.
    - `LiveLoop._drain_held` — `live_loop.py:517`. It calls `owner_metadata` at `:522` and catches the
      `ListPositions` RPC error (`:534-536`).
    - `LiveLoop._drain_watchlist` — `live_loop.py:545`. It calls `owner_metadata` at `:551`.
    - `LiveLoop._resolve_fundamentals_universe` — `live_loop.py:510`.
    - `StrategiesRepository.get_by_id` — `app/repositories/strategies.py:89-97` (`WHERE strategy_id = $1`).
    - `StrategiesRepository.update` — `strategies.py:110-124` (`WHERE strategy_id = $1`, `:117`).
    - Keep `get_by_owner_and_id` (`:99`) and `update_locked` (`:126`, `WHERE strategy_id = $1 AND user_id = $2`
      at `:148`). The `get_by_owner_and_id` docstring at `:100` cross-references `:meth:get_by_id` and must be
      edited when that method is removed.
- **`xstockstrat-trading`** (Go) — read-only, no change
  - Proto: `packages/proto/trading/v1/trading.proto:168-169`. `ListOrdersRequest { string user_id = 1; string strategy_id = 2; ...`.
  - Service: `internal/service/trading.go:1586-1587` passes `req.UserId` straight to the repository. The
    in-memory fallback at `:1593` has the same semantics (`if req.UserId != "" && ...`).
  - Repository: `internal/repository/trading_repo.go:229-231`. The `AND user_id = $n` predicate is added only
    when `userID != ""`, so an empty `user_id` returns every owner's orders (fail-open).
  - Contract: `services/xstockstrat-trading/CLAUDE.md:45-47`. `ListOrders` keeps the body `user_id` as a
    "cross-user filter/subscription selector (empty = all users, for trusted internal callers)". The
    `x-user-id` header alone does **not** scope the result, so analysis must send the body `user_id`.

## Patterns to REUSE

- Owner-scoped `ListOrders` (FR-1) → reuse the request shape at `app/handlers/servicer.py:6315-6318`:
  `ListOrdersRequest(..., user_id=user_id)` plus `metadata=`. Build the metadata with `owner_metadata(user_id)`
  (`app/identity.py:6`), not a hand-rolled tuple. Build it **inside** the existing `try` at
  `entry_backfill.py:70-76`, so its `ValueError` stays pair-local.
- Per-owner skip guard (FR-3) → mirror `app/engine/live_loop.py:384-395`: `try: <drains> except ValueError as e:
  log.warning("live_loop: strategy %s skipped — %s", ...); continue`. Adapt it in two ways:
  - Catch `Exception`, not only `ValueError`, as FR-3 and `@AC-8` require.
  - Name the owner as well as the strategy in the warning. `@AC-3` and `@AC-8` assert the warning names both.
- Best-effort drain semantics (FR-4) → `_drain_signals_with` (`live_loop.py:480-508`) already turns an RPC
  failure into a warning plus a partial or empty set. The FR-4 guard around `:94` is the same contract lifted
  one level up.
- Unretained task (`main.py:174`) → do **not** add a helper. Feature 259 (`fix-python-loop-supervision`,
  D-07) owns the supervised-task helper. It exists only on `origin/feature/fix-python-loop-supervision` today
  and is not on this branch. Reuse it if 259 lands first; otherwise leave `main.py` untouched. FR-3 and FR-4
  are in-function guards and do not need it.
- Tests:
  - `tests/test_entry_backfill.py`, `TestRunOnce` at `:115`. Helpers:
    - `_order(side, filled_qty, updated_at, status=...)` at `:21` builds a real `trading_pb2.Order`.
    - `_strategy_row(...)` at `:29`.
    - `_fake_live_loop(held, watchlist, signals)` at `:49`. Its drains are `AsyncMock`s, so a drain can be
      made to raise by overriding its `side_effect`.
    - `_cfg()` at `:64`.
  - The existing stub pattern `trading_stub.ListOrders = AsyncMock(side_effect=_list_orders)` (`:158`, `:232`)
    extends to:
    - a `req.user_id`-filtering fake for `@AC-2`;
    - `call.kwargs["metadata"]` assertions for `@AC-1`;
    - `db_pool.fetch = AsyncMock(side_effect=Exception(...))` for `@AC-4`.
  - `TestRunOnce` builds `db_pool = AsyncMock()` with `db_pool.fetch = AsyncMock(return_value=[...])`
    (`tests/test_entry_backfill.py:118-119`). The file has no `caplog` use yet; the warning assertions for
    `@AC-3`, `@AC-4`, `@AC-5` and `@AC-8` can follow the `caplog` usage in `tests/test_live_loop.py`.
  - The existing `_list_orders(req)` side-effect fakes (`tests/test_entry_backfill.py:153`, `:227`) take only
    `req`. Once FR-1 passes `metadata=`, they raise `TypeError` (swallowed per pair, so the tests fail on
    missing seeds). They need a `metadata=None` parameter in the same step. `trading_pb2.Order` has
    `user_id = 16` (`packages/proto/trading/v1/trading.proto`, `message Order`), so the `@AC-2` fake can tag
    orders by owner and filter on `req.user_id`.
  - Python fixture home (C-13) is `tests/conftest.py`. The literals stay inline while they have a single
    consumer.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3` "the boot entry-backfill anchors the blend only inside the fundamentals universe"
  (`services/xstockstrat-analysis/acceptance/fix-blend-queue-fundamentals-universe.feature`, `@feature-193`).
  The backfill issues no `ListOrders` for a blend pair outside the fundamentals universe. FR-1 must keep this
  pair set unchanged and only add owner scoping.
- **PRESERVE** `@AC-21` "Same strategy_id for two users does not share scores or backtests"
  (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`, `@AC-21 @FR-10 @feature-224`).
  A shared `strategy_id` must not leak across owners. FR-2 applies the same isolation to entry state, and the
  FR-6 test retargeting must keep this scenario green.
- **PRESERVE** `@AC-11` "Live loop signal eligibility sees only the owner's signals"
  (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`, `@AC-11 @FR-6 @feature-224`).
  Live-loop state stays owner-keyed. The backfill seeds that state and must not cross owners.
- **PRESERVE** `@AC-20` "Strategy id collision on instantiation" and `@AC-34` "Caller-chosen strategy id on
  instantiation" (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`, `@FR-9 @feature-224`).
  Both run through the strategies repository. FR-5 removes only `get_by_id` and `update`, never
  `get_by_owner_and_id` or `update_locked`.
- **PRESERVE** `@AC-30` "Registering a strategy that references an unreadable formula warns at write time"
  (`services/xstockstrat-analysis/acceptance/private-by-default-templates.feature`, `@AC-30 @FR-3 @feature-224`).
  FR-6 retargets mocks on this `ManageStrategy REGISTER` path; the behavior is unchanged.
- **PRESERVE** `@AC-17` "An ownerless order event issues no owner-scoped call"
  (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`, `@AC-17 @FR-1 @feature-225`).
  An empty-owner unit is skipped, never sent headerless. This is the model for FR-3.
- **PRESERVE** `@AC-16` "An ungranted system identity is refused by analysis"
  (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`, `@AC-16 @FR-1 @feature-225`).
  The `system` owner row that FR-3 skips is the same identity analysis refuses inbound.
- **PRESERVE** `@AC-8` "A headerless owner-scoped call is rejected in analysis"
  (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature`, `@AC-8 @FR-1 @feature-225`).
  Removing the owner-agnostic repository methods (FR-5) must not weaken the inbound gate. The servicer already
  uses `get_by_owner_and_id`.
- **PRESERVE** `@AC-6` "The fundamentals loop still runs the system scoring formula"
  (`docs/sdd/business-rules/platform.feature`, `@AC-6 @FR-3 @FR-1 @feature-224`). This fix does not touch the
  recorded `system` + `analysis-fundsignal` exception.
- **PRESERVE** `@AC-26` "System-owned fundamentals signals are visible to every user"
  (`docs/sdd/business-rules/platform.feature`, `@AC-26 @FR-6 @feature-224`). The system-signal drain keeps its
  consumption semantics. FR-4 only adds failure tolerance (a warning plus an empty set).
- **PRESERVE** `@AC-5` "Header-propagation semantics are unchanged beneath mTLS"
  (`docs/sdd/business-rules/platform.feature`, `@AC-5 @FR-5 @feature-210`). The new `x-user-id` metadata on the
  backfill's `ListOrders` follows the existing propagation shape (`owner_metadata`).
- No existing acceptance suite covers trading `ListOrders` owner scoping. `services/xstockstrat-trading/acceptance/`
  has 8 suites and none touches `ListOrders`. Trading-side scoping is out of scope and tracked in
  `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md`.
- No **CHANGE** flags. Every FR adds owner scoping or failure isolation, or removes dead code. No durable
  `@AC-*` asserts the buggy behavior, so no C-16 sign-off is needed. The feature's own `@AC-1..@AC-8` are
  additive. The closest conflict risk is 193 `@AC-3`: the universe filter and the blend skip
  (`entry_backfill.py:110-111`) must stay ahead of the `ListOrders` issuance.
- Coverage caveat: all of `services/xstockstrat-analysis/acceptance/` was grep-scanned, but only four suites
  were read in full or in part, so a scenario that matches neither the grep terms nor these topics could be
  missed.

## Dependencies

- Proto/RPC: none changed. Consumes `trading.v1.ListOrdersRequest.user_id` (field 1) and `strategy_id`
  (field 2), `packages/proto/trading/v1/trading.proto:168-169`.
- Migration: none. The last analysis migration is `027_contract_owner_dimension`. The analysis `CLAUDE.md:515-524`
  config rows say "Seeded by migration `028` (feature 184)", but no `028` file exists in `migrations/`. Not
  investigated; irrelevant here since no migration is needed.
- Config keys: none new. The existing `analysis.strategy.max_concurrent_entry_backfill` (`entry_backfill.py:57`)
  and `analysis.engine.fundamentals_blend_enabled` (`:87`) are unchanged.
- Inter-service edges: the existing analysis → trading `ListOrders` edge (`TRADING_ENDPOINT`, same stub
  `servicer._trading`). It gains `x-user-id` metadata and a body `user_id`. There is no new edge.
- New env vars / ports: none.

## Risks / Not-found

- **Trading is fail-open on an empty body `user_id`** (`trading_repo.go:229-231`). Header metadata alone does
  not scope the result (`services/xstockstrat-trading/CLAUDE.md:45-47`). FR-1 must send **both** the body
  `user_id` and `owner_metadata(user_id)`. The body field is the one that scopes today. The header keeps the
  call correct if the separate trading report (`2026-10-19-trading-listorders-body-user-id-filter-defect.md`,
  `open`) later scopes non-admin `ListOrders` to `x-user-id`.
- **The `:90` blend-universe resolve is unguarded and uncovered.** `_resolve_fundamentals_universe()` can raise
  and end the pass. It is not named in FR-4 and has no AC. Design must either degrade it to an empty blend
  universe (extend FR-4 and add an append-only `@AC-9`) or scope it out explicitly. This question is carried
  from the sdd-review warnings in `context.md`.
- **Cache keys after a failed owner.** If an owner's drain raises after `held_cache[owner]` is set but before
  `watch_cache[owner]` is set (`:103-104`), a `continue` leaves the caches partially populated. The owner's next
  row would then skip the `owner not in held_cache` branch and `KeyError` at `:114`. The guard must either
  record the owner as failed (for example a `failed_owners` set checked before the drains) or assign both
  caches atomically. Without a failure cache, each later row of a failed owner retries the drains and logs
  again. That is harmless but noisy, so design should choose.
- **What `@AC-8` actually exercises.** `_drain_held` and `_drain_watchlist` already catch their RPC errors and
  return a partial set (`live_loop.py:534-536`; `_drain_signals_with` `:501-503`). A real portfolio RPC error
  therefore does not propagate out of the drain. `@AC-8` holds only against a mocked drain that raises. The
  production value of the broad `except Exception` is for unexpected errors such as `owner_metadata`'s
  `ValueError`, programming errors and cancellation-adjacent failures. Design should decide whether to keep
  the `@AC-8` wording ("raises a portfolio RPC error") or reword it as "the drain raises". Either way, do not
  catch `asyncio.CancelledError` (it is a `BaseException` in 3.13, so `except Exception` already excludes it).
- **`_row_to_strategy_definition` (`:100`) and `resolve_universe` (`:112`) are arguably within FR-3's
  "preparing one owner".** Wrapping the whole per-row body in the guard covers them at no extra cost.
- **`test_owner_header_guard.py:175` `test_entry_backfill_run_once`.** It stubs `ListOrders` on a plain
  `MagicMock` and asserts headers on ingest only (`:183`). After FR-1 it still passes. It is the cheapest place
  to extend the runtime header guard to the trading stub, per the 2026-10-06 `fails.md` header entry: prefer a
  runtime check that the stub received a non-empty `x-user-id` over an "argument present" check, because a
  `metadata=()` would pass the latter.
- **Test retarget scope (FR-6).** The grep `_strategies_repo.get_by_id\|_strategies_repo.update(` returns 28 hits
  in `tests/test_analysis_servicer.py`, 2 in `tests/test_readiness_opportunities_source_symbol.py` and 0 in `app/`.
  The `def update` / `get_by_id`-style names in `app/repositories/strategy_scores.py`, `strategy_templates.py`
  and `tests/test_strategy_templates.py` belong to other repositories and are out of scope. Verify each one
  before editing. `test_analysis_servicer.py` has the highest churn of any file here. 215 (in-progress), 244 and
  245 (implementation-ready) also touch it, so expect mock-setup rebase conflicts.
- **Overlap with 244 (`fix-python-config-stored-zero`, implementation-ready).** 244 edits
  `entry_backfill.py:56-58` (the semaphore clamp). The lines are disjoint, so this is a rebase-only overlap; 244
  merges first. Record it in `merge-order.md` at /sdd-spec.
- **Overlap with 259 (`fix-python-loop-supervision`).** 259 owns `main.py:174`. Its feature directory is not on
  this branch; it is on `origin/feature/fix-python-loop-supervision`. 262 must not edit `main.py` unless it
  reuses 259's helper after 259 merges.
- **Doc drift to fix in the same change:**
  - The `services/xstockstrat-analysis/CLAUDE.md:230` dependencies row reads `ListOrders(strategy_id, symbol)`
    for the backfill. It must say `user_id` plus owner metadata.
  - The `entry_backfill.py:64-65` "owner-implicit" comment must be removed or corrected. Per How-to-Act #5,
    keep at most a 2-line constraint comment, for example "body `user_id` is load-bearing: trading treats empty
    as all users".
  - The `strategies.py:100` docstring cross-reference must be edited.
  - `app/handlers/servicer.py:3174` comment ("raced the get_by_id check") names the removed method. Reword it
    to the owner-scoped read it actually follows.
  - `services/xstockstrat-analysis/docs/context-constitution.md:23` (ANALYSIS-7) and
    `context-constitution-findings.md:28` mention `entry_backfill.py` only for the live-gate literal. No
    D-44/D-55/D-60 drift was found there.
- **Applicable `fails.md` traps:**
  - 2026-10-06 private-by-default-templates (header): hand-made call-site lists miss sites, and `metadata=()`
    passes an AST check. Assert a non-empty `x-user-id` at runtime.
  - 2026-10-05 opportunity-queue-ignores-fundamentals-universe: the backfill is one of three callers that
    re-derive blend gating (`entry_backfill.py:86-114`). Do not disturb that gating while restructuring the loop.
  - 2026-10-07 193 (assumption): verify the documented disabled-blend path against the code (`:110-111` skip
    parity) and do not change it here.
  - fails.md:571 / fails.md:1616 (trading `ListOrders` repo builder and in-memory fallback): both apply the same
    empty-means-all semantics, so the body `user_id` scopes on both paths.
- **Not found:** a shared supervised-task helper on this branch (259's is unmerged). A trading `ListOrders`
  `UserId` filter test was not seen (`trading_helpers_test.go:290` `TestListOrdersInMemoryFilters`); none is
  needed because trading is unchanged.

## Recommended Scope

These boundaries are advisory input to the grilling and /sdd-spec; they are not binding.

1. **Backfill owner scoping (FR-1, FR-2), `entry_backfill.py:63-82`.**
   - Set `user_id=user_id` on the request.
   - Pass `metadata=owner_metadata(user_id)`, built inside the existing `try`.
   - Fix the `:64-65` comment.
   - Paired test step: `@AC-1` (request `user_id` plus a non-empty `x-user-id`), `@AC-2` (a `user_id`-filtering
     fake: a `u-b` fill does not seed `u-a`), and an optional `PARTIALLY_FILLED` case in the existing
     `_infer_open_entry_time` tests. Also extend `test_owner_header_guard.py:175` to the trading stub.
2. **Backfill failure isolation (FR-3, FR-4), `entry_backfill.py:59-61`, `:94`, `:98-118`.**
   - Guard the `db_pool.fetch` with a warning and return.
   - Guard `_drain_system_signals` with a warning and an empty set.
   - Wrap the per-row owner preparation in `except Exception`. The warning names the strategy and owner, the
     failed owner is recorded so its later rows skip cleanly, and the loop continues.
   - Decide the `:90` blend-universe question.
   - Paired test step: `@AC-3`, `@AC-8`, `@AC-4`, `@AC-5` (plus `@AC-9` if `:90` is brought in scope).
3. **Remove dead repository methods (FR-5, FR-6).**
   - Delete `StrategiesRepository.get_by_id` / `.update` (`strategies.py:89-97`, `:110-124`) and fix the
     `:100` docstring.
   - Retarget the 30 test mocks to `get_by_owner_and_id` / `update_locked` / `list_live_enabled`.
   - Paired test step: `@AC-6` (the grep count of 0 in `app/repositories/strategies.py`) and `@AC-7` (the grep
     count of 0 in `tests/`, with the full analysis suite green).
     Specify the `@AC-7` grep as the regex `_strategies_repo\.(get_by_id|update\b)`. The mocks are attribute
     assignments (`= AsyncMock(...)`), so a literal `update(` pattern would miss them; the regex counts 28 today
     in `test_analysis_servicer.py`.
   - This step is independent of 1–2 and could be sequenced after 215/244/245 to limit rebase churn on
     `test_analysis_servicer.py`.
4. **Docs.** Update the `services/xstockstrat-analysis/CLAUDE.md:230` dependencies row. Run the context-forge
   teardown, or reconcile manually, scoped to the touched context files.

No proto, migration, config or trading step. `main.py:174` is left to feature 259.
