# Implementation Spec: ingest-signal-dedup

**Status**: `complete`
**Created**: 2026-08-07
**Feature**: `docs/roadmap/features/111-ingest-signal-dedup/feature.md`
**Total Steps**: 14
**Feature Branch**: `feature/ingest-signal-dedup`

---

## Execution Summary

The chosen design (`design.md`) adds an additive proto field, a new dedup side-table, a
config-driven window, and a rewritten `IngestSignal` handler that wraps the insert + dedup claim
in `xstockstrat-ingest`'s first-ever explicit asyncpg transaction — then propagates the
`deduplicated` outcome through the agent's `client.ingest_signal` and `ingest_signal` tool so the
auto-alert side effect is suppressed on a duplicate. Steps run in dependency order: proto → codegen
→ migration → config getter → the `IngestSignal` handler rewrite (the core of the feature) → the
two agent-side steps that consume the new response field → docs. Every `service` step is
immediately followed by its paired `test` step (Constitution C-08); the ingest handler step (6/7)
is the largest because it rewrites the mocking shape for four existing tests in addition to adding
ten new ones, exactly as `design.md` § Test Plan and § Open Risks (rollback-path correctness)
specify.

## Step Dependencies

- Step 2 requires Step 1: `buf-gen.sh` regenerates stubs from the edited `.proto`.
- Step 5 requires Step 4: tests the property Step 4 adds.
- Step 6 requires Steps 1–4: the handler rewrite consumes the new proto field (`ingest_pb2.IngestSignalResponse(deduplicated=...)`, requires Step 2's stub), the new `ingest.signal_dedup_keys` table (Step 3), and `self._cfg.dedup_window_hours` (Step 4).
- Step 7 requires Step 6: tests the rewritten handler.
- Step 8 requires Step 2: `resp.deduplicated` requires the regenerated Python stub used by the agent's `gen.ingest.v1.ingest_pb2` import.
- Step 9 requires Step 8: tests the client mapping.
- Step 10 requires Step 8: the tool's alert-suppression guard reads `client.ingest_signal`'s returned `"deduplicated"` key.
- Step 11 requires Step 10: tests the tool guard.
- Step 12 requires Step 6 (config key + table exist) — documents them.
- Step 13 requires Step 10 (tool return shape final) — documents it.
- Step 14 requires Step 6 (behavior now implemented) — corrects the stale doc claim.

Consumer surface (Constitution C-14): product-spec names the Agent `ingest_signal` tool as the
sole consumer surface — Steps 10/11 land and prove it; no UI surface is named or required.

---

### Step 1 — proto: add `IngestSignalResponse.deduplicated`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ingest/v1/ingest.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, backward compatibility; `xstockstrat-ingest` service owner — signal normalization correctness; `xstockstrat-agent` service owner — MCP tool contract stability

**Codebase Evidence**:
- Confirmed via `Read packages/proto/ingest/v1/ingest.proto:119`: `message IngestSignalResponse { int64 signal_id = 1; }` — field 1 taken, field 2 free.
- `recon.md` § Codebase Map confirms this is the only field on the message.

**TDD**: `N/A (proto — no test framework runs .proto files; C-09 verification below is the gate)`

**Instructions**:
Change `packages/proto/ingest/v1/ingest.proto:119` from:
```protobuf
message IngestSignalResponse { int64 signal_id = 1; }
```
to:
```protobuf
message IngestSignalResponse {
  int64 signal_id = 1;
  // True when this submission matched an existing signal within the dedup window
  // (ingest.signals.dedup_window_hours) on (source, symbol, direction, conviction,
  // valid_until); signal_id is then the EXISTING signal's id, not a newly-inserted one.
  bool deduplicated = 2;
}
```
Additive field on an existing message — no breaking change, no v2 needed (per
`docs/runbooks/proto-versioning.md` "Non-breaking changes: Adding a new optional field").

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/ingest-signal-dedup"
```
Both must pass (a field *addition* to an existing message is never a `buf breaking` violation).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/ingest/v1/` — modify (generated)
- `packages/proto/gen/python/ingest/v1/` — modify (generated)
- `packages/proto/gen/ts/ingest/v1/` — modify (generated)

**Reviewers**: Proto Reviewer — inherited from Step 1 (same reviewers per the `proto-gen` inheritance rule)

**Codebase Evidence**:
- Root `CLAUDE.md` § Generating Proto Stubs: `./scripts/buf-gen.sh` — "generates TypeScript, Python, and Go stubs and compiles the TS package. Run after any `.proto` change."

**TDD**: `N/A (codegen — no hand-written logic)`

**Instructions**:
Run `./scripts/buf-gen.sh` from the repo root. Commit the regenerated stub files alongside Step 1's
`.proto` edit (checked-in codegen output per root `CLAUDE.md` § Key File Paths Reference — never
hand-edit `gen/`).

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/
```
Confirm the diff touches only `ingest/v1/` generated files (Go/Python/TS) and adds a
`deduplicated`/`Deduplicated` field accessor to the `IngestSignalResponse` stub in each language —
no unrelated package changes (proves the toolchain is in sync per `docs/runbooks/proto-versioning.md`
"Verifying the generated stubs match the protos").

---

### Step 3 — migration: `009_signal_dedup_keys`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/migrations/009_signal_dedup_keys.up.sql` — create
- `services/xstockstrat-ingest/migrations/009_signal_dedup_keys.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, hypertable partitioning strategy, index correctness; `xstockstrat-ingest` service owner

**Codebase Evidence**:
- Confirmed via `ls services/xstockstrat-ingest/migrations/`: last file is `008_signal_source_health.{up,down}.sql` → next is `009` (also confirmed collision-free against all 43 remote branches per `design.md` § Chosen Approach point 1).
- Schema `ingest` already exists (`migrations/000_schema.up.sql: CREATE SCHEMA IF NOT EXISTS ingest;`) — no `CREATE SCHEMA` needed in this migration.
- Precedent migrations for the identical side-table pattern: `services/xstockstrat-ledger/migrations/002_idempotency_keys.up.sql` (plain table, `PRIMARY KEY` on the natural key, supporting index on the timestamp column) and `services/xstockstrat-analysis/migrations/004_fundsignal_emitted.up.sql` (plain table, composite `PRIMARY KEY`, no FK to the hypertable it dedups).
- Exact schema confirmed in `design.md` § Chosen Approach point 1.

**TDD**: `N/A (migration — offline SQL review, see spec-template.md § Migration step verification)`

**Instructions**:
Create `009_signal_dedup_keys.up.sql`:
```sql
-- 009_signal_dedup_keys.up.sql
-- Service: xstockstrat-ingest
-- Feature 111 — dedup claim table for IngestSignal. A plain (non-hypertable) table, not a
-- unique index on ingest.newsletter_signals itself: that table is a hypertable partitioned
-- on ingested_at, and TimescaleDB requires a hypertable's unique index to include its
-- partition column, which isn't part of this natural dedup key. Same structural workaround
-- already shipped as ledger.idempotency_keys and analysis.fundsignal_emitted. No FK to
-- newsletter_signals.id, matching both precedents (their referenced table's PK also includes
-- a column outside the natural key).
CREATE TABLE IF NOT EXISTS ingest.signal_dedup_keys (
    source      TEXT        NOT NULL,
    symbol      TEXT        NOT NULL,
    direction   TEXT        NOT NULL,
    conviction  NUMERIC(4,3),
    valid_until TIMESTAMPTZ,
    signal_id   BIGINT      NOT NULL,
    claimed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (source, symbol, direction)
);
CREATE INDEX IF NOT EXISTS idx_signal_dedup_keys_claimed_at ON ingest.signal_dedup_keys (claimed_at);
```
Create `009_signal_dedup_keys.down.sql`:
```sql
-- 009_signal_dedup_keys.down.sql
-- Reverse 009: drop the dedup claim table (the index is dropped automatically with it).
DROP TABLE IF EXISTS ingest.signal_dedup_keys;
```

**Verification**:
```bash
ls services/xstockstrat-ingest/migrations/009_signal_dedup_keys.up.sql services/xstockstrat-ingest/migrations/009_signal_dedup_keys.down.sql
```
Read both files: confirm the `.down.sql`'s `DROP TABLE` reverses every `CREATE TABLE`/`CREATE INDEX`
in `.up.sql` (offline DDL review per `spec-template.md` § Migration step verification — no live
database).

---

### Step 4 — config: `ConfigWatcher.dedup_window_hours`

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/config/watcher.py` — modify

**Reviewers**: `xstockstrat-config` service owner — config key naming; `xstockstrat-ingest` service owner

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ingest/app/config/watcher.py:126-128`: the exact pattern to mirror —
  ```python
  @property
  def backfill_chunk_window_days(self) -> int:
      return self.get_int("ingest.backfill.chunk_window_days", default=90)
  ```
- `get_int` (`watcher.py:68-74`) already falls back to `default` when `self._snapshot is None` (unreachable config service) — no new fallback logic needed.
- Key naming `ingest.signals.dedup_window_hours` follows `<service>.<category>.<key>` (Constitution C-05); default `24` per product-spec Open Questions (resolved at the design gate, matching the historical documented intent in `services/xstockstrat-ingest/docs/context-constitution-findings.md:12`).

**TDD**: `red-green required`

**Instructions**:
In `services/xstockstrat-ingest/app/config/watcher.py`, add a new property after
`backfill_max_concurrent_chunks` (`:130-132`), under a new comment header mirroring the existing
`# Backfill config helpers — ingest.backfill.*` grouping style (`:108`):
```python
    # Signal dedup config helper — ingest.signals.* (feature 111)
    @property
    def dedup_window_hours(self) -> int:
        return self.get_int("ingest.signals.dedup_window_hours", default=24)
```

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check app/config/watcher.py && ruff format --check app/config/watcher.py
```
Paired test (Step 5) proves behavior; this step's own check is lint-only (F-07 honored: no
hardcoded value in source, read via `WatchConfig`/`get_int`'s snapshot).

---

### Step 5 — test: `dedup_window_hours` getter

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify

**Reviewers**: `xstockstrat-ingest` service owner

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ingest/tests/test_ingest_servicer.py:835-836`: the exact pattern to mirror —
  ```python
  def test_backfill_max_concurrent_jobs_default(self):
      assert _StubWatcher().backfill_max_concurrent_jobs == 3
  ```
  in `class TestConfigWatcherGetters` (`:756`), using `_StubWatcher` (`:745`, a `ConfigWatcher`
  subclass with no live `WatchConfig` connection — `_snapshot` starts `None`).

**TDD**: `red-green required` — write the test first against the pre-Step-4 tree (it fails:
`AttributeError: 'ConfigWatcher' object has no attribute 'dedup_window_hours'`), then confirm it
passes once Step 4 lands.

**Instructions**:
In `class TestConfigWatcherGetters` (`test_ingest_servicer.py:756`), add immediately after
`test_backfill_max_concurrent_jobs_default` (`:835-836`):
```python
    def test_dedup_window_hours_default(self):
        assert _StubWatcher().dedup_window_hours == 24
```
This is AC-4's "has a working default with no config service running" half; Step 7's
`test_dedup_window_hours_read_from_config` (design.md § Test Plan item 8) proves the wired-through
half at the servicer level.

**Verification**:
```bash
cd services/xstockstrat-ingest && pytest tests/test_ingest_servicer.py::TestConfigWatcherGetters::test_dedup_window_hours_default -v
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
```

---

### Step 6 — service: rewrite `IngestSignal` for dedup

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/app/handlers/servicer.py` — modify
- `services/xstockstrat-ingest/app/repositories/signal_sources.py` — modify

**Reviewers**: `xstockstrat-ingest` service owner — signal normalization correctness, idempotent ingestion

**Codebase Evidence**:
- Current handler: `services/xstockstrat-ingest/app/handlers/servicer.py:693-818` — bare
  `INSERT ... RETURNING id` via `self._db.fetchrow` (no transaction, no dedup check), confirmed by
  direct read this session. Validation block (`:704-738`, source/symbol/direction required,
  direction enum, conviction range, active-source-slug lookup) is **unchanged** by this step — only
  the persist step (`:748-818`, from the `try:` insert onward) is rewritten.
- `IngestServicer.__init__` stores the config watcher as `self._cfg` (`servicer.py:171`) — **not**
  `self._config` as `design.md`'s illustrative snippet names it; use `self._cfg.dedup_window_hours`
  (the real attribute, added in Step 4).
- `self._db` is an `asyncpg.Pool` (`app/main.py:52-58`, `asyncpg.create_pool(...)`); the
  `async with self._db.acquire() as conn, conn.transaction():` idiom is already precedented in this
  repo at `services/xstockstrat-analysis/app/repositories/opportunities.py:48`
  (`OpportunitiesRepository.replace_for_user`) — confirmed via read this session.
- `mark_source_fed` / `mark_source_error` already imported at `servicer.py:26,28` from
  `app/repositories/signal_sources.py:59-67,70-76`; `touch_source_last_seen` (new, see below) must be
  added to the same import block.
- Full transaction + sentinel-exception rollback shape, the widened `ON CONFLICT ... DO UPDATE ...
  WHERE ... RETURNING` claim SQL, and the post-rollback existing-id lookup: `design.md` § Chosen
  Approach point 3 (verbatim code block) — race-safe by Postgres's documented `INSERT ON CONFLICT`
  upsert contract, already trusted in this repo via
  `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:158-162`'s
  `"ON CONFLICT (symbol, source, as_of_date) DO NOTHING RETURNING symbol"`.
- `touch_source_last_seen` — new sibling of `mark_source_fed`
  (`services/xstockstrat-ingest/app/repositories/signal_sources.py:59-67`) and `mark_source_error`
  (`:70-76`): confirmed exact code in `design.md` § Chosen Approach ("Round 3 addition").

**TDD**: `red-green required` — Step 7's rewritten/new tests must fail against the pre-Step-6 tree
(the current unconditional-insert handler has no dedup branch and no `deduplicated` field access),
then pass after this step.

**Instructions**:
1. In `services/xstockstrat-ingest/app/repositories/signal_sources.py`, add immediately after
   `mark_source_error` (`:70-76`):
   ```python
   async def touch_source_last_seen(db_pool, slug: str) -> None:
       """Record that a source is alive (heard from it) without counting a new signal fed —
       used on a dedup hit, where mark_source_fed's signals_fed bump would be wrong."""
       await db_pool.execute(
           "UPDATE ingest.signal_sources SET last_seen_at = NOW() WHERE slug = $1", slug,
       )
   ```
2. In `services/xstockstrat-ingest/app/handlers/servicer.py`, add `touch_source_last_seen` to the
   `from app.repositories.signal_sources import (...)` block (`:23-33`), alongside the existing
   `mark_source_error`/`mark_source_fed` names (keep alphabetical order to match the existing list).
3. Replace the persist block `servicer.py:748-818` (from `try:` through the final `return
   ingest_pb2.IngestSignalResponse(signal_id=signal_id)`) with the transaction + dedup-claim logic in
   `design.md` § Chosen Approach point 3, with these two corrections against the real codebase:
   - Use `self._cfg.dedup_window_hours` (not `self._config...` — see Codebase Evidence above).
   - Keep the existing `symbol.upper()` call site consistent with the current code's
     `signal.symbol.upper()` (`servicer.py:758`) — the design snippet's `symbol_upper = signal.symbol.upper()`
     local is equivalent; use it once and reuse it in both the `newsletter_signals` INSERT and the
     `signal_dedup_keys` INSERT/claim so both statements target the same uppercased symbol.
   - The `_DuplicateSignal` sentinel class, the `except _DuplicateSignal:` block (before the existing
     generic `except Exception as e:` block — **ordering is safety-critical**, see design.md § Open
     Risks), and the final `if not deduplicated: ... else: await touch_source_last_seen(...)` branch
     all land exactly as shown in `design.md`.
   - The pre-existing `# Emit ledger event` block (current `servicer.py:793-816`,
     `self._ledger.AppendEvent(event_type="ingest.signal.ingested", ...)`) and the `mark_source_fed`
     call (current `:779-783`) move inside the `if not deduplicated:` branch — both are **unchanged**
     in content, only their placement changes (they must not run on a dedup hit, per design.md point 3
     comment `# existing side effects ... run only here, unchanged from today`).
   - Final return: `ingest_pb2.IngestSignalResponse(signal_id=signal_id, deduplicated=deduplicated)`.

