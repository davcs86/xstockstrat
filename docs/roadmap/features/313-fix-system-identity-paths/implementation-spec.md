# Implementation Spec: fix-system-identity-paths

**Status**: `pending`
**Created**: 2026-11-20
**Feature**: `docs/roadmap/features/313-fix-system-identity-paths/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-system-identity-paths`

---

## Execution Summary

The order is the design's build order (D-16): docs first, then analysis, then the ingest owner fix, then
the ingest per-cycle id as a separate final unit. Step 1 lands the signed-off `@AC-2` rewording and
the new `@AC-3` in `acceptance.feature` before any test cites them; `@AC-1`'s text is kept exactly as the
operator confirmed it (rulings of 2026-11-21 and 2026-11-26). Steps 2-3 make a `system` order owner
degrade in the P&L consumer. Steps 4-5 stamp the ledger owner on `ingest.signal.ingested`. Steps 6-7 add the
per-cycle `trace_id` and land as one commit, because the loop change breaks an existing test spy. Step 8 (docs
only, added after the operator ruling of 2026-11-21) updates the two ingest docs that Steps 4 and 6 make stale.

There is no proto, migration, config, env-var, port or ledger-code step (recon.md:141-145), so there is no
`buf` or migration verification in this spec.

**Evidence tree.** Every `path:line` below was read on the feature branch tree
(`origin/feature/fix-system-identity-paths@8c12eacf`, code base `c4fd48b0a`), which is the tree the steps
land on. The bracketed "main-dev `:N`" hints come from two main-dev tips: Steps 1, 4, 6 and 7 from
`origin/main-dev@fb52065c` (only `services/xstockstrat-ingest/app/handlers/servicer.py` differed from the
branch there), Step 8 from `origin/main-dev@2b2dec92` (21 commits later: `_ingest_external_signal` is
`servicer.py:1346`, the ingest `CLAUDE.md` event row `:197`). At `2b2dec92` ingest `servicer.py`,
`tests/test_ingest_servicer.py` and `CLAUDE.md` differ from the branch; the other ingest and analysis files
this spec cites (`mcp_client_loop.py`, `tests/test_mcp_client_loop.py`, `identity.py`,
`pnl_pattern_consumer.py` and their tests) do not. Treat every "main-dev `:N`" hint as advisory: edit by
symbol and re-grep at BRANCH SYNC (after merging `main-dev` into the branch), which changes line numbers only.

**Peers.** `origin/feature/fix-analysis-per-symbol-isolation` (308), `fix-fundsignal-scoring-correctness`
(309), `fix-analysis-evidence-dry` (327) and `fix-agent-bearer-secret-orphan` (328) carry no diff against
`origin/main-dev` under `services/xstockstrat-ingest` or `services/xstockstrat-analysis` as of 2026-11-20
(`git diff --stat origin/main-dev...origin/feature/<slug> -- <both service dirs>` is empty for all four).
Two peers plan edits in files this spec edits (their specs, read on their branches; no hard dependency):
- 309 edits the same function as Steps 4 and 6, `_ingest_external_signal` (conviction handling, its
  implementation-spec.md:432), plus `_build_external_signal` (`mcp_client_loop.py:88-94`, its `:448`) and
  `tests/test_mcp_client_loop.py` (its `:473`). 309 names 313 as a co-editor at its `:104-106`.
- 328 touches `mcp_client_loop.py:140` (`split_credentials_ref`, its implementation-spec.md:445), inside
  `poll_one_source` above Step 6's `:156-160`.

Whichever feature merges second re-greps its anchors; Steps 4, 6 and 7 carry that re-check.

