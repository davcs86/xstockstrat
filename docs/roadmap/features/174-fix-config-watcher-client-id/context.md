# Context: fix-config-watcher-client-id  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: Fixed a copy-paste bug where analysis and ingest Python config watchers both sent `client_id="indicators-..."` on `WatchConfig` gRPC requests. Recon confirmed `client_id` is cosmetic/diagnostic only (config keys on `Date.now()`-unique `subId`, not `client_id`), so observability hygiene, not functional collision. Each watcher now sends its own service name prefix via an extracted `_build_watch_request()` method.

**Why (irrecoverable rationale)**: The decisive reasoning was the recon investigation into `configServiceImpl.ts` confirming `client_id` is purely an opaque `subId` segment plus log label — no `client_id`-keyed map, no dedup, no per-client routing. This downgraded the fix from "real collision defect" to "observability hygiene" and justified SEV-3/quick design depth.

**Rejected alternatives**: `_client_id() -> str` seam (fails-074: asserts the source string, not the wire object — future inline revert stays GREEN); shared cross-service service-name-prefix helper (over-engineering: three independent Python services, no shared app lib); bare two-literal flip with no test (forfeits AC-1/AC-2 regression guard); deleting dead `sandbox_*` helpers in ingest (different change class, would silently drop live defect from bundled findings entry).

**Scars & gotchas**: Findings entries bundled TWO distinct defects in one row — teardown had to NARROW, not wholesale-resolve. Stale line numbers across product spec/findings docs. Stacked PR on feature 173.

**Permanent deviations**: Design said extract to `self._client_id` attribute → shipped `_build_watch_request() -> WatchConfigRequest` whole-request seam → because R1 adversary showed str-only seam wouldn't catch a future inline revert on the actual request construction.

**Cross-feature signal**: "NARROW, not wholesale-resolve" teardown discipline for bundled findings entries is a new cross-cutting pattern.

**Deferred follow-ons**: Dead indicators-only `sandbox_*` helpers remain in ingest watcher as open findings item.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-09-09 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