**Verification**:
```bash
cd services/xstockstrat-ingest && ruff check app/handlers/servicer.py app/repositories/signal_sources.py
cd services/xstockstrat-ingest && ruff format --check app/handlers/servicer.py app/repositories/signal_sources.py
```
Behavioral proof is Step 7's paired test run (red-before-green).

---

### Step 7 — test: `IngestSignal` dedup behavior

**Status**: `done`
**Service**: `xstockstrat-ingest`
**Files**:
- `services/xstockstrat-ingest/tests/test_ingest_servicer.py` — modify
- `services/xstockstrat-ingest/tests/_helpers.py` — modify

**Reviewers**: `xstockstrat-ingest` service owner

**Codebase Evidence**:
- `class TestIngestSignal` (`test_ingest_servicer.py:603-719`), `make_servicer` factory
  (`:30-60` — needs a new `dedup_window_hours: int = 24` kwarg wired to `cfg.dedup_window_hours`,
  mirroring how `backfill_max_concurrent_jobs` etc. are already wired), `_make_signal_req` helper
  (`:648-666`).
- Existing tests mock `svc._db.fetchrow` directly at the pool level (`:672`, `:683`, `:697-699`,
  `:713`) — the rewritten handler instead calls `self._db.acquire()` / `conn.fetchrow(...)` /
  `conn.transaction()` for the two transactional statements, and `self._db.fetchrow(...)` (pool
  level, unchanged) only for the source-registry lookup and the post-rollback existing-id SELECT —
  confirmed via `design.md` § Chosen Approach point 3 and § Open Risks (resolved mocking risk).
