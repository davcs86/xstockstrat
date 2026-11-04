# Test-Data Inventory — xstockstrat-ledger

The catalog of centralized mocked/dummy domain data for the ledger unit tests (`node --test`).
System rules live in `docs/patterns/test-data-inventory.md` (Constitution C-13); this file is the
**live catalog** — keep it in the same commit as any fixture change.

## Canonical fixtures

| Domain entity | Fixture symbol(s) | Module | Shape source | Consumed by |
|---|---|---|---|---|
| Event row (snake_case DB columns) | `makeEventRow(overrides)` | `src/__tests__/fixtures/ledgerEvents.ts` | `migrations/001_ledger_events_hypertable.up.sql` (`ledger.events`) | `ledgerServiceImpl.test.ts` (as `makeRow`), `eventNotifier.test.ts`, `eventRowResolver.test.ts`, `streamResolveWired.test.ts` |
| Over-threshold payload (8000 chars serialized) | `LARGE_PAYLOAD` | `src/__tests__/fixtures/ledgerEvents.ts` | `migrations/001_ledger_events_hypertable.up.sql` (trigger trims rows over 7000 chars) | `eventNotifier.test.ts`, `streamResolveWired.test.ts`, `db/streamResolve.db.test.ts` |
| Trimmed NOTIFY stub | `toTrimmedStub(row, overrides)`, `TRIMMED_RECORDED_AT` | `src/__tests__/fixtures/ledgerEvents.ts` | `migrations/001_ledger_events_hypertable.up.sql` (`notify_event_inserted` stub keys; no `payload`) | `eventNotifier.test.ts` (`TRIMMED_RECORDED_AT`), `eventRowResolver.test.ts`, `streamResolveWired.test.ts` |
| Recording server-streaming call | `makeRecordingCall(req, opts)` — a string `opts` is the caller's `x-user-id`; `{ userId, writeReturns }` otherwise | `src/__tests__/fixtures/streamCall.ts` | `ledgerServiceImpl.ts#streamEvents` / `#exportEvents` (`write`/`end`/`destroy`/`on`), `#waitForDrain` (`once`/`removeListener`/`emit`) | `ledgerServiceImpl.test.ts` (as `makeStreamCall`), `streamResolveWired.test.ts`, `db/streamResolve.db.test.ts` |
