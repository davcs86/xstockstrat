# Recon: ingest-signal-dedup

**Created**: 2026-08-07
**From**: product-spec.md
**Affected services**: `xstockstrat-ingest`, `xstockstrat-agent`, `packages/proto`

---

## Objective

`IngestSignal` (owned by `xstockstrat-ingest`) unconditionally inserts every submitted signal
with zero duplicate check — a documented but never-implemented defect. Add a dedup check so a
resubmission of the same `(source, symbol, direction)` signal within a configurable window
returns the existing signal instead of inserting a duplicate row, and have the MCP agent's
`ingest_signal` tool suppress its duplicate auto-alert side effect when that happens.

## Codebase Map

- **`xstockstrat-ingest`** (Python 3.12, asyncio/grpc.aio)
  - Entry point: `services/xstockstrat-ingest/app/main.py:55-58` (asyncpg pool: `asyncpg.create_pool(..., min_size=1, max_size=int(os.environ.get("DB_POOL_MAX", "2")))`)
  - Handler/servicer: `IngestSignal` — `services/xstockstrat-ingest/app/handlers/servicer.py:693-818`
    - Validation (source/symbol/direction required, direction enum, conviction range, active
      source slug) at `:704-738`.
    - Bare `INSERT ... RETURNING id` via `await self._db.fetchrow(...)` at `:748-767` — **no
      pre-check SELECT, no explicit transaction, no unique constraint**. `self._db` is an
      `asyncpg.Pool`; each `fetchrow`/`execute` call auto-acquires/releases a connection, so two
      sequential calls (SELECT-then-INSERT) are **not atomic** and race under concurrency.
  - Last migration: `008_signal_source_health.up.sql` (`services/xstockstrat-ingest/migrations/`) — **next number is `009`**.
  - Config-read pattern: `services/xstockstrat-ingest/app/config/watcher.py:60-90` (`get_str`/`get_int`/`get_bool`/`get_float`, each `if self._snapshot is None: return default`), typed property wrapper example at `:126-128` (`backfill_chunk_window_days` → `self.get_int("ingest.backfill.chunk_window_days", default=90)`). Unreachable config service → falls back to the hardcoded `default` arg; startup blocks ≤90s for first snapshot (`app/main.py:46`), then serves last-known snapshot on stream drop.
  - Table `ingest.newsletter_signals`: hypertable partitioned on `ingested_at`,
    `PRIMARY KEY (id, ingested_at)` (`migrations/001_newsletter_signals.up.sql:20,23`). **No
    UNIQUE constraint on any subset of `(source, symbol, direction, valid_from, raw_url)`.**
    Non-unique indexes only: `(symbol, ingested_at DESC)`, `(source, ingested_at DESC)`,
    `(valid_from, valid_until)`.
  - Documented defect this feature closes: `services/xstockstrat-ingest/docs/context-constitution-findings.md:12` — "Dedup key: 'Skip re-ingesting same symbol+source+direction within this window' | `IngestSignal` always INSERTs; migration 001 has no unique constraint".

- **`xstockstrat-agent`** (Python, FastMCP)
  - Tool: `ingest_signal` — `services/xstockstrat-agent/app/tools.py:226-296`. Calls
    `client.ingest_signal(...)` at `:252-262` (result never inspected), then unconditionally
    reads `agent.signal.alert_threshold` config and — if `conviction is not None and conviction
    >= alert_threshold` (`:278`) — calls `client.emit_alert(...)` (`:279-292`), regardless of
    `result`. This is the exact spot a `deduplicated` guard needs to wrap.
  - Client: `client.ingest_signal` — `services/xstockstrat-agent/app/client.py:149-186`. Builds
    `ingest_pb2.ExternalSignal`, single `await stub.IngestSignal(...)` call (no retry/backoff
    anywhere in the agent — confirmed via grep), returns `{"signal_id": resp.signal_id}`
    (`:186`) — the only key today.
  - Docs: `docs/runbooks/mcp-tools.md:195-227` (`### ingest_signal`) — documented return is
    `{"signal_id": 42}` (`:213-217`); auto-alert sentence at `:197`; errors table row
    "Auto-alert emission fails" at `:226`.
  - Tests: `services/xstockstrat-agent/tests/test_tools.py:224` (`test_ingest_signal_calls_grpc`),
    `:248` (`test_ingest_signal_auto_alert_above_threshold`), `:274`
    (`test_ingest_signal_survives_threshold_read_failure`). No test of `client.ingest_signal`
    itself in `tests/test_client.py` (confirmed absent).

- **`packages/proto`**
  - RPC: `rpc IngestSignal(IngestSignalRequest) returns (IngestSignalResponse);` —
    `packages/proto/ingest/v1/ingest.proto:20`.
  - `message IngestSignalResponse { int64 signal_id = 1; }` — `packages/proto/ingest/v1/ingest.proto:119`.
    Adding `bool deduplicated = 2;` is an additive, non-breaking field.
  - Import pattern in the agent client: `from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc`
    (`services/xstockstrat-agent/app/client.py:161`) — response attributes are snake_case
    (`resp.signal_id`), so a new field reads as `resp.deduplicated`.

## Patterns to REUSE