- Reusable async-context-manager mock idiom (per `design.md` § Open Risks, resolved): `cm =
  MagicMock(); cm.__aenter__ = AsyncMock(return_value=...); cm.__aexit__ = AsyncMock(return_value=False)`
  — confirmed live precedent at `services/xstockstrat-agent/tests/test_client.py:71-75`
  (`_channel_cm`). House the ingest equivalent in `services/xstockstrat-ingest/tests/_helpers.py`
  (already the shared-fixture home per its own module docstring, `_helpers.py:1-13`).
- Full 10-case + 4-rewrite test list: `design.md` § Test Plan, items 1–10 (verbatim test names and
  assertions).

**TDD**: `red-green required` — this step both rewrites the 4 existing tests (they currently pass
against the old mocking shape and must be updated to the new one, where they still assert the same
behavior) and adds 10 new tests that must fail against the pre-Step-6 tree, then pass after Step 6.

**Instructions**:
1. In `tests/_helpers.py`, add a `transaction_conn(fetchrow_side_effect)` (or equivalently named)
   helper building the `self._db.acquire()` async-context-manager mock (yielding a `conn` mock whose
   `conn.fetchrow` has the given `side_effect` list and whose `conn.transaction()` is a no-op async
   context manager) — reused across all of this step's new `TestIngestSignal` cases instead of
   duplicating the mock-construction boilerplate four-plus times.
