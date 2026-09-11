# xstockstrat-ledger — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549` — feature 021 added per-user `ExportEvents` + the
`events.user_id` column; added LEDGER-5/6/7, re-grounded LEDGER-1..3); refreshed 2026-09-03 (branch
`claude/watchlist-bulk-default-strategy-zxx6su` @ `d4cd327` — LEDGER-3 cross-module consumer count
re-grounded 3 → 5 as portfolio added subscriptions). Captures the **non-obvious** local
invariants of the ledger service (append-only event store over TimescaleDB, gRPC 50057). Does not
restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-ledger**.

## Rules (`LEDGER-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **LEDGER-1** | **The idempotent-append dedup lookup MUST reuse the transaction's own `client`, never `this.pool.query`.** After `ROLLBACK` it re-queries on the same connection. | The query pool is `DB_POOL_MAX=1`; borrowing a 2nd pooled connection while the txn holds the only one **self-deadlocks** — a hang under load that only reproduces at max=1. | `src/grpc/ledgerServiceImpl.ts:74-118` (comment `:103-105`) | `src/grpc/ledgerServiceImpl.ts:74-118` |
| **LEDGER-2** | **`StreamEvents` orders subscribe → replay → buffer-flush → go-live** (subscribe to the notifier *before* the history query, buffer live rows while `live=false`, flush deduped-by-sequence, flip `live=true` in one synchronous block). | Replay-first-then-subscribe (the obvious order) silently loses any event inserted during the replay window. | `src/grpc/ledgerServiceImpl.ts:182-260` (comment `:286-291`) | `src/grpc/ledgerServiceImpl.ts:182-260` |
| **LEDGER-3** | **`StreamEvents` clients must resume from their last-processed `sequence` on reconnect** (mechanism: `CLAUDE.md` § Live Streaming Architecture). | A consumer that treats a stream end as terminal (stops) rather than reconnecting-and-replaying the gap loses events. Consumer: xstockstrat-portfolio's **5** permanent subs (`portfolio_service.go:145` order.filled, `:892` account.positions.synced, `:905` account.deregistered, `:1009` order.bracket_updated, `:1061` account.balance.synced). | producer `src/services/eventNotifier.ts:89-98`; consumer `ledgerServiceImpl.ts:241-250` | `src/services/eventNotifier.ts:89-98` |
| **LEDGER-4** | **`appendEvent` must NOT set an explicit `sequence` — rely on the column DEFAULT `nextval('ledger.global_sequence')`.** | The old code used a per-stream `event_seq_<md5>` sequence that no migration creates → every write to a fresh stream failed `relation "…" does not exist`. Sequence is globally monotonic. Confirmed `ledgerServiceImpl.ts:54-58` (10 insert columns, no `sequence`). | `migrations/001_ledger_events_hypertable.up.sql:21`; PR #639 | `src/grpc/ledgerServiceImpl.ts:41-45` |
| **LEDGER-5** | **A long/streaming read MUST NOT hold the `DB_POOL_MAX=1` query pool for its duration** — `ExportEvents` opens a *dedicated* short-lived `pg.Client` (reusing `pool.options.connectionString`/`ssl`) + `pg-cursor`, never `this.pool.query`; `StreamEvents` replay borrows-and-releases. | Reaching for `this.pool.query` on a new bulk/long read holds the single slot for the whole scan and freezes every `AppendEvent` to `DeadlineExceeded` — the exact scar that produced `pool=1`. Extends the single-listener/query-pool separation contract to reads. | `streamExportRows` `src/grpc/ledgerServiceImpl.ts:333-352` (motivation `:318-320`); pool cfg `src/index.ts:39-45` | `src/grpc/ledgerServiceImpl.ts:333-352` |
| **LEDGER-6** | **`ExportEvents` caller scope = the `x-user-id` metadata → `WHERE user_id = $1`; an empty caller matches ZERO rows (never all), and historical `user_id IS NULL` rows are unreachable by design.** | Treating an empty caller as unscoped, or adding `OR user_id IS NULL` to "include legacy rows," is a cross-user data leak (FR-10). The NULL-never-equals-`''` semantics are load-bearing, not incidental. | caller `src/grpc/ledgerServiceImpl.ts:301-302` (`?? ''`), predicate `:352` | `src/grpc/ledgerServiceImpl.ts:301-311` |
| **LEDGER-7** | **`appendEvent` resolves the owning `user_id` dual-channel: `req.userId` wins, else the inbound `x-user-id` metadata, else NULL.** Background producers carry no metadata, so they must set the field explicitly; request-scoped callers ride the header. | A new producer that assumes user_id flows only from metadata (drops it in background jobs) or only from the field (drops it for request-scoped calls) writes un-exportable events (silently NULL, invisible to that user's `ExportEvents`). | `src/grpc/ledgerServiceImpl.ts:38-39` | `src/grpc/ledgerServiceImpl.ts:38-39` |

## Gotchas & scars

- **The live NOTIFY fan-out delivers a *trimmed* row when the payload exceeds ~7000 chars** (`event_id,event_type,stream_key,sequence,recorded_at` only), which `rowToEvent` turns into a stub with `payload=undefined` and `occurredAt=new Date(undefined)` → Invalid Date. The same event via replay/query is fine. Recorded as a latent bug in findings; noted here so an agent knows the live-stream row can be partial. Evidence: `migrations/001_…up.sql:71-80`, `rowToEvent occurredAt: new Date(row.occurred_at)` `ledgerServiceImpl.ts:418`.
- **Immutability is enforced by `deny_mutation` triggers, NOT PostgreSQL rules** (rules aren't supported on hypertables) — the CLAUDE.md wording "PostgreSQL rules" is wrong (findings). Evidence: `migrations/001_…up.sql:47-60`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Split pool: query pool max=1 + dedicated `EventNotifier` LISTEN conn = 2 total | `CLAUDE.md:37-53`, `src/index.ts:39-50`; root pool budget |
| Idempotent append via `ledger.idempotency_keys` regular table + one-txn claim | `CLAUDE.md:70-90`, `migrations/002_…up.sql:1-13` |
| `toValidDate` guard against persisting a NaN timestamp | `src/grpc/ledgerServiceImpl.ts:265-268` (root PLAT-F2) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
