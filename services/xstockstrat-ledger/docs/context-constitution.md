# xstockstrat-ledger — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549` — feature 021 added per-user `ExportEvents` + the
`events.user_id` column; added LEDGER-5/6/7, re-grounded LEDGER-1..3); refreshed 2026-09-03 (branch
`claude/watchlist-bulk-default-strategy-zxx6su` @ `d4cd327` — LEDGER-3 cross-module consumer count
re-grounded 3 → 5 as portfolio added subscriptions); refreshed 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9` — LEDGER-3 consumer citations re-anchored by symbol and the analysis P&L consumer added; all other anchors re-verified resolving); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — line hints re-stamped; legacy bare `:NN` citations re-grounded to `#anchor (~Lnn)`; all anchors re-verified). Captures the **non-obvious** local
invariants of the ledger service (append-only event store over TimescaleDB, gRPC 50057). Does not
restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-ledger**.

## Rules (`LEDGER-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **LEDGER-1** | **The idempotent-append dedup lookup MUST reuse the transaction's own `client`, never `this.pool.query`.** After `ROLLBACK` it re-queries on the same connection. | The query pool is `DB_POOL_MAX=1`; borrowing a 2nd pooled connection while the txn holds the only one **self-deadlocks** — a hang under load that only reproduces at max=1. | `src/grpc/ledgerServiceImpl.ts#appendEvent` idempotent path (~L73-118; comment ~L85) | `src/grpc/ledgerServiceImpl.ts#appendEvent (~L73-118)` |
| **LEDGER-2** | **`StreamEvents` orders subscribe → replay → buffer-flush → go-live** (subscribe to the notifier *before* the history query, buffer live rows while `live=false`, flush deduped-by-sequence, flip `live=true` in one synchronous block). | Replay-first-then-subscribe (the obvious order) silently loses any event inserted during the replay window. | `src/grpc/ledgerServiceImpl.ts#streamEvents (~L182-260)` (comment "Subscribe BEFORE replaying" ~L200-201) | `src/grpc/ledgerServiceImpl.ts#streamEvents (~L182-260)` |
| **LEDGER-3** | **`StreamEvents` clients must resume from their last-processed `sequence` on reconnect** (mechanism: `CLAUDE.md` § Live Streaming Architecture). | A consumer that treats a stream end as terminal (stops) rather than reconnecting-and-replaying the gap loses events. Consumers: xstockstrat-portfolio's **5** permanent subs, all through one resume helper (`services/xstockstrat-portfolio/internal/service/portfolio_service.go#consumeEventStream` → `streamEventsFrom`, `fromSeq = lastSeq+1`) wrapped by `ConsumeOrderFills` (order.filled), `ConsumePositionSyncs` (account.positions.synced), the account-deregistration consumer, `ConsumeBracketUpdates` (order.bracket_updated) and `ConsumeBalanceSyncs` (account.balance.synced); and xstockstrat-analysis's single unfiltered stream (`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py#PnLPatternConsumer.run_forever`), which resumes from a DB cursor (`analysis.ledger_stream_cursor`) and drops any `sequence <= cursor` in `process_event`. | producer `src/services/eventNotifier.ts#onReconnect (~L89-97)`; consumer `ledgerServiceImpl.ts#streamEvents` `onReconnect` → `call.end()` (~L212-219) | `src/services/eventNotifier.ts#onReconnect (~L89-97)` |
| **LEDGER-4** | **`appendEvent` must NOT set an explicit `sequence` — rely on the column DEFAULT `nextval('ledger.global_sequence')`.** | The old code used a per-stream `event_seq_<md5>` sequence that no migration creates → every write to a fresh stream failed `relation "…" does not exist`. Sequence is globally monotonic. Confirmed `ledgerServiceImpl.ts#insertSql` (~L41-45, 10 insert columns, no `sequence`). | `migrations/001_ledger_events_hypertable.up.sql#global_sequence (~L21)`; PR #639 | `src/grpc/ledgerServiceImpl.ts#insertSql (~L41-52)` |
| **LEDGER-5** | **A long/streaming read MUST NOT hold the `DB_POOL_MAX=1` query pool for its duration** — `ExportEvents` opens a *dedicated* short-lived `pg.Client` (reusing `pool.options.connectionString`/`ssl`) + `pg-cursor`, never `this.pool.query`; `StreamEvents` replay borrows-and-releases. | Reaching for `this.pool.query` on a new bulk/long read holds the single slot for the whole scan and freezes every `AppendEvent` to `DeadlineExceeded` — the exact scar that produced `pool=1`. Extends the single-listener/query-pool separation contract to reads. | `src/grpc/ledgerServiceImpl.ts#streamExportRows (~L333-352)` (motivation: `exportEvents` docblock ~L278-280); pool cfg `src/index.ts#new Pool (~L40-46)` | `src/grpc/ledgerServiceImpl.ts#streamExportRows (~L333-352)` |
| **LEDGER-6** | **`ExportEvents` caller scope = the `x-user-id` metadata → `WHERE user_id = $1`; an empty caller matches ZERO rows (never all), and historical `user_id IS NULL` rows are unreachable by design.** | Treating an empty caller as unscoped, or adding `OR user_id IS NULL` to "include legacy rows," is a cross-user data leak (FR-10). The NULL-never-equals-`''` semantics are load-bearing, not incidental. | caller `src/grpc/ledgerServiceImpl.ts#exportEvents` (`?? ''`, ~L301-302), predicate `WHERE user_id = $1` (~L311) | `src/grpc/ledgerServiceImpl.ts#exportEvents (~L301-311)` |
| **LEDGER-7** | **`appendEvent` resolves the owning `user_id` dual-channel: `req.userId` wins, else the inbound `x-user-id` metadata, else NULL.** Background producers carry no metadata, so they must set the field explicitly; request-scoped callers ride the header. | A new producer that assumes user_id flows only from metadata (drops it in background jobs) or only from the field (drops it for request-scoped calls) writes un-exportable events (silently NULL, invisible to that user's `ExportEvents`). | `src/grpc/ledgerServiceImpl.ts#appendEvent` owner precedence (~L38-39) | `src/grpc/ledgerServiceImpl.ts#appendEvent (~L38-39)` |

## Gotchas & scars

- **The live NOTIFY fan-out delivers a *trimmed* row when the payload exceeds ~7000 chars** (`event_id,event_type,stream_key,sequence,recorded_at` only), which `rowToEvent` turns into a stub with `payload=undefined` and `occurredAt=new Date(undefined)` → Invalid Date. The same event via replay/query is fine. Recorded as a latent bug in findings; noted here so an agent knows the live-stream row can be partial. Evidence: `migrations/001_…up.sql#notify_event_inserted` trim branch (~L71-80), `ledgerServiceImpl.ts#rowToEvent` `payload` (~L371) / `occurredAt: new Date(row.occurred_at)` (~L373).
- **Immutability is enforced by `deny_mutation` triggers, NOT PostgreSQL rules** (rules aren't supported on hypertables) — the CLAUDE.md wording "PostgreSQL rules" is wrong (findings). Evidence: `migrations/001_…up.sql#deny_mutation (~L47-60)`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Split pool: query pool max=1 + dedicated `EventNotifier` LISTEN conn = 2 total | `CLAUDE.md#Live Streaming Architecture (~L37-53)`, `src/index.ts#new Pool`/`EventNotifier` (~L40-53); root pool budget |
| Idempotent append via `ledger.idempotency_keys` regular table + one-txn claim | `CLAUDE.md#Idempotent Append (~L74-86)`, `migrations/002_…up.sql#idempotency_keys (~L9-13)` |
| `toValidDate` guard against persisting a NaN timestamp | `src/grpc/ledgerServiceImpl.ts#toValidDate (~L359-362)` (root PLAT-F2) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
