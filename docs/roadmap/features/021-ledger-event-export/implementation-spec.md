# Implementation Spec: ledger-event-export

**Status**: `pending`
**Created**: 2026-08-31
**Feature**: `docs/roadmap/features/021-ledger-event-export/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/ledger-event-export`

---

## Execution Summary

The contract lands first (Step 1 proto, Step 2 proto-gen), then the ledger storage and write path
(Step 3 migration → Steps 4/5 `appendEvent` user_id stamping), then the read/export engine (Steps 6/7
`ExportEvents` with a dedicated cursor connection), then the config gate (Step 8), then the one
producer whose background emits would otherwise be `NULL` (Steps 9/10 trading), and finally the
`/trader` consumer surface — the BFF streaming route (Step 11), the download button (Step 12), and
the Playwright coverage that exercises both (Step 13). Order is dictated by data dependency: nothing
can filter or return `user_id` until the proto field, the column, and the write-path stamp all exist,
and the browser cannot stream until the RPC does.

**Consumer surface (C-14).** Product spec names exactly one surface: **UI → `/trader`** (button + BFF
route); the Agent surface is explicitly "none". Per the approved design (Design-Phase Decision (a))
the button is added to an **existing** `/trader` page (Book → Portfolio), so no new nav route and no
`PLATFORM_SUBNAV`/`NAV_GROUPS` registration is required (C-10(a) sidestepped by avoidance — the
`route.ts` handler is not a nav surface). Producer-attribution for portfolio/analysis/ingest event
classes is deferred to the **named follow-up `021b-ledger-producer-attribution`** (design § User
attribution; C-14 deferral record) — see `## Step Dependencies`.

### Scenario Coverage (Constitution C-15)

Every `@AC-*` in `acceptance.feature` is covered by ≥1 test step:

| Scenario | Covered by (test step) |
|---|---|
| `@AC-1` (NDJSON, global-sequence order) | Step 7 (ordering by `sequence`), Step 13 (NDJSON 200 body) |
| `@AC-2` (CSV header + rows) | Step 13 |
| `@AC-3` (`event_type` filter) | Step 7, Step 13 |
| `@AC-4` (omit filter → all types) | Step 7, Step 13 |
| `@AC-5` (over-window → `InvalidArgument` → 400) | Step 7 (ledger `InvalidArgument` + message), Step 13 (BFF 400) |
| `@AC-6` (unauthenticated → 401, no ledger call) | Step 13 |
| `@AC-7` (1M rows, cursor, no full-set buffer) | Step 7 |
| `@AC-8` (row carries all required fields incl `user_id`/`payload`) | Step 7 (read shape), Step 5 + Step 10 (write-side stamp) |
| `@AC-9` (button → last 90 days, all types, save dialog) | Step 13 |
| `@AC-10` (`ledger.export.enabled=false` → reject → 403) | Step 7 (ledger `FailedPrecondition`), Step 13 (BFF 403) |
| `@AC-11` (per-user isolation) | Step 7 (`WHERE user_id = $caller`), Step 5 + Step 10 (correct stamping) |

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto): stubs regenerate only after the `.proto` edit.
- Step 4 (ledger write) requires Step 2 (needs generated `userId` on `AppendEventRequest`) and Step 3
  (needs the `user_id` column).
- Step 6 (`ExportEvents`) requires Steps 2 + 3 (generated request/response messages + `user_id`
  column/index) and adds the `pg-cursor` dependency.
- Step 9 (trading producer) requires Step 2 (needs generated `AppendEventRequest.UserId` in the Go
  stub `ledgerv1`).
- Step 11 (BFF route) requires Step 2 (needs the connect-es `exportEvents` client method) and Step 6
  (the RPC must exist to call). Step 12 (button) requires Step 11.
- Each `service` step is paired with the immediately following `test` step (Steps 4→5, 6→7, 9→10);
  Steps 11+12 (both `xstockstrat-ui`, no coverage threshold) are jointly covered by Step 13's e2e.
- **Deferred surface (C-14):** per-user attribution of non-trading producers is out of this feature's
  scope and lands in the named follow-up **`021b-ledger-producer-attribution`** — not a vague "later".

---

### Step 1 — proto: additive `ExportEvents` RPC + `user_id` fields

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/ledger/v1/ledger.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, `buf breaking` passes against dev trunk; xstockstrat-ledger — append-only event contract, event ordering by `sequence`

**Codebase Evidence**:
- `LedgerService` RPC block confirmed at `packages/proto/ledger/v1/ledger.proto:13-18` (four unary/stream RPCs; last is `GetEvent`).
- `LedgerEvent` message `packages/proto/ledger/v1/ledger.proto:20-31` — highest field number is `stream_key = 10` (`:30`); `sequence = 9` is documented "GLOBAL monotonic" (`:29`). Next free = **11**.
- `AppendEventRequest` `packages/proto/ledger/v1/ledger.proto:33-46` — highest field number is `idempotency_key = 8` (`:45`). Next free = **9**.
- `event_type` is a free-string today (`LedgerEvent.event_type = 2`, `:22`); the filter stays a `string` (comma-joined subset), not an enum — values are runtime-open (design § Constitution Rules Touched, C-04 considered).

