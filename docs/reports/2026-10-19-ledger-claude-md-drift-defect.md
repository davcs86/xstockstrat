# Defect: Ledger CLAUDE.md misstates the RPC list, subscriber count and compression/retention policy

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-ledger
**Config-only fix possible**: no
**Source**: `services/xstockstrat-ledger/docs/context-constitution-findings.md` § Documentation that lies row 2; extended by re-verification (RPC list, compression/retention)

## Observed
- §Ports lists the server's RPCs as `AppendEvent`, `QueryEvents`, `GetEvent`, `StreamEvents`. It omits `ExportEvents` (feature 021), which is implemented and documented in the same file's config-keys table.
- §Live Streaming Architecture says portfolio holds "**three**" permanent `StreamEvents` subscriptions. Portfolio holds five (adding `account.deregistered` and `order.bracket_updated`), and analysis's `PnLPatternConsumer` adds a sixth, unfiltered one.
- §Database states "Compression: after 3 days, segmented by `source_service, event_type`" and "Retention: 2 years". No ledger migration or script calls `add_compression_policy`, `add_retention_policy` or `compress_segmentby`, so neither policy exists. The matching keys `ledger.compression.after_days` and `ledger.retention.years` are already labelled "not yet implemented".
- The banner still lists "migrate-tool mismatch", which has been reframed as a dead `package.json` script.

## Expected
List `ExportEvents`, correct the subscription count, mark compression and retention as not implemented (or implement them), and refresh the banner.

## Reproduction
1. Read `services/xstockstrat-ledger/CLAUDE.md:26`, `:46` and `:93-94`.
2. Compare with `src/grpc/ledgerServiceImpl.ts:282`.
3. Run `grep -rln "add_compression_policy\|add_retention_policy\|compress_segmentby" services/xstockstrat-ledger scripts`; there are no hits.

## Evidence
`services/xstockstrat-ledger/CLAUDE.md:26`
> ``AppendEvent`, `QueryEvents`, `GetEvent`, and `StreamEvents`). All callers connect over gRPC`

`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:282`
> `  async exportEvents(call: any) {`

`services/xstockstrat-ledger/CLAUDE.md:46`
> `This decoupling is load-bearing: `xstockstrat-portfolio` holds **three** permanent `StreamEvents``

`services/xstockstrat-ledger/CLAUDE.md:93-94`
> `- Compression: after 3 days, segmented by `source_service, event_type``
> `- Retention: 2 years`

## Root cause hypothesis
The §Database lines described intended TimescaleDB policies that were never migrated, and later features (021, the portfolio subscriptions) did not update §Ports or the streaming section.

## Confidence
high
