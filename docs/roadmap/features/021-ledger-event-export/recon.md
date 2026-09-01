# Recon: ledger-event-export

**Created**: 2026-08-31
**From**: product-spec.md
**Affected services**: `xstockstrat-ledger` (Node/TS), `xstockstrat-ui` (BFF), `packages/proto`

---

## Objective

Add a per-user, streaming export of ledger events for a date range + optional `event_type` filter,
downloadable as NDJSON (default) or CSV from `xstockstrat-ui`. Backed by a new additive
server-streaming gRPC RPC `ExportEvents` on `xstockstrat-ledger`, plus an additive `user_id` on the
event contract + a nullable `user_id` column/index on the events hypertable so events can be
attributed to and filtered by the owning user (FR-7/FR-10).

## Codebase Map

- **`xstockstrat-ledger`** (Node.js 24 + TS, gRPC-only 50057)
  - Entry point / server: `src/index.ts` — builds `Pool` (`:40`, `max = DB_POOL_MAX ?? '1'` `:47`),
    a dedicated LISTEN `Client` **outside** the pool (`EventNotifier`, `:56`), and registers the
    service with **no gRPC interceptor** (`grpcServer.addService(...)`, `:64`).
  - Servicer: `src/grpc/ledgerServiceImpl.ts` — `appendEvent` `:28-119`, `queryEvents` `:124-176`,
    `streamEvents` `:187-274`, `getEvent` `:276-290`; `rowToEvent` `:304-317`.
  - **`appendEvent` captures NO user context today** — it reads only `call.request`
    (`:29`, columns list `:35-54`); there is no `user_id` request field, column, or metadata read.
  - `queryEvents` orders by **`recorded_at ASC`** (`:162`); `streamEvents` replay orders by
    **`sequence ASC`** (`:252`). The DB-cursor-friendly ordering already exists on the stream path.
  - Config reads: `src/services/configWatcher.ts` — `getInt(key,def)` = `v?.intVal ?? def` (`:89`),
    `getBool(key,def)` = `v?.boolVal ?? def` (`:99`). `??` (not `||`) preserves a real `0`/`false`.
  - Last migration: `migrations/002_idempotency_keys.up.sql` → **next NNN = `003`**.
  - Events hypertable: `migrations/001_ledger_events_hypertable.up.sql` — table `:11-23`
    (PK `(event_id, recorded_at)` `:22`; `sequence BIGINT DEFAULT nextval('ledger.global_sequence')`
    `:21`), indexes `idx_events_type (event_type, recorded_at DESC)` `:37-38` and
    `idx_events_sequence (sequence)` `:43-44`, **`deny_mutation` triggers deny UPDATE/DELETE**
    `:46-60`, NOTIFY trigger `:62-89`.
- **`xstockstrat-ui`** (Next.js BFF)
  - `/trader` BFF registers `LedgerService` (`src/lib/traderBff.ts` `router.service(LedgerService,…)`
    `:112`, `queryEvents` `:117`, `appendEvent` `:129`); dispatch prefix `/trader/api` `:154`.
    **`/insights` BFF registers no ledger service** (`src/lib/insightsBff.ts`).
  - Server gRPC clients: `src/lib/connectClients.ts` — `ledgerClient` (`createGrpcTransport`) `:40`
    (connect-node gRPC transport supports server-streaming as an async-iterable).
  - Reference bespoke route.ts (session-gated, DB-reading, `GET`): `src/app/config-ui/api/audit/route.ts`
    (`getSessionFromRequest` → 401 `:20-23`).
  - BFF plumbing: `src/lib/bffShared.ts` (`requireSession`, `backendHeaders`); header names
    `src/lib/headers.ts`; auth `src/lib/auth.ts`; middleware injects `x-user-id`/`x-access-scope`/`x-trace-id`.
- **`packages/proto`** — `ledger/v1/ledger.proto`: `LedgerService` RPCs `:13-18`; `LedgerEvent`
  `:20-31` (max field **10** = `stream_key`; `sequence` = "GLOBAL monotonic" `:29`);
  `AppendEventRequest` `:33-46` (max field **8** = `idempotency_key`).

## Patterns to REUSE

- Per-user scoped BFF read → reuse the `traderBff.ts` `LedgerService.queryEvents` shape
  (`requireSession` + `backendHeaders(claims, ctx)`, `traderBff.ts:117-126`) — but the export is a
  **plain `route.ts` GET streaming handler** (not a Connect-router registration), so it follows
  `config-ui/api/audit/route.ts` for session gating + streaming `Response`, calling `ledgerClient`
  from `connectClients.ts:40`.
- A DB connection held for the export's lifetime → reuse the **`EventNotifier` precedent**: a
  dedicated `pg` `Client` created **outside** the write pool (`index.ts:56`), so the export never
  borrows the single write-pool slot.
- Config reads → reuse `ConfigWatcher.getInt`/`getBool` (`configWatcher.ts:89,99`) as-is; they cast
  from the native oneof arm and preserve `0`/`false`.
- Header propagation into `AppendEvent` → the Go producers already dial the ledger with
  `middleware.UnaryClientInterceptor` (`trading.go:184`), which injects `x-user-id` from context
  when present (`internal/middleware/propagation.go:37-43`).

## Existing Business Rules (preserve / extend)