**TDD**: `N/A (proto contract — verified by buf lint/breaking, not a unit test)`

**Covers**: —

**Instructions**:
- Add one RPC to `service LedgerService` (after `GetEvent`, `:17`):
  `rpc ExportEvents(ExportEventsRequest) returns (stream ExportEventsResponse);`
- Add two messages:
  - `ExportEventsRequest { google.protobuf.Timestamp start = 1; google.protobuf.Timestamp end = 2; string event_type = 3; }` — `event_type` = comma-joined subset of `fill,signal,pnl_snapshot,config_change,alert`; empty = all (FR-3).
  - `ExportEventsResponse { repeated LedgerEvent events = 1; }` — **batched** (one message per DB-cursor page), per design (AC-7: a 1M-row export is thousands of messages, not millions).
- Add `string user_id = 11;` to `LedgerEvent` (with a `// owning user; empty when platform-scoped or a pre-migration row` comment), and `string user_id = 9;` to `AppendEventRequest` (`// owning user; falls back to the x-user-id metadata when empty`). All additions are additive → non-breaking.
- Do **not** renumber or reserve any existing field (F-01 spirit for contracts; C-09).

**Verification**:
```bash
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/ledger-event-export"
# both pass; buf breaking reports no breaking change (additive RPC + additive fields)
```

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; do not hand-edit)

**Reviewers**: Proto Reviewer — field number uniqueness per message, `buf breaking` passes against dev trunk; xstockstrat-ledger — append-only event contract, event ordering by `sequence` (inherited from Step 1)

**Codebase Evidence**:
- Codegen entry point `./scripts/buf-gen.sh` (root CLAUDE.md § Generating Proto Stubs — "generates TypeScript, Python, and Go stubs and compiles the TS package").
- Two TS stub flavors are consumed downstream and both regenerate here: ts-proto on the ledger service (`@xstockstrat/proto/ledger/v1/ledger` → `LedgerServiceService`, `services/xstockstrat-ledger/src/grpc/serviceDefinition.ts:1`) and connect-es on the UI (`@xstockstrat/proto/ledger/v1/ledger_pb` → `LedgerService`, `services/xstockstrat-ui/src/lib/connectClients.ts:8`); Go stub `ledgerv1` on trading (`services/xstockstrat-trading/internal/service/trading.go:29`).

**TDD**: `N/A (generated code — proto-freshness CI gate, not a unit test)`

**Covers**: —

**Instructions**:
- Run `./scripts/buf-gen.sh` from repo root. Do not edit any file under `packages/proto/gen/` by hand.
- Confirm the diff contains only additive stub additions for the new RPC/messages/fields (the `proto-freshness` CI gate enforces this).

**Verification**:
```bash
./scripts/buf-gen.sh
git status --porcelain packages/proto/gen/   # only additive stub changes for ExportEvents + user_id
# spot-check the additive fields exist in a stub (source of truth stays the .proto):
git diff --stat packages/proto/gen/
```

---

### Step 3 — migration: nullable `user_id` column + `(user_id, sequence)` index

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/migrations/003_events_user_id.up.sql` — create
- `services/xstockstrat-ledger/migrations/003_events_user_id.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, index correctness, hypertable partitioning; xstockstrat-ledger — append-only invariant preserved (additive column, no mutation path)

**Codebase Evidence**:
- Current migration tip confirmed via `ls services/xstockstrat-ledger/migrations/`: last numbered file is `002_idempotency_keys.up.sql`/`.down.sql` → **next NNN = 003** (C-07).
- `ledger.events` table defined `services/xstockstrat-ledger/migrations/001_ledger_events_hypertable.up.sql:11-23` (columns; PK `(event_id, recorded_at)` `:22`; `sequence BIGINT DEFAULT nextval('ledger.global_sequence')` `:21`). Hypertable partitioned by `recorded_at`, 1-day chunks (`:27-32`).
- Existing index precedent: `CREATE INDEX IF NOT EXISTS idx_events_sequence ON ledger.events (sequence)` (`001…up.sql:43-44`).
- **Immutability guard preserved (F-01):** `deny_mutation` triggers deny UPDATE/DELETE (`001…up.sql:46-60`) — this is additive DDL (`ADD COLUMN` / `CREATE INDEX`), never an UPDATE of existing rows, so historical rows keep `user_id = NULL` (design § Rejected Alternatives: backfill is impossible by construction, and unnecessary — `WHERE user_id = $caller` excludes NULL).

**TDD**: `N/A (migration — offline up/down inspection, not a unit test)`

**Covers**: —

**Instructions**:
- `003_events_user_id.up.sql`:
  ```sql
  ALTER TABLE ledger.events ADD COLUMN IF NOT EXISTS user_id TEXT;
  CREATE INDEX IF NOT EXISTS idx_events_user_sequence
      ON ledger.events (user_id, sequence);
  ```
  The `(user_id, sequence)` composite backs the per-user, global-sequence-ordered window scan (FR-10 + AC-1). Per design (§ Migration 003) the speculative `(event_type, occurred_at)` window index is **not** added — `event_type` is a post-filter on the already-bounded `user_id`+`sequence` set (behavior 2 / DRY).
