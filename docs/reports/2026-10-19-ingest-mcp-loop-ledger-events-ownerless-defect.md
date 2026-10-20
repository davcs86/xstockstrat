# Defect: mcp_client loop ledger events are stored with a NULL owner

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: audit-scoping-loss
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-ingest, xstockstrat-ledger
**Config-only fix possible**: no
**Source**: services/xstockstrat-ingest/docs/context-constitution-findings.md — Open question "The `mcp_client` loop drives `_ingest_external_signal` with **no `propagation_meta`** …"

## Observed
The server-side `mcp_client` poll loop calls `_ingest_external_signal` with only `owner=` and no
`propagation_meta`. The `ingest.signal.ingested` AppendEvent sets no `AppendEventRequest.user_id`
(field 9) and forwards `metadata=propagation_meta` (None). Ledger resolves the owner as the request
field, else the `x-user-id` metadata, else NULL. Loop-ingested signal events are therefore stored with
`user_id` NULL and no trace id, and `ExportEvents` (scoped `user_id = caller`) never returns them to
the source owner. The same event via the `IngestSignal` RPC is owner-stamped.

## Expected
The AppendEvent sets `user_id=owner` explicitly. Optionally a trace id is minted per cycle.

## Reproduction
1. Register an `mcp_client` source and wait one `ingest.mcp_client.poll_interval_seconds`.
2. Query `ledger.events` for `event_type='ingest.signal.ingested'` from that cycle.
3. `user_id` is NULL.

## Evidence
`services/xstockstrat-ingest/app/engine/mcp_client_loop.py:125`
> await servicer._ingest_external_signal(_build_external_signal(slug, item), owner=owner)

`services/xstockstrat-ingest/app/handlers/servicer.py:1132`
> metadata=propagation_meta,

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:39`
> (req.userId && String(req.userId)) || call.metadata?.get?.('x-user-id')?.[0] || null;

## Root cause hypothesis
Ownership reaches the ledger only through the propagated header, and the server-initiated path has no inbound request.

## Confidence
high