**Consumer surface (C-14).** The product spec has no `## Consumer Surface(s)` section yet; Step 1 adds it.
The surface is the `/trader` ledger export (design D-7). It needs no UI or ledger code step: the route
forwards caller-scoped `ExportEvents` with no event-type allowlist, and the export is scoped to
`user_id = caller` (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:404`, the `WHERE user_id = $1` predicate), so owner-stamped
`mcp_client` events become visible to their owner once Step 4 lands. This is a design decision, not an
omission. The analysis change is internal-only.

## Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` mcp_client loop signal events are owner-stamped in the ledger | Step 5 |
| `@AC-2` A system-owned order event yields a partial P&L snapshot | Step 3 |
| `@AC-3` Signals from one mcp_client poll cycle share a per-source correlation id (added by Step 1) | Step 7 |

`@AC-3` does not exist in `acceptance.feature` until Step 1 runs; Step 1 carries its full text.

## Step Dependencies

- Step 1 comes first: Steps 3 and 7 cite scenario wording that Step 1 writes; Step 5 cites `@AC-1`, whose
  text Step 1 leaves unchanged (it adds only the `@FR-1` tag).
- Step 3 [test] covers Step 2 [service]. Step 2 stands alone: no existing analysis test changes outcome.
- Step 5 [test] covers Step 4 [service]. Step 4 stands alone: no existing ingest test asserts the absence of
  `AppendEventRequest.user_id`.
- Steps 6+7 land together: Step 6 makes `poll_one_source` pass a new keyword (`trace_id=`) that the
  real-core spy at `services/xstockstrat-ingest/tests/test_mcp_client_loop.py:196` does not accept
  (step-constraints §C, "changes a ... required argument" with a test call site). Without Step 7's spy edit
  the `TypeError` is swallowed by the per-item `except` and `test_second_identical_cycle_deduplicates`
  fails. Two adjacent steps, one consumer surface (backend).
- Steps 6-7 require Steps 4-5: both edit the same `AppendEventRequest` literal and the same test file.
- Steps 6-7 stay the last code steps (D-16, F-09): a later ruling on the per-cycle id then needs no code-step
  swap. Step 8 is docs-only and follows them; if FR-3 were ruled out, only Step 8's per-cycle wording would
  change (Deviation Log).
- Step 8 requires Steps 4 and 6: it documents the owner stamp (Step 4) and the per-cycle `correlation_id`
  (Step 6, proved by Step 7). It runs after Step 7 so the docs never describe behaviour the tree lacks.
  Step 8 stands alone: it touches two markdown files and no code, so it has no `**Lands with**`.
- Open risk, `**kw` spy: the spy accepts any keyword, so a rename of `trace_id` would not fail the dedup
  test. Step 7's `correlation_id` assertion is the guard.
- Open risk, append-only metadata: a caller passing both `trace_id` and an `x-trace-id` entry in
  `propagation_meta` would send two headers. No caller does this today
  (`git grep -n "_ingest_external_signal" -- services/` shows two callers). Guards: Step 6's docstring
  constraint, and Step 7's assertion that each loop-path call sends exactly one `x-trace-id` entry. The
  assertion covers today's loop caller only, not a future caller that passes both.
- Open risk, marketdata headerless read: for a `system` owner the bars call runs with empty metadata, the
  same as the empty-owner path. It sits inside `_compose`'s `try`, so the event degrades either way; no step.
- No UI/ledger step by design (D-7): the `/trader` ledger export route has no event-type allowlist and the
  ledger scopes the export to the caller; the `correlation_id` meaning change is recorded in context.md.
- Operator ruling of 2026-11-21 (context.md, "operator ruling on the stale ingest docs"): add a docs step for
  the ingest findings row and `services/xstockstrat-ingest/CLAUDE.md`. This is Step 8.
- Proposed, not specced: the analysis findings go stale the same way once Steps 2 and 3 land
  (`services/xstockstrat-analysis/docs/context-constitution-findings.md:24`, the `_compose` latent-bug row,
  and `:32`, its open question; both read the same on the feature branch and `origin/main-dev`). The ruling
  named only the ingest docs, so no step edits them; the operator decides whether to extend Step 8's pattern.

---

### Step 1 — docs: acceptance scenarios, FR-1 to FR-3, consumer surface and register cells

**Status**: `pending`
**Service**: `docs/roadmap/features/313-fix-system-identity-paths/`
**Files**:
- `docs/roadmap/features/313-fix-system-identity-paths/acceptance.feature` — modify
- `docs/roadmap/features/313-fix-system-identity-paths/product-spec.md` — modify
- `docs/roadmap/features/313-fix-system-identity-paths/debate.md` — modify
- `docs/roadmap/features/313-fix-system-identity-paths/context.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `acceptance.feature` currently holds only `@AC-1 @regression` and `@AC-2 @regression`, with no `@FR-N`
  tag. `@AC-1`'s Thens ("the ingest.signal.ingested ledger event has user_id "user-a"" / "ExportEvents called
  as "user-a" returns that event") are operator-confirmed as written and stay; `@AC-2`'s pre-design Thens
  ("_compose does not raise", "marked degraded") are replaced.
- `grep -n "^## " product-spec.md` shows no `## Functional Requirements` and no `## Consumer Surface(s)`.
  The section name `## Functional Requirements` with `FR-N.` items is the form in
  `docs/roadmap/features/307-ui-env-themed-bundles/product-spec.md:17`.
- `product-spec.md` Problem Statement says the loop "forwards `metadata=None`". The code defaults it to an
  empty list: `propagation_meta = propagation_meta or []` at
  `services/xstockstrat-ingest/app/handlers/servicer.py:1024` [main-dev `:1246`] (D-12).
- `order_snapshots` has no degraded column: `grep -rn degraded services/xstockstrat-analysis/migrations/`
  returns nothing. "Degraded" is the ledger event name chosen at
  `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:407`.
- `debate.md`: O-17, O-18 and O-19 read `open`; D-2 reads `reopened @ round 5 (operator steer)`; D-9 reads
  `reopened @ round 4 (operator steer)`. The register's own legend allows `settled → superseded by D-m`.
- Operator rulings of 2026-11-20 are recorded in `context.md` ("Session 2026-11-20 — sdd-design
  (approved)"): C-16 sign-off for the `@AC-2` rewording, the AC-2 Then wording, and AC-3's Thens limited to
  the persisted `correlation_id`. The `@AC-1` rewording of that sign-off is superseded: the operator
  confirmed the existing `@AC-1` text "as written" (context.md, "Session 2026-11-21 — operator ruling on
  AC-1 wording") and, on 2026-11-26, ruled to keep it ("Session 2026-11-26 — operator ruling on AC-1 text").
- The export's `correlation_id` column: `services/xstockstrat-ledger/acceptance/ledger-event-export.feature:40`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

1. Replace the scenarios in `acceptance.feature` with the text below. Keep the `Feature:` header and its
   two description lines. `@AC-*` ids are unchanged (append-only); `@AC-3` is new. `@AC-1` keeps its
   Given/When/Then/And byte-for-byte (operator ruling 2026-11-26); only the `@FR-1` tag is added to it.

   ```gherkin
     # guards: docs/reports/2026-10-19-ingest-mcp-loop-ledger-events-ownerless-defect.md
     @AC-1 @FR-1 @regression
     Scenario: mcp_client loop signal events are owner-stamped in the ledger
       Given an mcp_client signal source registered by owner "user-a"
       When one ingest.mcp_client.poll_interval_seconds cycle ingests a signal from it
       Then the ingest.signal.ingested ledger event has user_id "user-a"
       And ExportEvents called as "user-a" returns that event

     # guards: docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md
     @AC-2 @FR-2 @regression
     Scenario: A system-owned order event yields a partial P&L snapshot
       Given an order.filled ledger event whose payload has user_id "system"
       When PnLPatternConsumer processes the event
       Then the event is processed on its first attempt with no retry backoff
       And an order_snapshots row is written for that order with empty indicators and signals
       And an analysis.snapshot.degraded event is emitted
       And no pnl_positions window is opened
       And the event is not parked

     # the id persists as the ledger event's correlation_id; ledger ignores the x-trace-id header
     # PRESERVE @AC-41, @AC-28, @AC-29 and @AC-53 @feature-294
     # (services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature): neither user_id nor
     # the per-cycle id becomes a metric label.
     @AC-3 @FR-3
     Scenario: Signals from one mcp_client poll cycle share a per-source correlation id
       Given two mcp_client signal sources registered by owner "user-a", each returning two distinct, non-duplicate signals
       When one poll cycle ingests all four signals
       Then each ingest.signal.ingested ledger event from one source's cycle carries the same non-empty correlation_id
       And the two sources' correlation ids differ
       And no x-user-id is sent
   ```

   The AC-2 first Then is the operator's wording, verbatim. The AC-1 text is the file's existing text,
   operator-confirmed. The `AppendEventRequest.user_id` and no-`x-user-id`-metadata assertions are not
   scenario Thens: they live in Step 5's test (design.md "Business Rules Touched" still lists an `@AC-1`
   rewording; this ruling supersedes it).

2. In `product-spec.md`:
   - In the first Problem Statement bullet, replace "forwards `metadata=None`" with "forwards an empty
     `propagation_meta` list (defaulted in `_ingest_external_signal`)".
   - Add `## Functional Requirements` after `## Problem Statement`:
     - `FR-1.` On the `mcp_client` poll-loop path, the `ingest.signal.ingested` ledger event is attributed to
       the source owner through `AppendEventRequest.user_id`. No `x-user-id` header is forged. (The RPC path
       receives the same field as incidental hardening.)
     - `FR-2.` A `system` owner alone never causes a P&L order event to be retried or parked: the event
       yields a partial snapshot and opens no `pnl_positions` window. Poison payloads still park under
       `@AC-7 @feature-259`.
     - `FR-3.` Each `mcp_client` source's poll cycle mints one id, persisted as the `correlation_id` of every
       `ingest.signal.ingested` ledger event from that cycle. Ledger ignores the `x-trace-id` header.
   - Add `## Consumer Surface(s)` after `## Affected Services`: the `/trader` ledger export. No UI or
     ledger code change. In that export the `correlation_id` column shows a poll-cycle id on `mcp_client`
     `ingest.signal.ingested` rows, not a request trace; RPC-path rows stay empty. The analysis change is
     internal-only.
   - Under `## Open Questions`, mark each resolved: 1 in scope (FR-3, D-17); 2 leave the rows,
     `ledger.events` is append-only (D-5); 3 no trading guard, out of scope (D-6).
   - In the first Problem Statement entry's `**Expected**` bullet, replace "optionally a trace id is minted
     per cycle" with "a per-cycle id is persisted as `correlation_id` (FR-3)".

3. In `debate.md`, change status cells only:
   - O-17 → `closed @ round 5 (operator ruling 2026-11-20: Thens limited to the persisted correlation_id)`.
   - O-18 → `closed @ round 5 (operator ruling 2026-11-20: append, with a docstring constraint)`.
   - O-19 → `closed @ round 5 (rulings recorded in context.md, session 2026-11-20 sdd-design)`.
   - D-2 → `superseded by D-17`. D-9 → `superseded by D-14`.
   - D-8 → `superseded by operator ruling 2026-11-26 (AC-1 text kept as confirmed; the AC-2 rewording stands)`.
   - O-1 → `reopened and closed @ 2026-11-26 (operator ruling: AC-1 text kept; the AppendEventRequest.user_id assertion lives in the Step 5 test)`.

4. Append to `context.md`, in the step's session entry:
   - The consumer-surface note from the `## Consumer Surface(s)` text above.
   - "A later `portfolio.position.closed` for a `system` owner is a no-op: no window was opened, so
     `seal` finds no row (D-4)."
   - The AC-2 rewording, citing the operator's C-16 sign-off of 2026-11-20; and that `@AC-1`'s text was kept
     as confirmed (rulings of 2026-11-21 and 2026-11-26), and that its second Then (ExportEvents) is run by no
     ingest test: it is delegated to ledger `@AC-11 @feature-021`, `ledgerServiceImpl.test.ts:675-709` and the
     `WHERE user_id = $1` predicate at `ledgerServiceImpl.ts:404` (Step 5 carries the matching test comment).

**Verification**:

```bash
cd docs/roadmap/features/313-fix-system-identity-paths
test "$(grep -c '^  @AC-[0-9]* @FR-[0-9]*' acceptance.feature)" = 3
grep -n 'processed on its first attempt with no retry backoff' acceptance.feature
! grep -n '_compose does not raise\|marked degraded' acceptance.feature
test "$(grep -c 'the ingest.signal.ingested ledger event has user_id "user-a"\|ExportEvents called as "user-a" returns that event' acceptance.feature)" = 2
! grep -n 'AppendEvent request carries\|no x-user-id call metadata\|PRESERVE @AC-11' acceptance.feature
# the only AC-1 delta vs the base file is the added @FR-1 tag (run before committing; BASE is the pre-step file)
diff <(git show HEAD:docs/roadmap/features/313-fix-system-identity-paths/acceptance.feature | sed -n '/@AC-1 /,/^$/p') \
     <(sed -n '/@AC-1 /,/^$/p' acceptance.feature)                  # one changed line: "@AC-1 @regression" -> "@AC-1 @FR-1 @regression"
grep -n '^FR-1\.\|^FR-2\.\|^FR-3\.\|^## Consumer Surface(s)' product-spec.md   # 4 lines
! grep -n 'metadata=None' product-spec.md
grep -c 'superseded by D-17\|superseded by D-14' debate.md                      # 2
grep -c '2026-11-26' debate.md                                                   # 2 (D-8, O-1)
! grep -n '^| O-1[789] .*| open |$' debate.md
```

---

### Step 2 — service: a `system` owner degrades in the P&L consumer

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/identity.py` — modify
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py` — modify

**Reviewers**: Service owner `xstockstrat-analysis` — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `services/xstockstrat-analysis/app/identity.py:3` `SYSTEM_IDENTITY = "system"`; `:6-10` `owner_metadata`,
  whose guard at `:8` is `if not owner or owner == SYSTEM_IDENTITY:` and whose message at `:9` is
  `f"owner-scoped call needs a real owner, got {owner!r}"`.
- `grep -rn "is_real_owner" services/xstockstrat-analysis` → **Not found**; the predicate is created here.
- `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:35`
  `from app.identity import owner_metadata`.
- Bug site, `_compose` at `:532`: `meta = owner_metadata(owner) if owner else ()` at `:539`, outside any
  `try`. The first `try` starts at `:541`.
- Degrade branch to reuse, `:546-548`: `if not owner: log.warning(...); return bar, closes, {}, [], True`.
- Window guard in `_handle_order_event` (`:348`), at `:388`:
  `if event_type in ("created", "filled", "partially_filled") and user_id:`.
- `position_id` is built from the raw owner at `:358` (`_synth_position_id`, `:566-569`); unchanged (D-4).
- `_POISON` at `:65-73` includes `ValueError`; `_process_with_retry` at `:228`. Neither is edited (D-10).
- `_emit` builds the request at `:608-615` with no `user_id`, so a degraded snapshot writes no
  `system`-owned ledger row (D-13).
- `owner_metadata` has 9 other call sites (`grep -rn "owner_metadata(" services/xstockstrat-analysis/app`:
  `services/evaluator.py:256`, `handlers/servicer.py:2908,3708,6038,6089`, `engine/entry_backfill.py:79`,
  `engine/live_loop.py:523,568,598`). Its signature, return value, raise and message do not change, so none
  is edited.
- Regression proof kept unedited: `services/xstockstrat-analysis/tests/test_identity.py:13-36`
  (`test_owner_metadata_rejects_empty_and_system_and_builds_owner`, `test_single_owner_header_builder`) and
  `test_identity_imports_nothing_from_app` at `:39`.
- No test asserts the `:547` log text (`grep -rn "has no owner" services/xstockstrat-analysis/tests` is
  empty); the message is left as it is.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

1. `app/identity.py`: add `is_real_owner(owner: str) -> bool` between `SYSTEM_IDENTITY` and
   `owner_metadata`, returning `bool(owner) and owner != SYSTEM_IDENTITY`, with a one-line docstring.
   Change the `owner_metadata` guard at `:8` to `if not is_real_owner(owner):`. Leave the raise, its message
   and the return untouched. Add no import (the `:39` test forbids `app` imports in this module).
2. `app/engine/pnl_pattern_consumer.py`:
   - `:35` → `from app.identity import is_real_owner, owner_metadata`.
   - `:539` → `meta = owner_metadata(owner) if is_real_owner(owner) else ()`. Keep it outside the `try`; do
     not move `owner_metadata` into a broader `try`.
   - `:546` → `if not is_real_owner(owner):`. Body unchanged.
   - `:388` → `... and is_real_owner(user_id):`.
3. Do not edit `_POISON`, `_process_with_retry`, `_handle_close_event`, `_synth_position_id`, or any other
   `SYSTEM_IDENTITY` user (`handlers/servicer.py:687`, `engine/live_loop.py:76`,
   `engine/fundsignal_loop.py:211`).
4. No new outbound gRPC call is added; for a `system` owner the indicators and signals calls are removed,
   matching the empty-owner branch (header-propagation constraint not triggered).

**Verification**:

```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_identity.py tests/test_pnl_pattern_consumer.py tests/test_owner_header_guard.py -q
git diff --stat HEAD -- services/xstockstrat-analysis/tests/test_identity.py   # empty: file unedited
grep -n "is_real_owner" services/xstockstrat-analysis/app/identity.py \
  services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py            # 2 + 4 lines
```

---

### Step 3 — test: AC-2, a system-owned order event is processed on its first attempt

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py` — modify

**Reviewers**: Service owner `xstockstrat-analysis` — Backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py`: `make_event` `:33`; `FakePositions`
  `:122` with `open_rows`; `FakeLedger` `:158` with `appended` and `calls`; `make_consumer` `:214`, returning
  `(consumer, pool, snaps, positions, samples, ledger)`; `ORDER_PAYLOAD` `:234` (owner `u-1`);
  `_MetaRecordingComposer` `:443`; `test_compose_threads_order_owner_header` `:461`; `PARKED` `:474`; the
  `sleeps` fixture `:483-486` (patches `app.engine.pnl_pattern_consumer.asyncio.sleep` with an `AsyncMock`);
  `parked_calls(ledger)` `:515`.
- Degraded-event assertion pattern: `test_ac6_indicator_timeout_degrades` at `:328-336`
  (`"analysis.snapshot.degraded" in ledger.appended`).
- Empty-owner sibling: `services/xstockstrat-analysis/tests/test_owner_header_guard.py:435`
  `test_ac17_ownerless_order_event_issues_no_owner_scoped_call`, payload `{**ORDER_PAYLOAD, "user_id": ""}`.
- `asyncio.sleep` is awaited only in `_process_with_retry`
  (`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:228-232`), so the test must drive
  `_process_with_retry`, not `process_event` (R-10).
- The name `test_ac2_close_seals_and_writes_samples` is taken (`:273`); the feature-prefixed form follows
  `test_feature294_ac7_cycle_writes_mcp_client_tick`
  (`services/xstockstrat-ingest/tests/test_mcp_client_loop.py:465`).
- `grep -n '"system"' services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py` → **Not found**: no
  existing test feeds a `system` owner to the consumer.
- `pyproject.toml:33` `asyncio_mode = "auto"`: no `@pytest.mark.asyncio` needed.
- Coverage floor 40 is the CI value: `.github/workflows/ci.yml:431-432` (`xstockstrat-analysis`,
  `coverage_threshold: 40`), applied at `:477` as `--cov-fail-under=${{ matrix.coverage_threshold }}`.

**TDD**: `red-green required`

**Covers**: `AC-2`

**Instructions**:

1. Add `test_feature313_ac2_system_owned_order_event_degrades_on_first_attempt(sleeps)` after the feature-259
   helpers (it needs `sleeps` and `parked_calls`, defined at `:483` and `:515`).
2. Build the consumer with `_MetaRecordingComposer()` through `make_consumer(composer=...)`. Wrap
   `consumer.process_event` in a counting spy that forwards to the original. Await
   `consumer._process_with_retry(make_event(1, "order.filled", {**ORDER_PAYLOAD, "user_id": "system"}))`.
3. Assert, in this order:
   - `sleeps.assert_not_awaited()` and the spy ran exactly once (the AC-2 first Then).
   - `len(snaps.rows) == 1`, with `indicators == {}` and `signals == []`.
   - `"analysis.snapshot.degraded" in ledger.appended` and `"analysis.snapshot.captured"` is not.
   - `positions.open_rows == {}` (no window).
   - `parked_calls(ledger) == []`.
   - `composer.metas == {"ohlcv": []}`: the bars read is headerless and no indicators or signals call ran.
   - `pool.cursor == 1`.
4. Use the real `_compose` and the real `owner_metadata`; mock neither. RED on the pre-Step-2 tree is a
   behaviour failure: `owner_metadata` raises `owner-scoped call needs a real owner, got 'system'` on each
   of 3 attempts, so `sleeps` is awaited twice and the event is parked. Confirm that message in the RED
   output.
5. C-13: the `system` payload has one consumer and is an `{**ORDER_PAYLOAD, ...}` spread, so it stays
   inline. No `tests/conftest.py` entry is added.
6. The three predicate branches are covered without a new unit test: empty owner by
   `test_owner_header_guard.py:435`, `system` by this test, a real owner by `:461`; `owner_metadata`'s raise
   by `tests/test_identity.py:13`.

**Verification**:

```bash
cd services/xstockstrat-analysis && ruff check . && ruff format --check . \
  && pytest tests/test_pnl_pattern_consumer.py -q -k feature313_ac2 \
  && pytest --cov=app --cov-fail-under=40
grep -n "def .*fixture\|from .conftest\|conftest" services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py
# C-13 verdict: single-consumer inline spread; no second inline copy introduced
```

---

### Step 4 — service: stamp the owner on the `ingest.signal.ingested` ledger event

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- `async def _ingest_external_signal(self, signal, propagation_meta=None, *, owner: str)` at
  `services/xstockstrat-ingest/app/handlers/servicer.py:1015-1017` [main-dev `:1237-1239`].
- Bug site, `:1174-1182` [main-dev `:1396-1404`]:
  `ledger_pb2.AppendEventRequest(event_type="ingest.signal.ingested", source_service="xstockstrat-ingest",
  stream_key=f"signal:{signal.source}:{signal.symbol}", payload=payload)` with `metadata=propagation_meta`.
  No `user_id=`.
- The payload already carries `"user_id": owner` at `:1167` [main-dev `:1389`]; the ledger owner column does
  not read the payload.
- `packages/proto/ledger/v1/ledger.proto:51` `string user_id = 9; // owning user; falls back to the
  x-user-id metadata when empty` (message `AppendEventRequest`, `:38`).
- Ledger precedence, `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:76-78`: request field, then
  `x-user-id` metadata, then `null`. Already tested at
  `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts:675,691,709`; no ledger step.
- Callers (`git grep -n "_ingest_external_signal(" -- services/xstockstrat-ingest/app`): `IngestSignal` at
  `:994-996` [main-dev `:1216-1218`] and `poll_one_source` at
  `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:158-160`. Neither is edited in this step.
- No existing test asserts an empty `user_id` on this request:
  `grep -rn "AppendEvent.call_args" services/xstockstrat-ingest/tests` reads only `event_type` and `payload`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

0. Before editing, re-grep the anchor (`grep -n 'event_type="ingest.signal.ingested"'
   services/xstockstrat-ingest/app/handlers/servicer.py`): peer 309 edits this function and the line
   numbers above move if it or `main-dev` has merged in.
1. In `_ingest_external_signal`, add `user_id=owner,` to the `AppendEventRequest(...)` whose `event_type` is
   `"ingest.signal.ingested"`. Change nothing else: `metadata=propagation_meta` stays, no `x-user-id` entry
   is built (R-3), no helper is added, and the owner is never routed through `system`.
2. Leave the other `AppendEventRequest` sites (`:467` and `app/admin_audit.py:29`) untouched.
3. Header propagation: this is not a new outbound call. The existing call keeps forwarding
   `propagation_meta` (the `x-user-id`/`x-access-scope`/`x-trace-id` filter at `:983-987`
   [main-dev `:1206-1210`]) on the RPC path. On the loop path there is no inbound request to propagate.

**Verification**:

```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . \
  && pytest tests/test_mcp_client_loop.py tests/test_signal_ownership.py tests/test_ingest_servicer.py -q
grep -n -A6 'event_type="ingest.signal.ingested"' services/xstockstrat-ingest/app/handlers/servicer.py \
  | grep -n "user_id=owner"
```

---

### Step 5 — test: AC-1, the loop's ledger event is owner-stamped

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Real-core harness to reuse, `services/xstockstrat-ingest/tests/test_mcp_client_loop.py:173-212`
  (`test_second_identical_cycle_deduplicates`): `monkeypatch.setattr(loop, "list_all_sources", ...)`,
  `transaction_conn(db_fetchrow_side_effect=..., conn_fetchrow_side_effect=...)`,
  `svc = make_servicer(db=db)`, `svc._db = db`, `loop.run_one_cycle(svc, cfg, mcp)`.
- One fresh ingest consumes one `db.fetchrow` (the source lookup at `servicer.py:1041-1046`) and two
  `conn.fetchrow` results (insert, then claim): see the cycle-1 rows at `:179,183-184`.
- `run_one_cycle` calls `poll_one_source`
  (`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:184,203`).
- Helpers in the same file: `_FakeResult` `:25`, `_FakeMcpClient` `:32`, `_FakeCfgWatcher` `:62`,
  `_mcp_source(slug=..., endpoint=..., **over)` `:80` (default owner `seed-user`), `_item(symbol, **over)`
  `:338`.
- `make_servicer` sets `svc._ledger.AppendEvent = AsyncMock(...)`
  (`services/xstockstrat-ingest/tests/test_ingest_servicer.py:64-65`).
- RPC-path pattern, `services/xstockstrat-ingest/tests/test_signal_ownership.py:123-139`:
  `svc, db, conn = _fresh_ingest_svc(sid)`; `await svc.IngestSignal(_signal_req("motley-fool"),
  _ctx("0", user_id=owner))`; `svc._ledger.AppendEvent.call_args.args[0].payload`. Helpers:
  `_signal_req` `:20`, `_fresh_ingest_svc` `:28`; `_ctx` in `tests/conftest.py:17`.
- `@AC-1`'s scenario text is unchanged (ruling 2026-11-26): its first Then is covered by the request-field
  assertion below, its second Then ("ExportEvents called as "user-a" returns that event") by the unchanged
  ledger code and tests, not by an ingest test: export scoping is `@AC-11 @feature-021`
  (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`) and owner precedence is tested at
  `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts:675,691,709`, plus the export
  predicate `WHERE user_id = $1` at `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:404`.
- Cross-test-module helper imports are existing practice in this file (`:20-22`).
- `grep -rn "\.user_id ==" services/xstockstrat-ingest/tests/test_mcp_client_loop.py` → **Not found**: no
  ingest test asserts `AppendEventRequest.user_id`.
- The name `test_ac1_one_failing_item_does_not_drop_batch` is taken (`:426`); use the `test_feature313_`
  prefix (precedent `:465`).
- Coverage floor 40 is the CI value: `.github/workflows/ci.yml:428-429` (`xstockstrat-ingest`,
  `coverage_threshold: 40`), applied at `:477`.

**TDD**: `red-green required`

**Covers**: `AC-1`

**Instructions**:

1. Add `test_feature313_ac1_loop_signal_event_is_owner_stamped(monkeypatch)` after
   `test_second_identical_cycle_deduplicates`.
2. Loop half (the AC-1 scenario). One source `_mcp_source(user_id="user-a")`; a dedup-miss fake DB with one
   `db.fetchrow` row and two `conn.fetchrow` rows; `_FakeMcpClient(result=_FakeResult([_item()]))`;
   `_FakeCfgWatcher()`. Do not replace `svc._ingest_external_signal`: the real core must run (R-8). After
   `await loop.run_one_cycle(...)`, read `svc._ledger.AppendEvent.call_args` and assert (plain test
   assertions that carry the ledger-owner claim; they are not scenario Thens):
   - `args[0].event_type == "ingest.signal.ingested"`;
   - `args[0].user_id == "user-a"`;
   - `"x-user-id" not in dict(kwargs["metadata"])`.

   Add one comment above these assertions: `# AC-1 Then 2 is covered by ledger @AC-11 @feature-021 plus
   ledgerServiceImpl.test.ts:675-709 (owner precedence) and the WHERE user_id = $1 predicate at
   ledgerServiceImpl.ts:404, not here`. For `/sdd-execute`: the promoted `@AC-1` scenario must not be
   claimed as fully ingest-tested; its ExportEvents Then is delegated to those ledger tests.
3. RPC half, in the same test function, as an untraced incidental-hardening assertion (D-14): drive
   `IngestSignal` with `_fresh_ingest_svc`, `_signal_req` and `_ctx("0", user_id="alice")` exactly as
   `test_signal_ownership.py:124-125` does, then assert
   `svc._ledger.AppendEvent.call_args.args[0].user_id == "alice"`. Add a one-line comment that it traces to
   no scenario. Do not write "Covers: AC-33" anywhere.
4. Import `_fresh_ingest_svc` and `_signal_req` from `tests.test_signal_ownership` and `_ctx` from
   `tests.conftest`. Do not copy them.
5. C-13: the signal item comes from the existing `_item()` helper and the source row from `_mcp_source()`;
   no new domain literal is declared.
6. RED on the pre-Step-4 tree is the behaviour failure `assert '' == 'user-a'`.

**Verification**:

```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . \
  && pytest tests/test_mcp_client_loop.py -q -k feature313_ac1 \
  && pytest --cov=app --cov-fail-under=40
grep -n "from tests.test_signal_ownership import\|from tests.conftest import" \
  services/xstockstrat-ingest/tests/test_mcp_client_loop.py
# C-13 verdict: helpers imported, no second inline copy of a domain literal
```

---

### Step 6 — service: one per-cycle id, sent as `correlation_id` and `x-trace-id`

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/engine/mcp_client_loop.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Signature at `services/xstockstrat-ingest/app/handlers/servicer.py:1015-1017` [main-dev `:1237-1239`]:
  `(self, signal, propagation_meta=None, *, owner: str) -> tuple[int, bool]`; docstring `:1018-1023`;
  `propagation_meta = propagation_meta or []` at `:1024` [main-dev `:1246`].
- The `ingest.signal.ingested` emit at `:1174-1182` [main-dev `:1396-1404`], carrying `user_id=owner` after
  Step 4.
- `packages/proto/ledger/v1/ledger.proto:41` `string correlation_id = 3;` on `AppendEventRequest`.
- Ledger persists `req.correlationId` (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:89`) and
  reads only `x-user-id` from call metadata (`:78`).
- Idiom to reuse, `services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:613,618`:
  `correlation_id=correlation_id` on the request and
  `metadata=(("x-trace-id", correlation_id),) if correlation_id else ()`.
- Mint precedent, `servicer.py:762`: `meta = (("x-trace-id", str(uuid.uuid4())),)`.
- `poll_one_source` at `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:116`; owner at `:123`;
  item loop `for item in parsed:` at `:156`; the per-item call at `:158-160`
  (`servicer._ingest_external_signal(_build_external_signal(slug, item), owner=owner)`); the per-item
  `except Exception` at `:163`.
- `grep -n "^import" services/xstockstrat-ingest/app/engine/mcp_client_loop.py` → `asyncio`, `json`,
  `logging`, `time` (`:13-16`). `import uuid` is **Not found** and must be added.
- The RPC caller passes `propagation_meta` positionally and no `trace_id` (`servicer.py:994-996`
  [main-dev `:1216-1218`]); it is not edited.
- Break radius: the only site that mirrors the signature is the test spy at
  `services/xstockstrat-ingest/tests/test_mcp_client_loop.py:196-197`
  (`async def spy(signal, propagation_meta=None, owner=None)`), repaired by Step 7. The other loop tests
  replace the core with `AsyncMock` (`:100,130,144,231,295,314,354,520`) or run it unwrapped (`:259-286`),
  and none asserts the call's full keyword set (`:439` reads only `kwargs["owner"]`).
- Metric labels: `_record_signal_outcome("mcp_poll", ...)` at `mcp_client_loop.py:161,164` takes no id; the
  allow-list test is `services/xstockstrat-ingest/tests/test_telemetry_allowlist.py:68`.

**Lands with**: `Step 7`

**TDD**: `red-green required`

**Covers**: —

**Instructions**:

0. Before editing, re-grep the anchors, because peers 309 and 328 plan edits in both files:
   `grep -n "for item in parsed\|_ingest_external_signal(" services/xstockstrat-ingest/app/engine/mcp_client_loop.py`
   and `grep -n "async def _ingest_external_signal" services/xstockstrat-ingest/app/handlers/servicer.py`.
   Edit by symbol; the line numbers in this step are hints.
1. `servicer.py`, `_ingest_external_signal`:
   - Add one keyword-only parameter after `owner`: `trace_id: str = ""`.
   - Add one docstring line stating the constraint: `trace_id` is for callers with no inbound metadata; it
     is appended to the call metadata, never merged with an inbound `x-trace-id`.
   - On the `ingest.signal.ingested` `AppendEventRequest` only, add `correlation_id=trace_id`.
   - On that `AppendEvent` call only, send
     `metadata=[*propagation_meta, ("x-trace-id", trace_id)] if trace_id else propagation_meta`.
     Append; do not strip or replace an existing `x-trace-id` entry, and do not mutate `propagation_meta`.
   - With `trace_id == ""` the request and metadata are exactly what Step 4 left (R-9). Do not derive
     `correlation_id` from `propagation_meta`.
2. `mcp_client_loop.py`:
   - Add `import uuid` to the stdlib import block (`:13-16`, alphabetical, after `time`).
   - In `poll_one_source`, mint `str(uuid.uuid4())` once, immediately before `for item in parsed:` (`:156`),
     and pass it as `trace_id=` on the per-item call at `:158-160`, next to `owner=owner`.
   - Pass no `propagation_meta` and build no `x-user-id` entry.
3. Do not pass the id to `_record_signal_outcome`, `record_source_poll` or any log-tick helper.
4. Header propagation: no new outbound call. The existing `AppendEvent` gains an `x-trace-id` entry on the
   loop path; `x-user-id` and `x-access-scope` have no inbound value there, and the owner travels as the
   request field (PLAT-4, design "Constitution Rules Touched").

**Verification** (run as one unit with Step 7):

```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . \
  && pytest tests/test_mcp_client_loop.py tests/test_signal_ownership.py tests/test_ingest_servicer.py \
       tests/test_telemetry_allowlist.py -q
grep -n "trace_id" services/xstockstrat-ingest/app/handlers/servicer.py \
  services/xstockstrat-ingest/app/engine/mcp_client_loop.py
grep -n "x-user-id" services/xstockstrat-ingest/app/engine/mcp_client_loop.py   # no new match
```

---

### Step 7 — test: AC-3, per-source per-cycle `correlation_id`, and the spy fix

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_mcp_client_loop.py` — modify

**Reviewers**: Service owner `xstockstrat-ingest` — Signal normalization correctness, idempotent ingestion, newsletter source schema stability

**Codebase Evidence**:
- Spy to fix, `services/xstockstrat-ingest/tests/test_mcp_client_loop.py:194-201`:
  `orig = svc._ingest_external_signal`; `async def spy(signal, propagation_meta=None, owner=None):`
  `r = await orig(signal, propagation_meta, owner=owner)`. It guards `@AC-4 @feature-166`
  (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature:32-33`) through the assertions at
  `:211-212`.
- The swallow: the per-item `except Exception` at
  `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:163` would catch the spy's `TypeError`.
- Harness and helpers as in Step 5: `_mcp_source` `:80`, `_item` `:338`, `_FakeResult` `:25`,
  `_FakeMcpClient` `:32` (one `result` returned for every `fetch`), `_FakeCfgWatcher` `:62`,
  `transaction_conn`, `make_servicer`.
- `_build_external_signal` sets `source=slug` (`mcp_client_loop.py:88-91`), and the ledger payload carries
  `"source": signal.source` (`services/xstockstrat-ingest/app/handlers/servicer.py:1168`
  [main-dev `:1390`]), so events group by source through `req.payload["source"]`.
- Dedup keys on `(user_id, source, symbol, direction)` (`tests/test_signal_ownership.py:135`), so the same
  two symbols under two slugs are four distinct signals.
- `_ctx` always sends `("x-trace-id", "t1")` (`tests/conftest.py:17-33`), which makes the RPC path a usable
  check that an inbound trace id is not stored as `correlation_id` (R-9).
- `grep -n "correlation_id" services/xstockstrat-ingest/tests/*.py` → **Not found**: no ingest test reads it.

**Lands with**: `Step 6`

**TDD**: `red-green required`

**Covers**: `AC-3`

**Instructions**:

1. Spy fix (D-19): change the spy at `:196-197` to
   `async def spy(signal, propagation_meta=None, owner=None, **kw):` with
   `r = await orig(signal, propagation_meta, owner=owner, **kw)`. Change nothing else in that test.
2. Add `test_feature313_ac3_cycle_signals_share_a_per_source_correlation_id(monkeypatch)` after the Step 5
   test.
   - Given: two sources owned by `user-a` with distinct slugs and endpoints, built with `_mcp_source(...)`;
     the MCP fake returns `[_item("AAPL"), _item("MSFT")]`; a dedup-miss fake DB sized for four fresh
     ingests (four `db.fetchrow` rows, eight `conn.fetchrow` rows). The real core runs (R-8).
   - When: one `await loop.run_one_cycle(svc, _FakeCfgWatcher(), mcp)`.
   - Then (the scenario): exactly four `ingest.signal.ingested` requests in
     `svc._ledger.AppendEvent.call_args_list`; grouped by `req.payload["source"]`, each source has exactly
     one distinct, non-empty `correlation_id`; the two sources' ids differ; no call's metadata has an
     `x-user-id` key.
   - Plain test assertions, not scenario Thens: for every call,
     `("x-trace-id", req.correlation_id) in kwargs["metadata"]` and
     `[k for k, _ in kwargs["metadata"]].count("x-trace-id") == 1` (the loop sends no duplicate header);
     and, driving `IngestSignal` as in Step 5, the RPC-path request has `correlation_id == ""`.
3. C-13: all domain data comes from `_mcp_source()` and `_item()`; nothing is declared inline.
4. RED on the tree after Step 5 is a behaviour failure: every `correlation_id` is `""`. The spy fix alone
   is behaviour-neutral, so the unit's RED is this test.

**Verification** (run as one unit with Step 6):

```bash
cd services/xstockstrat-ingest && ruff check . && ruff format --check . \
  && pytest tests/test_mcp_client_loop.py -q -k "feature313_ac3 or second_identical_cycle" \
  && pytest --cov=app --cov-fail-under=40
grep -n "async def spy" -A2 services/xstockstrat-ingest/tests/test_mcp_client_loop.py   # **kw taken and forwarded
```

---

### Step 8 — docs: ingest findings row and CLAUDE.md event row after Steps 4 and 6

**Status**: `pending`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ingest/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence** (both files re-grepped on `origin/feature/fix-system-identity-paths@8c1db49e` and
`origin/main-dev@2b2dec92` on 2026-11-26; the earlier `CLAUDE.md:146` cite no longer matches either tree):
- Findings row, `services/xstockstrat-ingest/docs/context-constitution-findings.md:38` on both trees (the file
  is byte-identical on both: `git diff --stat 8c1db49e origin/main-dev` lists only `CLAUDE.md` under the
  ingest docs). It sits under `## Open questions` (`:34`) and reads: "The `mcp_client` loop drives
  `_ingest_external_signal` with **no `propagation_meta`** (`mcp_client_loop.py#poll_one_source` ~L148), so
  loop-emitted `ingest.signal.ingested` ledger events carry empty `x-user-id`/`x-trace-id` ... Likely
  intentional ... confirm whether ledger/analysis expect a trace id on these rows. — status: **open**".
- What goes stale: "carry empty `x-user-id`/`x-trace-id`" and the open question. After Step 4 the event
  carries `user_id=owner` as a request field; after Step 6 it carries the per-cycle `correlation_id` and an
  `x-trace-id` header. It still carries no `x-user-id` header (R-3), and the RPC path's `correlation_id`
  stays empty (R-9).
- Resolution format to follow, `## Resolved` (`:41`): newest-first bullets of the form
  `- **RESOLVED <date> — <title>**: <what changed, with `path#symbol`> (feature N)` (`:43-53`), separated by
  blank lines. Open-question bullets are removed when resolved (`:36-39` hold only open ones).
- Row to leave alone: `## Filed as defect reports (2026-10-19)` (`:56`) states at `:59` "A row stays here
  until its report is resolved"; the ownerless-report row is at `:65`. That report's sidecar flips through
  `/sdd-triage backmerge`, not this step.
- CLAUDE.md event row: `| ingest.signal.ingested | Newsletter signal persisted |` at
  `services/xstockstrat-ingest/CLAUDE.md:185` on the feature branch and `:197` on main-dev (heading
  `## Ledger Events Emitted` at `:177` and `:189`; main-dev's 12 extra lines are the feature-364 verify-pass
  text near `:144-155`). Edit by the row text, not the number.
- Checked and not stale: `CLAUDE.md` § Ownership (`### Ownership (feature 224)` `:52`, the reserved `system`
  owner at `:57-62`): the owner stamped on the request is the `_resolve_owner` value that `IngestSignal`
  already forwarded as `x-user-id`, so the `system` rules are unchanged. `docs/context-constitution.md`
  INGEST-12 (`:25`) concerns the backfill hand-off loop, not `ingest.signal.ingested`.
- Symbols named in the new text exist today: `app/handlers/servicer.py#_ingest_external_signal`
  (`:1015` branch, `:1346` main-dev), `app/engine/mcp_client_loop.py#poll_one_source` (`:116` on both).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:

0. Before editing, re-grep both anchors (`grep -n 'no .propagation_meta' services/xstockstrat-ingest/docs/context-constitution-findings.md`
   and `grep -n '^| `ingest.signal.ingested`' services/xstockstrat-ingest/CLAUDE.md`). Edit by text; the
   line numbers above are hints. Run only after Steps 4 to 7 have landed, so the text matches the tree.
1. `docs/context-constitution-findings.md`:
   - Delete the `## Open questions` bullet that starts "The `mcp_client` loop drives
     `_ingest_external_signal` with **no `propagation_meta`**". Leave the other three bullets.
   - Add this as the first bullet under `## Resolved`, above the 2026-11-10 entries, with a blank line after
     it. Use the landing date (`date +%F`) for `<date>`:

     ```markdown
     - **RESOLVED <date> — `mcp_client` loop `ingest.signal.ingested` events carried no owner or trace id (feature 313)**: `app/handlers/servicer.py#_ingest_external_signal` now sets `AppendEventRequest.user_id=owner`, and `app/engine/mcp_client_loop.py#poll_one_source` mints one id per source per poll cycle, persisted as the event's `correlation_id` and sent as an `x-trace-id` header. The loop still sends no `x-user-id` header (the ledger reads the request field first). The `IngestSignal` RPC path keeps an empty `correlation_id`.
     ```

   - Do not edit the `## Filed as defect reports` row, the header paragraph, or any other row.
2. `CLAUDE.md`: replace the `ingest.signal.ingested` row of `## Ledger Events Emitted` with:

   ```markdown
   | `ingest.signal.ingested` | Newsletter signal persisted; carries the signal owner as `AppendEventRequest.user_id` on both paths. On the `mcp_client` loop path `correlation_id` is one id per source per poll cycle (also sent as `x-trace-id`); on the `IngestSignal` RPC path it is empty |
   ```

   Change no other line of `CLAUDE.md`.
3. No code, test or config file is touched; no new comment is added to any source file.

**Verification**:

```bash
F=services/xstockstrat-ingest/docs/context-constitution-findings.md
! sed -n '/^## Open questions/,/^## Resolved/p' $F | grep -n 'propagation_meta'
sed -n '/^## Resolved/,/^## Filed as defect reports/p' $F | grep -c 'RESOLVED .*feature 313'   # 1
grep -c 'ingest-mcp-loop-ledger-events-ownerless-defect' $F                                    # 1 (row stays)
grep -n '^| `ingest.signal.ingested`' services/xstockstrat-ingest/CLAUDE.md | grep -c 'user_id.*correlation_id'   # 1
git diff --name-only HEAD -- services/                                      # exactly the two files above
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
