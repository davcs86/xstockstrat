# Product Spec: declared-key fixture

Mentions `ledger.stream.notify_enabled` before the section, so it is not declared.

## Config Key Changes

| Key | Change |
|---|---|
| `analysis.fundsignal.enabled` | read under the stored key |
| `ingest.backfill.new_flag` | new key |

Not keys: `scripts/check-config-wiring.mjs`, `--final`, `Not.A.Key`.

### Notes inside the section

`ingest.backfill.retry_on_failure` is still inside the section.

## Out of Scope

`analysis.backtest.max_duration_seconds` is mentioned after the section, so it is not declared.