2. In `make_servicer` (`test_ingest_servicer.py:30-60`), add a `dedup_window_hours: int = 24`
   parameter and set `cfg.dedup_window_hours = dedup_window_hours` alongside the other `cfg.*`
   assignments (`:48-53`).
3. Rewrite `test_success_inserts_and_returns_id`, `test_success_with_valid_until`,
   `test_db_error_aborts`, `test_ledger_error_is_swallowed` (`:668-719`) for the new
   `acquire()`/`transaction()` mock shape (design.md § Test Plan item 10) — same asserted behavior,
   new mocking mechanics. Extend `test_db_error_aborts`'s scenario to also cover a failure raised by
   the *claim* statement (the second `conn.fetchrow` call), not only the primary insert.
4. Add the 9 new cases from `design.md` § Test Plan items 1–9, verbatim by name and assertion:
   `test_dedup_hit_returns_existing_id_and_deduplicated_flag`,
   `test_dedup_hit_does_not_reach_generic_error_handler` (the rollback-correctness pin — asserts
   `context.abort` and `mark_source_error` are never called on a dedup hit),
   `test_dedup_hit_skips_mark_source_fed_and_ledger_event`,
   `test_dedup_hit_touches_last_seen_only`,
   `test_fresh_submission_outside_window_inserts_and_refreshes_claim`,
   `test_fresh_submission_different_conviction_inserts_new_row`,
   `test_fresh_submission_different_valid_until_inserts_new_row`,
   `test_fresh_submission_different_direction_inserts_new_row`,
   `test_dedup_window_hours_read_from_config` (asserts `self._cfg.dedup_window_hours` flows into the
   claim statement's `$7` parameter — construct `make_servicer(dedup_window_hours=...)` with a
   non-default value and assert the mocked `conn.fetchrow` call args carry it).