- **No existing acceptance suite for `xstockstrat-ledger` yet** (`services/xstockstrat-ledger/acceptance/`
  is absent) and `docs/sdd/business-rules/platform.feature` has **no** ledger/export guarantees.
  This feature is net-new ledger behavior; its `@AC-*` scenarios become the first ledger durable
  suite promoted at launch (C-16).
- **PRESERVE — append-only immutability (ledger CLAUDE.md Invariant #1;
  `migrations/001…up.sql:46-60`):** the export is read-only; it must not add any UPDATE/DELETE path,
  and (decisive) it makes a `user_id` **backfill of historical rows impossible by construction** —
  the `deny_mutation` trigger blocks UPDATE on `ledger.events`.
- **PRESERVE — global-sequence ordering (Invariant #4; `sequence` = global monotonic,
  `ledger.proto:29`):** the export orders by global `sequence`, not `recorded_at`.

## Dependencies

- **Proto/RPC:** additive to `ledger/v1/ledger.proto` — new RPC `ExportEvents(ExportEventsRequest)
  returns (stream ExportEventsResponse)`; new messages; `LedgerEvent.user_id = 11`;
  `AppendEventRequest.user_id = 9` (next free numbers after current max 10 / 8). All additive →
  `buf breaking` passes.
- **Migration:** next `003_*` on `services/xstockstrat-ledger/migrations/` — nullable `user_id TEXT`
  column + a per-user window index (`(user_id, sequence)`). `(event_type, occurred_at)` window scan:
  today only `(event_type, recorded_at DESC)` exists (`001…:37-38`) — no `occurred_at` index.
- **Config keys (new):** `ledger.export.max_window_days` (int, default 365),
  `ledger.export.enabled` (bool, default true). Read via `ConfigWatcher` (namespace `ledger`).
- **Inter-service edges:** browser → `xstockstrat-ui` BFF (`/…/api/ledger/export`) → `ledgerClient`
  → `xstockstrat-ledger.ExportEvents` (gRPC 50057). Producers (trading/portfolio/marketdata/
  ingest/analysis) → `ledger.AppendEvent` (unchanged edge; attribution rides existing `x-user-id`).
- **New deps / infra:** a row-streaming reader for Node `pg` (e.g. `pg-cursor`/`pg-query-stream`) —
  `Pool.query` materializes the full result set and cannot satisfy AC-7 (1M rows unbuffered). New
  dependency on the ledger service. No new env var/port.

## Risks / Not-found

- **DB-connection budget vs. the documented write-starvation scar (F-06).** The ledger write pool is
  `DB_POOL_MAX=1` and its own CLAUDE.md records that holding that slot froze every `AppendEvent`
  until deadline. A cursor export that borrows the write pool re-creates that freeze. Must use a
  **dedicated connection outside the write pool** (EventNotifier precedent) and re-check the pool
  budget table (F-06) — the ledger is a **direct** service, so each concurrent export adds a real
  backend slot. Concurrency bound is a `/sdd-spec` decision (no config key defined for it).
- **`AppendEvent` reads no inbound metadata today.** The ledger has **no gRPC server interceptor**
  (`index.ts:64`); `src/middleware/propagation.ts` is the removed-HTTP-path helper and is unused. To
  stamp `user_id` from `x-user-id`, this feature must add a server-side metadata read in the handler
  (or an interceptor) — it does not exist to reuse.
- **Background-emitted events are unattributed by pure server-side stamping.** `order.filled` and
  `account.*.synced` are emitted by trading's pollers via `emitLedgerEvent(ctx,…)` (`trading.go:3607-3620`)
  on a background ctx that carries **no** `x-user-id` — so the headline "my best trades" (fills)
  would land `user_id=NULL` unless the producer passes the owning user explicitly. See design (b).
- **Config native-type / fail-open trap** (`fails.md` 2026-08-16 signal-time-decay `:1230`;
  2026-08-06 kill-switch `:341`). `getBool`/`getInt` are safe **iff** the two keys are seeded under
  the native oneof arm (`boolVal`/`intVal`); a `stringVal:"false"` seed makes `getBool` return the
  default `true` (fail-open disable). Guardrail lives at the **seed**, not the getter.
- **Historical NULL-`user_id` rows** cannot be backfilled (immutability trigger) — a design decision,
  resolved in design (c): excluded from per-user export.

## Recommended Scope

1. Proto: `ExportEvents` RPC + `ExportEventsRequest`/`ExportEventsResponse` + `user_id` on
   `LedgerEvent`/`AppendEventRequest`; `buf-gen`.
2. Migration `003`: nullable `user_id` + `(user_id, sequence)` index (+ the `(event_type, occurred_at)`
   window index if kept).
3. Ledger write path: read `x-user-id` metadata + `req.user_id`; stamp `user_id` column.
4. Trading producer: thread the owning `user_id` into `emitLedgerEvent` for user-owned events
   (fills/lifecycle/account-sync) — the one producer whose background emits would otherwise be NULL.
5. Ledger `ExportEvents`: config gate + window bound, dedicated-connection cursor stream ordered by
   `sequence`, `WHERE user_id = $caller`.
6. UI: `/trader` BFF `route.ts` GET (NDJSON/CSV serialization) + a download button on an existing
   `/trader` page.
