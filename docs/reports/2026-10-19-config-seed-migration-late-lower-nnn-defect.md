# Defect: A late-merging lower-numbered config seed migration never applies

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: config-seed-silently-skipped
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: all services with migrations (`services/*/migrations`); xstockstrat-config is the most contended dir
**Config-only fix possible**: no
**Source**: `services/xstockstrat-config/docs/context-constitution-findings.md` § Latent bugs row 3 (seed-migration numbers pre-assigned in `merge-order.md`)

## Observed
Config seed migration numbers are reserved ahead of time in `merge-order.md`, but golang-migrate's
`up` applies only versions above the database's current version. If a feature that reserved a lower
NNN merges after a higher one, its migration is skipped on persistent dev/prod databases, yet passes
on a fresh CI database. The seeded keys are then missing and every reader silently falls back to its code default.
This has already happened once: reserved 024 had to be renumbered to 026 after 025 merged first. Nothing automated prevents a repeat.
A second near-miss happened outside config: marketdata 007 was renumbered to 009 after sibling 223
merged 008 first (`docs/roadmap/ledger/fails.md:2910`). The hazard applies to every `services/*/migrations` dir.

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
`database.md` has no forward-only/next-free rule; the guidance lives only in the ledger (`fails.md:614,2910`).

## Confidence
high — reproduced with golang-migrate v4.17.1: after 025 is applied, adding 024 gives `no change` (exit 0)
and 024 never runs; a fresh DB applies both (repro in
`/tmp/claude-0/-home-user-xstockstrat/0e33c54d-7bf5-528d-8d50-aaa4bc92a407/scratchpad/confirm/config-seed-migration-late-lower-nnn/`).
`migrate.go` `Up()` (v4.17.1 `migrate.go:267`, which calls `go m.readUp(curVersion, -1, ret)`) and
`readUp()` (`migrate.go:534`, which walks forward via `m.sourceDrv.Next(suint(from))`) move forward from the
stored version only. No CI job checks migration numbering; `migration-rerun` runs on a fresh DB and cannot
catch it. No key is missing today (scan of main-dev add-order is clean).
