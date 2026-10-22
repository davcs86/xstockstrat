# Defect: Live StreamEvents delivers a payload-less stub for events over ~7000 chars

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: silent-data-corruption
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-ledger, xstockstrat-analysis, xstockstrat-portfolio
**Config-only fix possible**: no
**Source**: `services/xstockstrat-ledger/docs/context-constitution-findings.md` § Latent bugs row 1 and § Open questions bullet 3; constitution § Gotchas (trimmed live row)

## Observed
To stay under the 8KB pg NOTIFY limit, the `notify_event_inserted` trigger replaces the NOTIFY body
with five fields (`event_id, event_type, stream_key, sequence, recorded_at`) whenever `row_to_json`
exceeds 7000 chars. `EventNotifier` parses that JSON and hands it to `StreamEvents`'
`onEvent → writeRow → rowToEvent`, which yields `payload: undefined` and
`occurredAt: new Date(undefined)` (Invalid Date). The same event read via replay, `QueryEvents` or `GetEvent` is complete.
Live consumers then process a corrupt row: analysis's unfiltered `PnLPatternConsumer` reads
`event.payload` and advances its cursor past the event, and portfolio's five permanent subscriptions
receive an empty payload for any large `order.*` or `account.*` event. Because the cursor advances, the event is never re-read.

## Expected
When a NOTIFY row lacks `payload`, `StreamEvents` re-fetches the full row by `event_id` (borrowing and
releasing the pool) before `call.write`, so live and replay deliver identical events.

## Reproduction
1. Open `StreamEvents` with no filters.
2. `AppendEvent` with a JSON payload larger than 7KB.
3. The live message has an empty or absent payload and an Invalid `occurredAt`.
4. `GetEvent(event_id)` returns the full payload.

## Evidence
`services/xstockstrat-ledger/migrations/001_ledger_events_hypertable.up.sql:72`
> `    IF length(payload) > 7000 THEN`

`services/xstockstrat-ledger/src/services/eventNotifier.ts:124`
> `      row = JSON.parse(msg.payload);`

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:197`
> `      call.write(rowToEvent(row));`

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:371-373`
> `    payload: row.payload,`
> `    occurredAt: new Date(row.occurred_at),`

## Root cause hypothesis
The trigger's trim branch was designed for "re-fetch on partial", but the fan-out path never implemented the re-fetch; it treats NOTIFY JSON as a full row.

## Confidence
high (the ledger side is certain; consumer impact depends on payload sizes seen in production)
