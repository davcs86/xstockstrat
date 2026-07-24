# xstockstrat-ledger — Constitution

Derived by `/context-constitution` (context-forge) on 2026-07-24. Captures the **non-obvious** local
invariants of the ledger service (append-only event store over TimescaleDB, gRPC 50057). Does not
restate documented/CI-enforced rules (see `## Pointers`).

> Inherits all rules of the root constitution (`../../../docs/context-constitution.md`). This file lists only
> what is specific to **xstockstrat-ledger**.

## Rules (`LEDGER-*`) — binding, easy-to-miss conventions

| ID | Rule | Why | Evidence | Example (canonical `path:line`) |
|---|---|---|---|---|
| **LEDGER-1** | **The idempotent-append dedup lookup MUST reuse the transaction's own `client`, never `this.pool.query`.** After `ROLLBACK` it re-queries on the same connection. | The query pool is `DB_POOL_MAX=1`; borrowing a 2nd pooled connection while the txn holds the only one **self-deadlocks** — a hang under load that only reproduces at max=1. | `src/grpc/ledgerServiceImpl.ts:71-93` (comment `:83-85`) | `src/grpc/ledgerServiceImpl.ts:71-93` |
| **LEDGER-2** | **`StreamEvents` orders subscribe → replay → buffer-flush → go-live** (subscribe to the notifier *before* the history query, buffer live rows while `live=false`, flush deduped-by-sequence, flip `live=true` in one synchronous block). | Replay-first-then-subscribe (the obvious order) silently loses any event inserted during the replay window. | `src/grpc/ledgerServiceImpl.ts:208-273` (comment `:266-268`) | `src/grpc/ledgerServiceImpl.ts:208-273` |
| **LEDGER-3** | **`StreamEvents` clients must resume from their last-processed `sequence`; on listener reconnect the server `call.end()`s instead of backfilling.** | A consumer that treats a stream end as terminal (stops) rather than reconnecting-and-replaying the gap loses events. Consumer: xstockstrat-portfolio's 3 permanent subs. | producer `src/services/eventNotifier.ts:103-113`; `ledgerServiceImpl.ts:221-230` | `src/services/eventNotifier.ts:103-113` |
| **LEDGER-4** | **`appendEvent` must NOT set an explicit `sequence` — rely on the column DEFAULT `nextval('ledger.global_sequence')`.** | The old code used a per-stream `event_seq_<md5>` sequence that no migration creates → every write to a fresh stream failed `relation "…" does not exist`. Sequence is globally monotonic. | `migrations/001_ledger_events_hypertable.up.sql`; PR #639 | (see PR #639) |

## Gotchas & scars

- **The live NOTIFY fan-out delivers a *trimmed* row when the payload exceeds ~7000 chars** (`event_id,event_type,stream_key,sequence,recorded_at` only), which `rowToEvent` turns into a stub with `payload=undefined` and `occurredAt=new Date(undefined)` → Invalid Date. The same event via replay/query is fine. Recorded as a latent bug in findings; noted here so an agent knows the live-stream row can be partial. Evidence: `migrations/001_…up.sql:71-80`, `ledgerServiceImpl.ts:201,304-316`.
- **Immutability is enforced by `deny_mutation` triggers, NOT PostgreSQL rules** (rules aren't supported on hypertables) — the CLAUDE.md wording "PostgreSQL rules" is wrong (findings). Evidence: `migrations/001_…up.sql:47-60`.

## Pointers (already documented or CI-enforced — not restated here)

| What | Where |
|---|---|
| Split pool: query pool max=1 + dedicated `EventNotifier` LISTEN conn = 2 total | `CLAUDE.md:33-49`, `src/index.ts:40-56`; root pool budget |
| Idempotent append via `ledger.idempotency_keys` regular table + one-txn claim | `CLAUDE.md:70-90`, `migrations/002_…up.sql:1-13` |
| `toValidDate` guard against persisting a NaN timestamp | `src/grpc/ledgerServiceImpl.ts:299-302` (root PLAT-F2) |

---
_Forged by [context-forge](https://github.com/davcs86/agent-plugins). It captures the
non-obvious — nothing here is invented; re-run `/context-constitution` to refresh after the code changes._