**Verification**:
```bash
cd services/xstockstrat-ingest && pytest tests/test_ingest_servicer.py::TestIngestSignal -v
cd services/xstockstrat-ingest && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-ingest && ruff check . && ruff format --check .
```

---

### Step 8 — service: agent `client.ingest_signal` surfaces `deduplicated`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: `xstockstrat-agent` service owner — MCP tool contract stability

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-agent/app/client.py:149-186`: `ingest_signal` builds
  `ingest_pb2.ExternalSignal`, calls `stub.IngestSignal(...)` (`:182-185`), and returns only
  `{"signal_id": resp.signal_id}` (`:186`).
- `resp` attributes are snake_case (`resp.signal_id`, confirmed by the existing line), so the new
  proto field (Step 2) reads as `resp.deduplicated`.

**TDD**: `red-green required`

**Instructions**:
In `services/xstockstrat-agent/app/client.py:186`, change:
```python
    return {"signal_id": resp.signal_id}
```
to:
```python
    return {"signal_id": resp.signal_id, "deduplicated": resp.deduplicated}
```

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check app/client.py && ruff format --check app/client.py
```
Behavioral proof is Step 9's paired test.

---

### Step 9 — test: `client.ingest_signal` maps `deduplicated`

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` service owner

**Codebase Evidence**:
- Confirmed via `Grep "class Test" services/xstockstrat-agent/tests/test_client.py`: no
  `TestIngestSignalClient`-style class exists — `client.ingest_signal` has **no existing unit test**
  in this file today (also confirmed independently by `recon.md` § Codebase Map and `design.md` §
  Test Plan).
- Mocking pattern to reuse: `_channel_cm()` (`test_client.py:71-75`) + `patch("app.client.grpc")` +
  `patch.object(<stub_module>, "<StubClass>", return_value=mock_stub)`, as used by
  `TestManageStrategyClient` (`:78-89`).

**TDD**: `red-green required` — this is a net-new test for a currently-untested function; it must
be written to assert the new `"deduplicated"` key specifically (not just `"signal_id"`), so it fails
against the pre-Step-8 client (`KeyError`/`AssertionError` on the missing key) and passes after.

**Instructions**:
Add a new `class TestIngestSignalClient` to `services/xstockstrat-agent/tests/test_client.py`
(placed near the other management-client test classes, e.g. after `TestManageSignalSourceClient`,
`:309-331`), with `test_ingest_signal_maps_deduplicated_field`: mock the `IngestServiceStub`'s
`IngestSignal` to return a response with `signal_id=7, deduplicated=True`, call
`client.ingest_signal(...)`, and assert the returned dict equals
`{"signal_id": 7, "deduplicated": True}`.

**Verification**:
```bash
cd services/xstockstrat-agent && pytest tests/test_client.py::TestIngestSignalClient -v
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 10 — service: agent `ingest_signal` tool suppresses alert on dedup

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: `xstockstrat-agent` service owner — MCP tool contract stability, `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-agent/app/tools.py:226-296`: the `ingest_signal` tool
  (`@server.tool()`, `:226`) calls `client.ingest_signal(...)` (`:252-262`, result stored as
  `result`, never inspected), then unconditionally reads the alert threshold and — `if conviction is
  not None and conviction >= alert_threshold:` (`:278`) — calls `client.emit_alert(...)` (`:284-291`).
  The docstring (`:238-251`) currently states `Returns {"signal_id": <int>} on success`.

