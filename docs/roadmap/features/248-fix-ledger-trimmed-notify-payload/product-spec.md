# Product Spec: fix-ledger-trimmed-notify-payload

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-ledger-stream-trimmed-notify-payload-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `ledger.notify_event_inserted` replaces the NOTIFY body with five fields (`event_id, event_type,
stream_key, sequence, recorded_at`) when `row_to_json(NEW)` exceeds 7000 chars
(`services/xstockstrat-ledger/migrations/001_ledger_events_hypertable.up.sql:72`). `EventNotifier.dispatch` parses that
JSON as a full row (`src/services/eventNotifier.ts:124`), and `StreamEvents`' `writeRow` writes it through
`rowToEvent` (`src/grpc/ledgerServiceImpl.ts:197`, `:371-373`). The live message carries `payload: undefined` and
`occurredAt: new Date(undefined)` (Invalid Date); `source_service`, `correlation_id`, `metadata` and `user_id` are
lost too (stub fields at `001_ledger_events_hypertable.up.sql:73-79`; `rowToEvent`, `ledgerServiceImpl.ts:364-377`).
The same event via replay, `QueryEvents` or `GetEvent` is complete. Analysis's unfiltered `PnLPatternConsumer`
(`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py:152-153`) and portfolio's five permanent
subscriptions (`consumeEventStream`, `services/xstockstrat-portfolio/internal/service/portfolio_service.go:185`, started
at `:168`, `:1117`, `:1129`, `:1249`, `:1297`) receive the stub for any large event, advance their cursor, and never
re-read it. Consequence: a trader's `/trader` positions and `/insights` P&L patterns are silently wrong after any order
or account event whose row exceeds the threshold.

**Expected.** A live `StreamEvents` message is identical to the replayed/`GetEvent` form of the same event. When a
NOTIFY row lacks `payload`, the ledger re-fetches the full row by `event_id` (borrowing and releasing the query pool)
before `call.write`. Event order and the sequence cursor are preserved.

## Reproduction Steps

1. Open `StreamEvents` with no filters.
2. `AppendEvent` with a JSON payload larger than 7KB.
3. The live message has an empty or absent payload and an Invalid `occurredAt`.
4. `GetEvent(event_id)` returns the full payload.

## Root Cause Hypothesis

The trigger's trim branch assumes a "re-fetch on partial" reader; the fan-out path never implemented it and treats
the NOTIFY JSON as a full row.

## Affected Services

- xstockstrat-ledger (fix site)
- xstockstrat-analysis (live consumer; verify, no change expected)
- xstockstrat-portfolio (live consumer; verify, no change expected)

## Functional Requirements

FR-1. Every `StreamEvents` message sourced from a NOTIFY row — live (`src/grpc/ledgerServiceImpl.ts:210`) or flushed from the replay-window buffer (`:207`, `:255-257`) — equals the replay/`QueryEvents`/`GetEvent` form of the same event in every `LedgerEvent` field (`payload`, `occurred_at`, `metadata`, `source_service`, `correlation_id`, `user_id`), for any row size, with or without `stream_key`/`event_type` filters.
FR-2. A NOTIFY body without `payload` (trim branch, `migrations/001_ledger_events_hypertable.up.sql:72`) is resolved to the full `ledger.events` row by `event_id` before `call.write`; that read borrows and releases the query-pool connection and is never held across `call.write` backpressure, so `AppendEvent` is not starved under ledger `DB_POOL_MAX=1`.
FR-3. Live delivery keeps ascending `sequence` order and the `maxSeq` dedup (`src/grpc/ledgerServiceImpl.ts:196`, `:210`, `:256`) across a resolved event: each appended event reaches the subscriber exactly once, in order.
FR-4. If the full row cannot be read (query error, or no row for `event_id`), the ledger never writes a stub or partial `LedgerEvent` for it and writes no later-sequence event ahead of it on that stream; the event is delivered complete or the stream ends with a non-OK gRPC status, so the consumer reconnects from its last delivered sequence (`portfolio_service.go:185-201`, `pnl_pattern_consumer.py:147-162`) and replays the event complete.

## Fix Scope

- [x] No proto changes anticipated (`LedgerEvent` already carries `payload` and `occurred_at`)
- [x] No DB migration: a trigger change cannot replace the re-fetch, because `payload` alone can exceed the 8000-byte NOTIFY limit. `001` is applied and immutable (F-01); if design still changes the trim branch it takes `004` (latest is `003_events_user_id`) as an up+down pair.
- [x] No config key changes anticipated

## Consumer Surface(s)

None — internal/platform-only. The fix restores the existing `StreamEvents` contract inside xstockstrat-ledger; no
RPC, proto field, response shape, config key or UI code changes. Values reached through unchanged surfaces become
correct for events over the trim threshold: `/trader` positions (portfolio's live ledger subscriptions) and
`/insights` P&L patterns (`services/xstockstrat-ui/src/app/insights/pnl-patterns/page.tsx`, fed by analysis
`PnLPatternConsumer`). No `xstockstrat-ui` or `xstockstrat-agent` step is required.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev. The ledger suites currently load nothing and pass vacuously (`services/xstockstrat-ledger/package.json:13-14`;
feature 252 `fix-identity-ledger-test-suites`), so the red-before-green proof requires a ledger test that executes the
real `ledgerServiceImpl`.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Repairing events consumed as stubs before the fix. Portfolio's resume cursor is in-memory
  (`portfolio_service.go:186`), so a restart replays from sequence 0 through the complete replay path. Analysis's
  cursor persists in `analysis.ledger_stream_cursor` (`pnl_pattern_consumer.py:140-153`), so a pre-fix stub stays
  consumed; repairing it is a data-repair follow-up, not this code fix.