- `003_events_user_id.down.sql`:
  ```sql
  DROP INDEX IF EXISTS ledger.idx_events_user_sequence;
  ALTER TABLE ledger.events DROP COLUMN IF EXISTS user_id;
  ```

**Verification** (offline — never bring up a DB):
```bash
ls services/xstockstrat-ledger/migrations/003_events_user_id.up.sql \
   services/xstockstrat-ledger/migrations/003_events_user_id.down.sql
# read both: every ADD COLUMN / CREATE INDEX in .up has an inverse DROP in .down
```

---

### Step 4 — service: stamp `user_id` on the ledger write path

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify

**Reviewers**: xstockstrat-ledger — append-only invariant (no delete/update), event ordering, hypertable partition safety

**Codebase Evidence**:
- `appendEvent(call, callback)` reads only `call.request` today (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:28-29`); there is **no** inbound-metadata read (the ledger registers the service with no gRPC interceptor, `services/xstockstrat-ledger/src/index.ts:64`).
- The insert column list + params are shared by both write paths at `ledgerServiceImpl.ts:35-54` (`insertSql` `:35-39`, `insertParams` `:40-54`) — `user_id` is absent from both.
- `rowToEvent(row)` (the DB-row → wire shape) at `ledgerServiceImpl.ts:304-317` does not map `user_id`.
- Metadata is available on the grpc-js call object as `call.metadata` (grpc-js `ServerUnaryCall`); header name constant convention is `x-user-id` (`services/xstockstrat-ui/src/lib/headers.ts:12`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- In `appendEvent`, resolve the owning user once, before the insert branches: `const userId = (req.userId && String(req.userId)) || (call.metadata?.get?.('x-user-id')?.[0] ?? null) || null;` — request field wins, then inbound `x-user-id` metadata, else `NULL` (design § User attribution, dual-channel).
- Add `user_id` as the final column in `insertSql` (`ledgerServiceImpl.ts:35-39`) and `userId` as the matching trailing value in `insertParams` (`:40-54`). Both the plain and idempotent paths reuse `insertSql`/`insertParams`, so a single edit covers both (`:59`, `:108`).
- Add `userId: row.user_id ?? ''` to `rowToEvent` (`ledgerServiceImpl.ts:304-317`) so `QueryEvents`/`GetEvent`/`StreamEvents`/`ExportEvents` all surface it (FR-7).
- Do not alter the immutability guarantees — this only writes `user_id` at insert time.

**Verification**: covered by Step 5's runnable command (lint + coverage). Behavioral check: a request with `userId` set persists it; a request with only `x-user-id` metadata persists the metadata value; neither → `NULL`.

---

### Step 5 — test: ledger write-path `user_id` stamping

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify

**Reviewers**: xstockstrat-ledger — append-only invariant, event ordering

**Codebase Evidence**:
- Existing unit suite uses a route-by-SQL mock pool with no real DB: `makePool`/`makeImpl` (`services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts:35-50`), `makeCall(req)` (`:52-54`), node:test `describe`/`it` (`:11-12`), lazy import guard (`:20-30`).
- Coverage command is `pnpm run test:coverage` → `c8 … --lines 40` (`services/xstockstrat-ledger/package.json:14`); lint `pnpm run lint` (`:15`).

**TDD**: `red-green required`

**Covers**: `AC-8, AC-11` (write-side foundation: the persisted `user_id` that the export later returns (AC-8) and filters on (AC-11); the read/filter side is Step 7)

**Instructions**:
- Extend the mock pool so `appendEvent`'s `INSERT … RETURNING sequence, recorded_at` also captures the params array, letting the test assert the `user_id` column value.
- Add three cases (written to fail against the pre-Step-4 tree — the current insert has no `user_id` param):
  1. `req.userId = 'u_42'`, no metadata → captured insert `user_id === 'u_42'`.
  2. `req.userId` empty, `call.metadata` carrying `x-user-id: u_99` → captured insert `user_id === 'u_99'` (metadata fallback).
  3. neither set → captured insert `user_id === null`.
- Add a `rowToEvent` case: a row with `user_id: 'u_7'` maps to `{ userId: 'u_7' }`.
- C-13 (non-frontend test data): the `u_42`/`u_99` ids are single-consumer inline literals in this one test file — compliant inline, no fixture home required (no second consumer).

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run lint && pnpm run test:coverage
# lines coverage stays >= 40%; the three new appendEvent cases + rowToEvent case pass
```

---

### Step 6 — service: `ExportEvents` server-streaming cursor read

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts` — modify
- `services/xstockstrat-ledger/package.json` — modify (add `pg-cursor` dependency)
- `pnpm-lock.yaml` — modify (lockfile for the new dep)

**Reviewers**: xstockstrat-ledger — append-only invariant, event ordering by global `sequence`, hypertable partition safety, DB connection budget (F-06)

**Codebase Evidence**:
- Server-streaming shape precedent: `streamEvents(call)` at `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:187-274` (`call.write(...)`, cleanup on `cancelled`/`close`/`error` `:241-243`). `serviceDefinition.ts` returns `LedgerServiceService` verbatim (`services/xstockstrat-ledger/src/grpc/serviceDefinition.ts:4-6`), so once the RPC exists in the regenerated stub, grpc-js dispatches a method named `exportEvents` on the impl — no manual wiring.
- **Dedicated-connection precedent (F-06):** `EventNotifier` builds a `pg` `Client` **outside** the query pool (`services/xstockstrat-ledger/src/index.ts:53-57`); the pool is `max = DB_POOL_MAX ?? 1` (`:40-49`) and the CLAUDE.md records that holding that single slot froze every `AppendEvent` (§ Live Streaming Architecture). The export must therefore open its own short-lived `pg.Client` (same SSL construction as `index.ts:26-49`) and **never** borrow `this.pool`.
- Config getters already injected into the impl (`constructor(pool, config, notifier)`, `ledgerServiceImpl.ts:9-17`): `this.config.getBool(key, def)` = `v?.boolVal ?? def` (`services/xstockstrat-ledger/src/services/configWatcher.ts:99-102`), `getInt(key, def)` = `v?.intVal ?? def` (`:89-92`) — `??` preserves a real `false`/`0` (design Open Risk 2).
- `queryEvents` orders by `recorded_at ASC` (`ledgerServiceImpl.ts:162`) — **not** reused: the export orders by global `sequence` (design § Rejected Alternatives; `LedgerEvent.sequence` global monotonic, `ledger.proto:29`).
- `pg-cursor` is **not** currently a ledger dependency (absent from `services/xstockstrat-ledger/package.json:20-34`) — **must be added**. `pg` `^8.11.5` is present (`:31`); `pg-cursor` is its companion server-side cursor reader (`Pool`/`Client.query(new Cursor(sql, params))` → `cursor.read(batchSize)`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- Add `"pg-cursor": "^2.x"` to `services/xstockstrat-ledger/package.json` dependencies and refresh `pnpm-lock.yaml` (`pnpm install` inside the service). `@types/pg-cursor` may be added under devDependencies if TS types are needed.
- Implement `async exportEvents(call)`:
  1. **Config gate (AC-10):** `if (!this.config.getBool('ledger.export.enabled', true)) { call.destroy({ code: 9, message: 'ledger export is disabled' }); return; }` — gRPC `FAILED_PRECONDITION` (code 9).
  2. **Window bound (AC-5):** compute the requested span from `call.request.start`/`end` (ts-proto `useDate` → JS `Date`, mirroring `queryEvents` at `:143-150`); `const maxDays = this.config.getInt('ledger.export.max_window_days', 365);` if `end - start > maxDays days`, `call.destroy({ code: 3, message: 'window exceeds ledger.export.max_window_days' })` — gRPC `INVALID_ARGUMENT` (code 3), exact message required by AC-5.
  3. **Caller scope (AC-11):** `const caller = call.metadata?.get?.('x-user-id')?.[0] ?? '';` (empty/absent caller → the `WHERE user_id = $caller` predicate matches nothing, since `NULL = ''` is never true — also excludes historical NULL rows, FR-10).
  4. Open a dedicated `pg.Client` (NOT `this.pool`), `await client.connect()`, then a `pg-cursor` over:
     `SELECT * FROM ledger.events WHERE user_id = $1 AND occurred_at BETWEEN $2 AND $3 [AND event_type = ANY($4)] ORDER BY sequence ASC` — `$4` = the split `event_type` list when non-empty (FR-3/AC-3/AC-4).
  5. Read the cursor in batches (e.g. `cursor.read(1000)`); for each batch emit one `ExportEventsResponse { events: rows.map(rowToEvent) }` via `call.write(...)` (batched per AC-7), until the batch is empty; then `call.end()`.
  6. Close the dedicated client on stream end, `cancelled`, `close`, and `error` (reuse the `streamEvents` cleanup pattern, `:235-243`) so no connection leaks and the F-06 direct-slot is released promptly.
- Header propagation (§B): `ExportEvents` makes **no new outbound gRPC call** (it reads the DB directly), so the propagation constraint does not apply; it only *reads* inbound `x-user-id` metadata (as Step 4 does).
- F-06 budget note: the ledger is a **direct** service; each concurrent export adds one real backend slot for its lifetime. Per design Open Risk 1, keep the query narrow and the client short-lived; a hard concurrency cap is out of scope for this feature (no config key defined) and, if ever needed, is a follow-up — record this in the Deviation Log if concurrency pressure is observed.

**Verification**: covered by Step 7's runnable command (lint + coverage).

---

### Step 7 — test: `ExportEvents` filtering, ordering, bounds, gating, isolation

**Status**: `pending`
**Service**: `xstockstrat-ledger`
**Files**:
- `services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts` — modify

**Reviewers**: xstockstrat-ledger — append-only invariant, event ordering by `sequence`, connection budget (F-06)

**Codebase Evidence**:
- Same node:test + route-by-SQL mock harness as Step 5 (`services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts:35-54`). A streaming `call` mock needs a `write`/`end`/`destroy`/`on` shape (model on how `streamEvents` uses `call.write`/`call.end`/`call.destroy`, `ledgerServiceImpl.ts:201-260`) plus a `metadata.get` stub.
- Config mock: pass an object exposing `getBool`/`getInt` returning the values under test (constructor accepts `config` as the 2nd arg, `ledgerServiceImpl.ts:10-16`; `makeImpl` already passes `{}` at `:47`).

**TDD**: `red-green required`

**Covers**: `AC-1, AC-3, AC-4, AC-5, AC-7, AC-8, AC-10, AC-11`

**Instructions**:
Write these cases (all fail against the pre-Step-6 tree — `exportEvents` does not exist yet):
- **AC-10:** `getBool('ledger.export.enabled') === false` → `call.destroy` called with `code: 9` (`FAILED_PRECONDITION`); no cursor/query opened.
- **AC-5:** `getInt('ledger.export.max_window_days') === 365` and a start/end spanning >365 days → `call.destroy` with `code: 3` and message exactly `window exceeds ledger.export.max_window_days`.
- **AC-11:** caller metadata `x-user-id: u_42`; assert the executed SQL includes `WHERE user_id = $1` (or `= ANY`) bound to `u_42` — a `u_99` row is never selected (mock returns only the `u_42` rows the predicate would match).
- **AC-1:** assert `ORDER BY sequence ASC` is in the executed SQL (not `recorded_at`); given rows out of insert order, emitted events are sequence-ascending.
- **AC-3:** `event_type = 'fill,signal'` → SQL carries the `event_type = ANY($n)` predicate with `['fill','signal']`; a `pnl_snapshot` row is excluded.
- **AC-4:** empty `event_type` → no `event_type` predicate; all five types pass through.
- **AC-7:** the read uses a `pg-cursor` batch loop against a **dedicated client**, not `this.pool` — assert `this.pool.query` is never called by `exportEvents` (spy on the pool), and that responses are emitted per batch (multiple `call.write` calls for a multi-batch fixture), proving no full-result-set buffering.
- **AC-8:** an emitted `ExportEventsResponse.events[0]` carries `eventId`/`eventType`/`occurredAt`/`sourceService`/`correlationId`/`sequence`/`streamKey`/`userId`/`payload` (via `rowToEvent`), with `userId === 'u_42'` and `payload` a JSON object.
- C-13: `u_42`/`u_99` remain single-file inline literals — compliant.

**Verification**:
```bash
cd services/xstockstrat-ledger && pnpm run lint && pnpm run test:coverage
# lines coverage stays >= 40%; all ExportEvents cases pass
```

---

### Step 8 — config: seed `ledger.export.*` keys (native type) + declare defaults

**Status**: `pending`
**Service**: `xstockstrat-config` (key seed) + `xstockstrat-ledger` (default declaration)
**Files**:
- `services/xstockstrat-config/migrations/022_ledger_export_keys.up.sql` — create
- `services/xstockstrat-config/migrations/022_ledger_export_keys.down.sql` — create
- `services/xstockstrat-ledger/CLAUDE.md` — modify (Config Keys Consumed table)

**Reviewers**: xstockstrat-config — config key naming (`<service>.<category>.<key>`), environment (`production`/`staging`) scoping, native `value_type` correctness; DBA — migration NNN numbering, up+down pair present

**Codebase Evidence**:
- Config-key seeds are config-service migrations into `config.config_values`. Current tip: `ls services/xstockstrat-config/migrations/` → last is `021_notify_push_min_severity` → **next NNN = 022** (C-07).
- Seed template + the native-type trap: `services/xstockstrat-config/migrations/021_notify_push_min_severity.up.sql` — columns `(namespace, key, value_type, value_data, description, default_value, consuming_service, environment, user_id)`, one row per environment (`staging`, `production`), `user_id NULL` (global), `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`; its own comment states "`value_type 'int' must match the reader getter (ConfigWatcher.getInt) or the value silently returns the default (migration-016 value_type trap)".
- The reader getters preserve native values via `??` (`services/xstockstrat-ledger/src/services/configWatcher.ts:89,99`) — so `value_type` **must** be `int`/`bool` (never `string`), the fail-open guardrail (design Open Risk 2; `fails.md` native-type entries).
- The `key` column carries the FULL dotted key the ledger reads (`getBool('ledger.export.enabled')` / `getInt('ledger.export.max_window_days')`), namespace `ledger` (matches the ledger's `new ConfigWatcher(configEndpoint, 'ledger')`, `services/xstockstrat-ledger/src/index.ts:21`).
- Ledger's existing declared keys live in `services/xstockstrat-ledger/CLAUDE.md` § Config Keys Consumed (namespace `ledger`) — the new keys are declared there per C-05.

**TDD**: `N/A (config seed migration — offline up/down inspection; the disable behavior is exercised by Step 7 AC-10)`

**Covers**: —

**Instructions**:
- `022_ledger_export_keys.up.sql` — insert two keys × two environments (`staging`, `production`), `user_id NULL`, `ON CONFLICT … DO NOTHING`:
  - `('ledger', 'ledger.export.max_window_days', 'int', '365', '<desc>', '365', 'xstockstrat-ledger', <env>, NULL)`
  - `('ledger', 'ledger.export.enabled', 'bool', 'true', '<desc>', 'true', 'xstockstrat-ledger', <env>, NULL)`
  Use `value_type` `int`/`bool` — **never** `string` (the fail-open trap).
- `022_ledger_export_keys.down.sql` — `DELETE FROM config.config_values WHERE namespace='ledger' AND key IN ('ledger.export.max_window_days','ledger.export.enabled');`
- Add both keys to `services/xstockstrat-ledger/CLAUDE.md` § Config Keys Consumed with their defaults (365 / true) and one-line descriptions (C-05: defaults declared in each service's CLAUDE.md).

**Verification** (offline — never bring up a DB):
```bash
ls services/xstockstrat-config/migrations/022_ledger_export_keys.up.sql \
   services/xstockstrat-config/migrations/022_ledger_export_keys.down.sql
grep -n "value_type" services/xstockstrat-config/migrations/022_ledger_export_keys.up.sql
# confirm 'int' and 'bool' (not 'string'); confirm the .down DELETE reverses both rows per env
grep -n "ledger.export" services/xstockstrat-ledger/CLAUDE.md   # both keys declared with defaults
```

---

### Step 9 — service: trading producer stamps owning `user_id`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading — order execution correctness, fill detection, ledger event emission

**Codebase Evidence**:
- `emitLedgerEvent(ctx, eventType, streamKey, payload)` at `services/xstockstrat-trading/internal/service/trading.go:3607-3620` builds `&ledgerv1.AppendEventRequest{ EventType, SourceService, StreamKey, Payload }` — it sets **no** `UserId` today (`:3611-3616`).
- Fills are emitted from the background fill poller on `context.Background()` (no inbound `x-user-id`): `order.filled` at `trading.go:1712-1717` and `order.partially_filled` at `:1728-1733`; both already have `order.UserId` in local scope (passed today only inside the payload map, `:1715`/`:1731`). This is exactly why pure server-side stamping would leave every fill `NULL` (design § User attribution (b); the recurring `fails.md` placeholder-user trap).
- The trading→ledger client already propagates `x-user-id` when the context carries it (`middleware.UnaryClientInterceptor`, trading dials the ledger at `trading.go:184-207`) — but background emits carry none, so the field must be passed explicitly (this step adds a request field, not a new outbound call → no new header-propagation wiring).
- `structpb.NewStruct` payload build at `trading.go:3608`; the Go stub `ledgerv1.AppendEventRequest` gains `UserId` from Step 2.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- Add a `userID string` parameter to `emitLedgerEvent` (new signature `emitLedgerEvent(ctx, eventType, streamKey, userID string, payload …)`), and set `UserId: userID` on the `AppendEventRequest` (`trading.go:3611-3616`).
- Update every `emitLedgerEvent` call site (survey via `grep -n "emitLedgerEvent(" services/xstockstrat-trading/internal/`): pass `order.UserId` for **user-owned** events (fills `:1712`/`:1728`, order lifecycle `order.created`/`submitted`/`canceled`/`replaced`/`rejected`/`broker_*`, and `account.*.synced`/`baseline_set` where the owning user is in scope), and `""` (→ ledger `NULL`) for genuinely platform-scoped emits with no single owner (e.g. `reconciliation.mismatch_found`, `order_intent.*`). Scope is **V1 producer = trading only** per design; other producers ride the metadata fallback or the named follow-up `021b`.
- Do not change event payloads or stream keys — only the new top-level `user_id` field.

**Verification**: covered by Step 10 (behavioral assertion + lint). Note: new logic sits in the CI-**excluded** `internal/service/` package (COVERPKGS excludes `service/`) — no coverage threshold applies; the paired test verifies behavior directly.

---

### Step 10 — test: trading fill emits carry `user_id`

**Status**: `pending`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_offline_test.go` — modify (or a sibling `*_test.go` in `internal/service/`)

**Reviewers**: xstockstrat-trading — order execution correctness, fill detection

**Codebase Evidence**:
- A capturing ledger fake already exists: `recordingLedger` (`services/xstockstrat-trading/internal/service/trading_offline_test.go:55-82`) embeds `ledgerv1.LedgerServiceClient`, records `requests []*ledgerv1.AppendEventRequest` (`:59`, `AppendEvent` at `:62-67`, `requestsByType` at `:79-82`); a second capturer `recordingLedgerClient` is in `trading_reconciliation_test.go:135-139`. Reuse one — do not add a third (C-13: no second inline copy of the same helper).
- `ledgerv1` import alias `github.com/xstockstrat/contracts/gen/go/ledger/v1` (`trading_offline_test.go:17`); `grpc.CallOption` variadic on the fake (`:62`).

**TDD**: `red-green required`

**Covers**: `AC-8, AC-11` (the fill's `AppendEventRequest.UserId` is the attribution the export later returns (AC-8) and isolates per-user (AC-11))

**Instructions**:
- Add a test that drives (or directly calls) the fill emit path with a `recordingLedger` and an order whose `UserId = "u_42"`, then asserts the captured `order.filled` (and `order.partially_filled`) `AppendEventRequest.UserId == "u_42"`. Written to fail against the pre-Step-9 tree, where `UserId` is unset (empty string).
- Reuse the existing `recordingLedger`/`requestsByType` helper; `u_42` is a single-file inline literal (C-13 compliant — one consumer).

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run UserId -race -count=1
# the new assertion passes; emitLedgerEvent threads order.UserId onto AppendEventRequest.UserId
```
(New logic is in the coverage-excluded `internal/service/` package — integration/behavioral verification is sufficient; a `test` step is still required per C-08.)

---

### Step 11 — service: `/trader` BFF export route (NDJSON/CSV streaming)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/api/ledger/export/route.ts` — create

**Reviewers**: xstockstrat-ui — BFF Connect-RPC call safety, session enforcement, header propagation, no secret values rendered

**Codebase Evidence**:
- Bespoke session-gated streaming `route.ts` precedent (NOT a Connect-router entry): `services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts` — `export async function GET(req)` → `getSessionFromRequest(req)` → 401 `NextResponse.json({error:'Unauthorized'},{status:401})` (`:19-23`). The export must be a raw route (a browser-savable byte stream), not a `router.service(...)` registration — design § Consumer surface.
- Server gRPC client: `ledgerClient` (`services/xstockstrat-ui/src/lib/connectClients.ts:40`, `createGrpcTransport` → connect-es server-streaming returns an async-iterable). After Step 2 it exposes `exportEvents(req, {headers})`.
- Session + header helpers: `getSessionFromRequest(req): Promise<JwtClaims|null>` (`services/xstockstrat-ui/src/lib/auth.ts:36`), `rolesToAccessScope(roles)` (`:98`), `generateTraceId()` (`:116`); header-name constants `HEADER_USER_ID`/`HEADER_ACCESS_SCOPE`/`HEADER_TRACE_ID` (`services/xstockstrat-ui/src/lib/headers.ts:12-14`). `JwtClaims` carries `user_id` (`auth.ts:5`) and `roles` (`:7`).
- **Discovered conflict — do not reuse `connectCodeToHttp` verbatim.** `connectCodeToHttp` (`services/xstockstrat-ui/src/lib/connectClients.ts:43-69`) maps `Code.FailedPrecondition` → **400** (`:45-47`) and `Code.PermissionDenied` → 403 (`:52-53`). But AC-10 requires the **disabled** path (ledger `FailedPrecondition`, Step 6) → HTTP **403**, and AC-5 requires the over-window path (ledger `InvalidArgument`) → HTTP **400**. The route must therefore map explicitly (`FailedPrecondition`→403, `InvalidArgument`→400, `Unauthenticated`→401, else 500) rather than delegate to `connectCodeToHttp`. Recorded in `context.md`.

**TDD**: `red-green required` (behavior proven by the Step 13 Playwright e2e — `xstockstrat-ui` has no unit coverage threshold; see § coverage table)

**Covers**: — (covered by Step 13)

**Instructions**:
- `export async function GET(req: NextRequest)`:
  1. `const claims = await getSessionFromRequest(req); if (!claims) return NextResponse.json({error:'Unauthorized'},{status:401});` — AC-6, and make **no** ledger call before this check.
  2. Parse `start`, `end`, `event_type`, `format` from `new URL(req.url).searchParams` (mirror `audit/route.ts:24-26`).
  3. Build backend Headers (C-03): `HEADER_USER_ID: claims.user_id`, `HEADER_ACCESS_SCOPE: String(rolesToAccessScope(claims.roles))`, `HEADER_TRACE_ID: req.headers.get(HEADER_TRACE_ID) ?? generateTraceId()` — the same three headers `backendHeaders` builds (`bffShared.ts:41-47`), replicated here because `backendHeaders` requires a Connect `HandlerContext` that a raw route has no access to.
  4. Call `ledgerClient.exportEvents({ start, end, eventType }, { headers })`; wrap the `for await (const resp of …)` in a `ReadableStream` so rows stream to the browser as they arrive (FR-6/AC-7 — never accumulate the full set).
  5. Serialize per `format`: default NDJSON — `Content-Type: application/x-ndjson`, one JSON object per `LedgerEvent` (fields per AC-8) + `\n`. `format=csv` — `Content-Type: text/csv`, first line the exact header `event_id,event_type,occurred_at,source_service,correlation_id,sequence,stream_key,user_id,payload` (AC-2), then one CSV row per event (`payload` JSON-stringified, CSV-escaped).
  6. On a thrown `ConnectError`, map `Code.FailedPrecondition`→403 (AC-10), `Code.InvalidArgument`→400 (AC-5, propagate the message `window exceeds ledger.export.max_window_days`), `Code.Unauthenticated`→401, else 500 — as a `NextResponse.json({error},{status})` (pre-stream); once bytes have started, terminate the stream.
- Header propagation (§B): this is a **new outbound gRPC call** (`ledgerClient.exportEvents`) — it forwards all three headers via the Headers built in (3); confirm in Verification.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "HEADER_USER_ID\|HEADER_ACCESS_SCOPE\|HEADER_TRACE_ID" src/app/trader/api/ledger/export/route.ts
# confirm all three propagation headers are forwarded on the exportEvents call
# behavioral coverage: Step 13 e2e (AC-1/2/3/4/5/6/10)
```

---

### Step 12 — service: "Export events" button on the `/trader` Book page

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — modify

**Reviewers**: xstockstrat-ui — trading UI correctness, C-17 (design tokens, `ui/*` primitives, accessible names)

**Codebase Evidence**:
- Host page = Book → Portfolio (design Decision (a) — "an existing `/trader` page (the Book / portfolio area)"): `services/xstockstrat-ui/src/app/trader/portfolio/page.tsx` — `'use client'` (`:1`), already imports the shadcn `Button` primitive (`:6`) and renders the combined-account Book view (`:18-30`). No new route → no `PLATFORM_SUBNAV`/`NAV_GROUPS` change (C-10(a) sidestepped).
- Browser download must go through `fetch` (not a bare `<a href>` GET) so the session-cookie'd refresh interceptor applies (design Decision (a)); the route is same-origin `/trader/api/ledger/export`.

**TDD**: `red-green required` (proven by Step 13 e2e)

**Covers**: — (covered by Step 13)

**Instructions**:
- Add an "Export events" `Button` (reuse the imported `ui/button` primitive; give it an accessible name, C-17) to the Book/Portfolio header area.
- On click, default to **last 90 days, all event types** (AC-9): `start = today − 90 days`, `end = today`, no `event_type` param → `GET /trader/api/ledger/export?start=<ISO>&end=<ISO>`.
- Fetch → `res.blob()` → `URL.createObjectURL(blob)` → a transient `<a download="ledger-events.ndjson">` click → revoke the object URL. This presents the browser's file-save dialog (AC-9).
- Use design-role tokens only; route any disabled/error state through the existing `CardNotice`/`EmptyState` primitives already imported in this segment (C-17), never hand-rolled color.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
# behavioral coverage: Step 13 e2e (AC-9)
```

---

### Step 13 — test: `/trader` export e2e (Playwright)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/trader/ledger-export.spec.ts` — create
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add a `LedgerService.exportEvents` streaming handler)
- `services/xstockstrat-ui/e2e/fixtures/ledgerEvents.ts` — create (new fixture)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog the new fixture)

**Reviewers**: xstockstrat-ui — BFF Connect-RPC call safety, session enforcement, test-data inventory (C-12)

**Codebase Evidence**:
- E2E suite lives in `services/xstockstrat-ui/e2e/trader/` (existing specs e.g. `orders.spec.ts`, `portfolio.spec.ts`, `position-detail.spec.ts`); auth helpers `addAuthCookie`/`signTestJwt` in `e2e/helpers/auth.ts` (catalogued in `e2e/fixtures/INVENTORY.md` "Test JWT signing / auth cookies" row) — new specs must reuse these, never re-implement JWT signing (C-12).
- **No ledger-events fixture exists** — `e2e/fixtures/INVENTORY.md` has no "ledger events" row → **not found: new fixture required** (`e2e/fixtures/ledgerEvents.ts` + a catalog row), shape from `xstockstrat.ledger.v1.LedgerEvent` (Connect-JSON camelCase).
- The mock gRPC backend (`e2e/mock-backend.ts`, per this service's CLAUDE.md § Testing) serves the BFF's backend calls; it currently has no `exportEvents` handler → **must add** a server-streaming stub.

**TDD**: `red-green required` (e2e written to fail before Steps 11/12 exist)

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-9, AC-10`

**Instructions**:
- Create `e2e/fixtures/ledgerEvents.ts`: a small ordered set of `LedgerEvent` rows across the five `event_type` values with distinct `sequence` and a `user_id` (reuse `TEST_USER_ID` from `e2e/fixtures/users.ts`); add its catalog row to `INVENTORY.md` (C-12).
- Add a `LedgerService.exportEvents` handler to `e2e/mock-backend.ts` that streams the fixture rows honoring `start`/`end`/`event_type`, throws `FailedPrecondition` when a per-test flag simulates `ledger.export.enabled=false`, and throws `InvalidArgument("window exceeds ledger.export.max_window_days")` for an over-wide window.
- Spec cases:
  - **AC-1:** authed `GET …/api/ledger/export?start&end` → 200, `content-type: application/x-ndjson`, N newline-delimited JSON objects in ascending `sequence` order.
  - **AC-2:** `&format=csv` → 200, `text/csv`, first line the exact header, one data row per event.
  - **AC-3/AC-4:** `event_type=fill,signal` restricts types; omitting it returns all five.
  - **AC-5:** over-wide window → 400, body message `window exceeds ledger.export.max_window_days`.
  - **AC-6:** no auth cookie → 401 (or login redirect), and the mock `exportEvents` handler is never invoked.
  - **AC-9:** on the `/trader` Book page, click "Export events" with defaults → request carries the last-90-days window and no `event_type`; assert the download (`page.waitForEvent('download')`) presents a save.
  - **AC-10:** disabled flag → 403, no events streamed.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e e2e/trader/ledger-export.spec.ts
grep -n "from '../fixtures'\|helpers/auth" e2e/trader/ledger-export.spec.ts   # reuses inventory + auth helpers (C-12)
# INVENTORY.md updated with the new ledgerEvents fixture row
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
