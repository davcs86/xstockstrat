# Defect: Documented config keys that no code reads (ledger, notify, trading, marketdata, ingest)

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: dead-config-key
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-ledger, xstockstrat-notify, xstockstrat-trading, xstockstrat-marketdata, xstockstrat-ingest
**Config-only fix possible**: no
**Source**: `services/xstockstrat-{ledger,notify,trading,marketdata,ingest}/docs/context-constitution-findings.md` § Dead / orphaned code; root findings TRADING_MODE row (`marketdata.alpaca.paper`)

## Observed

Ten keys appear in the service `CLAUDE.md` config tables and/or the config seeds, but no runtime code
reads them. An operator who changes one of them in config-ui gets no effect and no error:

| Key | Service | Reader in runtime code |
|---|---|---|
| `ledger.stream.notify_enabled` | ledger | none (setting `false` does not stop NOTIFY fan-out) |
| `ledger.retention.years` | ledger | none (and no `add_retention_policy` exists) |
| `ledger.compression.after_days` | ledger | none (and no `add_compression_policy` exists) |
| `notify.stream.max_subscribers` | notify | none (subscriber count unbounded) |
| `notify.alert.retention_days` | notify | none |
| `notify.alert.max_body_bytes` | notify | none |
| `trading.risk.daily_loss_limit` | trading | none (doc labels it "not yet implemented") |
| `marketdata.retention.ohlcv_years` | marketdata | none (doc labels it "not yet implemented") |
| `marketdata.alpaca.paper` | marketdata | none |
| `ingest.backfill.default_timeframe` | ingest | none (servicer hardcodes `"1d"`) |

## Expected

Each key is either wired to a reader, or removed from the docs/seeds (with a down-migration for any seeded row).
Implementing the missing *behavior* (daily-loss halt, OHLCV retention, subscriber cap) is new capability
and routes to `/sdd-story`. This report covers only the advertised-but-inert config surface.

## Reproduction

1. `grep -rn '<key>' services/<svc>/src services/<svc>/app services/<svc>/internal services/<svc>/cmd` (excluding tests) → 0 hits for each key above.
2. Set any of them via `SetConfig` and observe that behavior does not change.

## Evidence

`services/xstockstrat-trading/CLAUDE.md:97`
> | `trading.risk.daily_loss_limit` | float | `0.02` | **Documented, not yet implemented** — intended daily-loss halt; no code reads this key yet

`services/xstockstrat-marketdata/CLAUDE.md:106`
> | `marketdata.retention.ohlcv_years` | int | `5` | **Documented, not yet implemented**

`services/xstockstrat-ingest/CLAUDE.md:125`
> | `ingest.backfill.default_timeframe` | string | `1d` | **Documented, not yet wired** — the servicer hardcodes `"1d"`

Grep at HEAD (runtime sources, tests excluded) returns 0 matches for all ten keys:
`ledger.stream.notify_enabled`, `ledger.retention.years`, `ledger.compression.after_days`,
`notify.stream.max_subscribers`, `notify.alert.retention_days`, `notify.alert.max_body_bytes`,
`trading.risk.daily_loss_limit` (Go), `marketdata.retention.ohlcv_years` (Go),
`"marketdata.alpaca.paper"` (Go), `default_timeframe` (ingest `app/`).

## Root cause hypothesis

Template/planned keys were documented ahead of the features that would consume them, and nothing
checks that a documented key has a reader. A CI lint that cross-checks the `CLAUDE.md` config tables
against grep would prevent recurrence.

## Confidence

high
