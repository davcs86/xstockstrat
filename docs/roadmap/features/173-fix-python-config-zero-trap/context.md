# Context: fix-python-config-zero-trap  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: Fixed a SEV-2 Python config-watcher defect where `v.int_val or default` / `v.string_val or default` silently swallowed a deliberately-stored `0` or `""`, reverting it to the coded default. Ported `get_int_present` (from analysis) to ingest for two confirmed 0-meaningful keys (`max_retry_attempts`, `dedup_window_hours`), authored a net-new `get_str_present` for indicators (`allowed_imports=""` = deny-all was reverting to the permissive 4-module default — a security-relevant trap), and extracted `_effective_max_attempts()` as a testable seam.

**Why (irrecoverable rationale)**: (1) Per-key, not blanket swap — blanket `get_int`→`get_int_present` would un-clamp the intentionally-clamped `ingest.mcp_client.*` keys (clamped ≥1 at read) and need new clamps at 4 sites, widening blast radius. (2) `max_concurrent_jobs`/`max_concurrent_chunks` stay on `get_int` intentionally — configured `0` reaching `Semaphore(0)` deadlocks the event loop; the default fallback is protective, not a bug. (3) Per-service copy over shared package — no importable shared Python package exists; watcher classes diverge (ingest carries `resolve_secret`/credential-split). (4) FR-1 int-only narrowing — no ingest float key consumes `get_float_present`, so it would be consumerless dead API. (5) `_effective_max_attempts()` seam — inline expression carries `2**attempt` backoff (~14s over 3 attempts); seam extraction makes it testable deterministically.

**Rejected alternatives**: Blanket accessor swap + clamps (un-clamps intentionally-clamped keys); shared `_present` accessor package (no shared Python package, watcher divergence); `get_float_present` parity (consumerless dead API); loop-driving @AC-1 RED (hits real 14s backoff); "assert the inline expression" fallback (vacuous-green, fails-074/151 trap).

**Scars & gotchas**: `ConfigWatcher.__new__` bypasses constructor's channel + watch-task dial (only way to get testable watcher without hanging); ingest watcher carries dead copy of indicators' sandbox helpers (pre-declared known-dead, FR-3 audit won't false-stop); `/context-forge:context-constitution refresh` unavailable in execute session (manual reconciliation performed).

**Permanent deviations**: None. FR-1 int-only narrowing was design-time, not shipped-vs-design.

**Cross-feature signal**: Zero-trap pattern now has three ledger-documented manifestations: (a) proto3 scalar `optional` presence (insights-069), (b) Python config `get_*` accessor `or default` (this feature), (c) TS config `!n`/`?? 0` (insights-161).

**Deferred follow-ons**: `get_int_present` copy across analysis+ingest may trip jscpd (waivable); no `get_str_present` in ingest/analysis; no `get_float_present` in ingest.

**Ledger entries written**: insights.md (0), fails.md (0) — all candidates were DUP.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