**TDD**: `red-green required`

**Instructions**:
1. In `services/xstockstrat-agent/app/tools.py:278`, change the guard from:
   ```python
       if conviction is not None and conviction >= alert_threshold:
   ```
   to:
   ```python
       if not result.get("deduplicated") and conviction is not None and conviction >= alert_threshold:
   ```
   (FR-4: read the key explicitly via `.get()`, which is `None`/falsy-safe for a missing key but the
   guard's correctness must be proven the tool actually reads `False` vs an absent key, not just
   truthiness — covered by design.md's Test Plan item 12.)
2. Update the docstring (`:250-251`) from:
   ```
       Returns {"signal_id": <int>} on success; raises on unknown source slug
       (INVALID_ARGUMENT)."""
   ```
   to:
   ```
       Returns {"signal_id": <int>, "deduplicated": <bool>} on success — deduplicated=true means
       this submission matched an existing signal within the dedup window and no new row was
       inserted (the auto-alert above is suppressed in that case); raises on unknown source slug
       (INVALID_ARGUMENT)."""
   ```

**Verification**:
```bash
cd services/xstockstrat-agent && ruff check app/tools.py && ruff format --check app/tools.py
```
Behavioral proof is Step 11's paired test.

---

### Step 11 — test: `ingest_signal` tool alert suppression

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify

**Reviewers**: `xstockstrat-agent` service owner

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-agent/tests/test_tools.py:220-297`: the existing
  `ingest_signal` test block —
  `test_ingest_signal_calls_grpc` (`:224-244`), `test_ingest_signal_auto_alert_above_threshold`
  (`:247-270`, mocks `client.ingest_signal` return as `{"signal_id": 7}` with no `deduplicated` key),
  `test_ingest_signal_survives_threshold_read_failure` (`:273-296`).
- Design's Test Plan items 11–13 give the exact three cases to add/update.

**TDD**: `red-green required` — `test_ingest_signal_suppresses_alert_when_deduplicated` must fail
against the pre-Step-10 tool (which ignores `result` entirely) and pass after.

**Instructions**:
1. Add `test_ingest_signal_suppresses_alert_when_deduplicated`: mock `client.ingest_signal` to
   return `{"signal_id": 7, "deduplicated": True}` with `conviction` above the alert threshold
   (e.g. `0.8` against the default `0.6`); assert `client.emit_alert` (mocked, patched the same way
   as `test_ingest_signal_auto_alert_above_threshold`, `:253-256`) is **not** called (FR-4/AC-3).
2. Update `test_ingest_signal_auto_alert_above_threshold` (`:247-270`): change the mocked
   `client.ingest_signal` return at `:250` from `AsyncMock(return_value={"signal_id": 7})` to
   `AsyncMock(return_value={"signal_id": 7, "deduplicated": False})` — a regression guard proving
   the new guard reads the key rather than accidentally over-suppressing on a missing key.
3. Add `test_ingest_signal_returns_deduplicated_field_in_payload`: assert the tool's returned dict
   (from a call analogous to `test_ingest_signal_calls_grpc`, `:224-244`, with a mocked
   `client.ingest_signal` return including `"deduplicated": False`) includes the `"deduplicated"` key
   end-to-end.

**Verification**:
```bash
cd services/xstockstrat-agent && pytest tests/test_tools.py -k ingest_signal -v
cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40
cd services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 12 — docs: `services/xstockstrat-ingest/CLAUDE.md`

**Status**: `done`
**Service**: `docs/`
**Files**:
- `services/xstockstrat-ingest/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ingest/CLAUDE.md`: the `## Config Keys Consumed` table
  (currently 7 `ingest.backfill.*` rows, no `ingest.signals.*` namespace) and `## Database` section
  (bulleted list ending with the `ingest.backfill_chunks` / migration `004` entry).

**TDD**: `N/A (docs)`

**Instructions**:
1. In the `## Config Keys Consumed` table, add a new row after the last `ingest.backfill.*` row:
   ```
   | `ingest.signals.dedup_window_hours` | int | `24` | Window within which a matching (source, symbol, direction, conviction, valid_until) signal is treated as a duplicate of the existing `ingest.signal_dedup_keys` claim (feature 111) |
   ```
2. In the `## Database` section, add a new bullet after the `ingest.signal_sources` bullet
   (source-registry, migration 008):
   ```
   - Table `ingest.signal_dedup_keys` — plain (non-hypertable) side table,
     `PRIMARY KEY (source, symbol, direction)`; `IngestSignal` atomically claims a row per submission
     (`INSERT ... ON CONFLICT ... DO UPDATE ... WHERE claimed_at < NOW() - dedup_window_hours OR
     conviction/valid_until differ ... RETURNING signal_id`) inside its first explicit asyncpg
     transaction. A claim miss (`WHERE` false) means the submission is a duplicate; the response
     carries `deduplicated=true` and the existing `signal_id`. Migration:
     `migrations/009_signal_dedup_keys.up.sql`.
   ```

**Verification**:
```bash
grep -n "ingest.signals.dedup_window_hours" services/xstockstrat-ingest/CLAUDE.md
grep -n "signal_dedup_keys" services/xstockstrat-ingest/CLAUDE.md
```
Both must return at least one match.

---

### Step 13 — docs: `docs/runbooks/mcp-tools.md`

**Status**: `done`
**Service**: `docs/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via `Read docs/runbooks/mcp-tools.md:195-227`: the `### ingest_signal` section's
  `**Return**` block (`{ "signal_id": 42 }`) and `**Errors**` table (last row: "Auto-alert emission
  fails").

**TDD**: `N/A (docs)`

**Instructions**:
1. Change the `**Return**` block from:
   ```json
   { "signal_id": 42 }
   ```
   to:
   ```json
   { "signal_id": 42, "deduplicated": false }
   ```
2. Add a sentence after the existing intro line ("Ingests a trading signal into
   `xstockstrat-ingest`. If `conviction` meets or exceeds `agent.signal.alert_threshold` ..."):
   "A resubmission matching an existing signal within `ingest.signals.dedup_window_hours` (source,
   symbol, direction, conviction, and valid_until all equal) returns the **existing** `signal_id`
   with `deduplicated: true` instead of inserting a new row, and the auto-alert below is suppressed
   in that case."
3. Add a row to the `**Errors**` table (after "Auto-alert emission fails"):
   ```
   | `deduplicated: true` in the response | Not an error — the auto-alert is intentionally suppressed for this submission |
   ```

**Verification**:
```bash
grep -n "deduplicated" docs/runbooks/mcp-tools.md
```
Must return at least 3 matches (Return block, intro sentence, Errors table row).

---

### Step 14 — docs: correct the stale "Dedup key" finding

**Status**: `done`
**Service**: `docs/`
**Files**:
- `services/xstockstrat-ingest/docs/context-constitution-findings.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-ingest/docs/context-constitution-findings.md:1-25`: the
  `## Documentation that lies` table's row —
  ```
  | Dedup key: "Skip re-ingesting same symbol+source+direction within this window" | `IngestSignal` always INSERTs; migration 001 has no unique constraint | `CLAUDE.md:79` vs `servicer.py:659` | Implement dedup or remove the claim |
  ```
  This is AC-6's target — the adjacent "9 dead `ingest.signals.*` config keys" row (a different,
  already-resolved claim per `design.md` § 7) is a **sibling row, not this one**, and must not be
  touched.

**TDD**: `N/A (docs)`

**Instructions**:
Remove the "Dedup key" row from the `## Documentation that lies` table (the behavior it described as
missing is now implemented by Step 6 — the row's premise, "the docs claim behavior the code lacks,"
no longer holds). Leave every other row in the table, including the "9 dead ... config keys" row, as
they are.

**Verification**:
```bash
grep -n "Dedup key" services/xstockstrat-ingest/docs/context-constitution-findings.md
```
Must return no matches.

---

## Deviation Log

Implementation followed the plan step-for-step; the deviations below are additive hardening
discovered during red-before-green testing, not scope or architecture changes.

- **Step 7**: added `test_db_error_aborts_on_claim_failure` alongside the rewritten
  `test_db_error_aborts` — the instructions said to "extend `test_db_error_aborts`'s scenario to
  also cover a failure in the claim statement"; implemented as a sibling test (clearer failure
  attribution than parametrizing one test over two distinct failure origins) rather than
  literally editing the single existing test.
