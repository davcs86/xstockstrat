# Defect: A late-merging lower-numbered config seed migration never applies

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: config-seed-silently-skipped
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-config
**Config-only fix possible**: no
**Source**: `services/xstockstrat-config/docs/context-constitution-findings.md` § Latent bugs row 3 (seed-migration numbers pre-assigned in `merge-order.md`)

## Observed
Config seed migration numbers are reserved ahead of time in `merge-order.md`, but golang-migrate's
`up` applies only versions above the database's current version. If a feature that reserved a lower
NNN merges after a higher one, its migration is skipped on persistent dev/prod databases, yet passes
on a fresh CI database. The seeded keys are then missing and every reader silently falls back to its code default.
This has already happened once: reserved 024 had to be renumbered to 026 after 025 merged first. Nothing automated prevents a repeat.

## Expected
CI fails a PR whose new `services/*/migrations/NNN_*` number is not above the current maximum on the target branch. Alternatively, the forward-only rule explicitly forbids pre-reserving numbers.

## Reproduction
1. On a database migrated through N, merge a branch adding migration N-1.
2. Run `scripts/db-migrate.sh`.
3. N-1 is not applied (no error), and `SELECT … FROM config.config_values` lacks its keys.

## Evidence
`services/xstockstrat-config/migrations/026_analysis_engine_blend_keys.up.sql:13`
> `-- NNN renumbered 024 -> 026. merge-order.md pre-assigned 024 (021→022, 031→023, 168→024, 166→025),`

`services/xstockstrat-config/migrations/026_analysis_engine_blend_keys.up.sql:15-16`
> `-- afterward would sit below the already-applied 025 and golang-migrate (migrate up runs only versions >`
> `-- current) would never apply it on the persistent dev/prod DBs. 026 (next free after 025) restores`

## Root cause hypothesis
Planning-time number reservation combined with a forward-only migrator and no CI ordering gate.

## Confidence
low (the root forward-only migration rule may already be judged sufficient; no key is currently missing)
