# Context: durable-observable-backfills  (archived 2026-08-06)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-06 — /sdd-archiver

**What**: Replaced ingest's in-memory `self._jobs` dict with a durable `ingest.backfill_jobs` table, emitted the full queued/running/completed/failed ledger lifecycle, wired a notify alert on failure/partial, implemented the previously-inert `retry_on_failure`/`max_concurrent_jobs` config keys plus a new `max_retry_attempts` key, and had marketdata supply an authoritative `expected_bars` estimate so progress is meaningful.
**Why (irrecoverable rationale)**: The problem was framed as trust, not just durability — operators already believed (per existing docs/config keys) that retries, throttling, and failure alerts were happening when they were not (product-spec.md Problem Statement). sdd-review 2026-06-08 resolved four open forks explicitly in favor of honesty over minimalism: implement (not remove) both inert keys; have marketdata (not ingest) own the bar-count estimate so ingest doesn't need a market calendar; drop the in-memory dict entirely rather than keep it as a write-through cache, required for multi-replica correctness; retain job rows indefinitely for now, deferring cleanup policy.
**Rejected alternatives**:
- Write-through cache over the table — lost because multi-replica correctness needs every RPC to read the table directly, not a cache that could diverge across replicas (product-spec.md Resolved Decisions).
- Ingest computing its own bars_total via a market calendar — lost to avoid ingest owning calendar logic when marketdata could compute it authoritatively (product-spec.md Resolved Decisions).
- Removing `retry_on_failure`/`max_concurrent_jobs` instead of implementing — lost because removing them would still leave the "silent overnight failure" trust gap the feature exists to close (product-spec.md Problem Statement + Resolved Decisions).
**Scars & gotchas**:
- Product spec guessed migration number as "next after `001`"; actual next was `003` since `002` already existed — spec's numbering assumption was wrong until `ls migrations/` was actually run (context.md sdd-spec session; implementation-spec.md Step 3 evidence).
- Existing tests manipulated `svc._jobs` directly instead of going through an interface, forcing a full rewrite of 4 test classes when the dict was dropped (context.md sdd-spec session; implementation-spec.md Step 10).
- Docker unavailable in the execution sandbox for both proto codegen and `migrate` — worked around via host toolchain pinned to CI `proto-freshness` versions and a throwaway `postgres:16` for migration verification (implementation-spec.md Deviation Log; context.md 2026-06-09 environment notes).
- `internal/service/` in Go marketdata is excluded from CI coverage measurement, so the `expected_bars` test step required no coverage gate — easy to over-engineer for a threshold that doesn't apply there (context.md sdd-spec session; implementation-spec.md Step 11).
**Permanent deviations**: none — implementation matched product-spec FRs; only the proto-codegen toolchain path was a CI-equivalent sandbox fallback, not a behavioral divergence.
**Cross-feature signal**: This was feature 1 of a 3-feature stacked sequential run (052→053→054) sharing `ingest.proto`'s `BackfillJob` message; 052 claimed field 11, forcing 054 to use 12+. The team chose one integration PR per feature rather than per-step stacked PRs specifically because proto source + generated stubs must commit together, making granular stacking impractical (context.md 2026-06-09).
**Deferred follow-ons**:
- P1 `backfill-backtest-coverage` (053), P2 `resumable-chunked-backfills` (054) — build on this table.
- `ingest.backfill_jobs` retention/cleanup policy explicitly deferred, to be revisited alongside P2's `ingest.backfill_chunks` retention (product-spec.md Resolved Decisions).
**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-08-06 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: - none
**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at f871138.