- **Step 7**: two more pre-existing tests outside `TestIngestSignal` (not named in the spec's
  Codebase Evidence) also exercised the old `svc._db.fetchrow`-direct mocking shape and needed
  the same rewrite to stay green: `TestIngestSignalRegistryValidation::test_proceeds_when_source_registered`
  and `TestIngestSignalConvictionValidation::_servicer_full_happy_path` (used by
  `test_in_range_conviction_proceeds`), both in `test_ingest_servicer.py`. Also
  `test_source_health.py::test_ingest_signal_bumps_fed_count`. All three rewritten with the same
  `transaction_conn` helper — same fix, wider blast radius than the spec's Codebase Evidence
  anticipated.
- **Step 12**: the `ingest.signal_sources` bullet's existing prose ("`IngestSignal` bumps
  `last_seen_at`+`signals_fed`") was updated in place to also describe the new
  `touch_source_last_seen`-only path on a dedup hit — a one-sentence factual correction to a line
  this step's own change makes stale, not a new documentation surface.

**Verification run**: `xstockstrat-ingest` 179/179 tests pass (`pytest --cov=app
--cov-fail-under=40`, 76.5% actual); `xstockstrat-agent` 201/201 tests pass (77.1% actual);
`ruff check`/`ruff format --check` clean on both services; `buf lint` + `buf breaking --against
main-dev` pass; generated stub diff scoped to `ingest/v1/` only in all three languages (Go,
Python, TS).