- **Dedup-key storage** → reuse the **side-table + `ON CONFLICT DO NOTHING RETURNING`** pattern
  already used twice in this repo for the identical structural problem (natural-key dedup on a
  hypertable whose partition column isn't the dedup key):
  - `ledger.idempotency_keys` — `services/xstockstrat-ledger/migrations/002_idempotency_keys.up.sql:1-8`
    (comment: "a unique index on a hypertable must include the partitioning column
    (`recorded_at`), which would defeat dedup. Keeping the key map in its own small table
    sidesteps that limitation."), claimed atomically in one transaction —
    `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:71-98`
    (`BEGIN; INSERT ... ON CONFLICT (idempotency_key) DO NOTHING RETURNING event_id; if no rows
    → look up existing`).
  - `analysis.fundsignal_emitted` — `services/xstockstrat-analysis/migrations/004_fundsignal_emitted.up.sql:1-15`
    (plain table, `PRIMARY KEY (symbol, source, as_of_date)`), used via
    `"ON CONFLICT (symbol, source, as_of_date) DO NOTHING RETURNING symbol"` —
    `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:158-162`.
  - **Confirmed constraint** (every hypertable migration in the repo includes its partition
    column in the PK/unique index — `marketdata.ohlcv`, `marketdata.quotes`,
    `portfolio.snapshots`, `ledger.events`; none excludes it): a unique/partial index on
    `ingest.newsletter_signals(source, symbol, direction)` alone is **not possible** on this
    hypertable. A side table is the only precedented way to get an atomic conflict-checked claim.
- **Config key + typed getter** → reuse `ConfigWatcher.get_int` + a typed property, exactly like
  `backfill_chunk_window_days` (`app/config/watcher.py:126-128`), for the new
  `ingest.signals.dedup_window_hours` key.
- **Race-safety within a transaction** → reuse the ledger's `BEGIN` / claim-row /
  `ROLLBACK`-on-conflict shape (`ledgerServiceImpl.ts:71-98`), adapted to asyncpg
  (`self._db.acquire()` + `conn.transaction()` — note: `xstockstrat-ingest` has **zero**
  existing explicit-transaction usage anywhere in `app/`, confirmed via grep of
  `app/repositories/` — this feature introduces the service's first one).

## Dependencies

- Proto/RPC: `IngestSignalResponse` (`packages/proto/ingest/v1/ingest.proto:119`) gains
  `bool deduplicated = 2;` — additive, non-breaking; requires `./scripts/buf-gen.sh`.
- Migration: next number `009` for `services/xstockstrat-ingest/migrations/` — new plain
  (non-hypertable) table, e.g. `ingest.signal_dedup_keys`, following the
  `ledger.idempotency_keys` / `analysis.fundsignal_emitted` shape.
- Config keys: new `ingest.signals.dedup_window_hours` (int) — no existing `ingest.signals.*`
  namespace currently declared in `services/xstockstrat-ingest/CLAUDE.md` (the historical one was
  fully removed as dead; this feature reintroduces the namespace with a wired key this time).
- Inter-service edges: none new — dedup is entirely within `xstockstrat-ingest`'s existing
  `IngestSignal` handler; the agent already calls `IngestSignal`.
- New env vars / ports: none.

## Risks / Not-found

- **Race safety**: `IngestSignal` today has no explicit transaction anywhere in this service;
  the chosen approach must wrap the claim-row + `newsletter_signals` INSERT in one asyncpg
  transaction (`conn.transaction()`) to avoid a TOCTOU duplicate under concurrent calls with the
  same natural key — confirmed via recon that a naive two-step SELECT-then-INSERT (using the pool
  directly) is **not** race-safe.
- **`ledger` copy-paste trap** (adjacent, not required to fix): `ConfigWatcher`'s module
  docstring and `client_id=f"indicators-{id(self)}"` at `app/config/watcher.py:2,36` is a
  pre-existing copy-paste bug (ingest registers under an `indicators-…` client id) — out of scope
  for this feature (touch only what the task requires per CLAUDE.md §1), noted here only so the
  implementer doesn't confuse it with new code being added to the same file.
- **Ledger fail 2026-08-06 (fundamentals-signal-producer, design)**: "when a callee RPC lacks a
  uniqueness constraint, the idempotency guard belongs in the caller's own state table keyed on
  its natural key" — directly on point; `xstockstrat-ingest` is the state-owning layer for
  `IngestSignal`, confirming product-spec FR-5's placement.
- **Ledger fail 2026-08-02 (086-fix-mcp-formula-lifecycle, design)**: a surfaced boolean/flag
  must be honestly reflected everywhere relevant, not just the hot path — applies to
  `deduplicated`: confirm the agent's tool response and `mcp-tools.md` both reflect it
  consistently (product-spec Open Questions already flags this).
- **Window semantics not yet fixed**: whether the window is measured from the *existing* row's
  `valid_from` (candidate design: exact-match key with a `claimed_at`/last-seen timestamp) or a
  time-bucketed key — left to Phase 1 grilling; time-bucketing has a known boundary-split failure
  mode (two near-identical signals straddling a bucket edge both get inserted) that the ledger's
  own PK-based approach avoids by not bucketing.

## Recommended Scope

1. Proto: add `IngestSignalResponse.deduplicated` (+ `buf-gen.sh`).
2. Migration `009`: new `ingest.signal_dedup_keys` plain table (natural key + `signal_id` +
   `claimed_at`).
3. `xstockstrat-ingest`: config key `ingest.signals.dedup_window_hours` (+ typed getter);
   `IngestSignal` handler wraps the claim + insert in one transaction, returns existing
   `signal_id` + `deduplicated=true` on a within-window hit.
4. `xstockstrat-agent`: `client.ingest_signal` surfaces `deduplicated`; `tools.py` suppresses the
   auto-alert when `deduplicated` is true; update `mcp-tools.md`.
5. Docs: `services/xstockstrat-ingest/CLAUDE.md` (new config key + table), correct/remove the
   stale "Dedup key" row in `context-constitution-findings.md`.
6. Tests: ingest servicer test for dedup-hit/dedup-miss/window-expiry; agent tool test for
   alert-suppression-on-dedup.
