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
`occurredAt: new Date(undefined)` (Invalid Date). The same event via replay, `QueryEvents` or `GetEvent` is complete.
Analysis's unfiltered `PnLPatternConsumer` (`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py`) and
portfolio's permanent subscriptions (`services/xstockstrat-portfolio/internal/service/portfolio_service.go:160`, `:1018`)
receive the stub for any large event, advance their cursor, and never re-read it.

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

## Fix Scope

- [x] No proto changes anticipated
- [ ] DB migration possible: only if design changes the `notify_event_inserted` trim branch (new numbered migration; `001` is applied and immutable). The report's expected fix (re-fetch in `StreamEvents`) needs none.
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Recovering events that consumers already skipped before the fix (flag for design; not assumed in scope)
