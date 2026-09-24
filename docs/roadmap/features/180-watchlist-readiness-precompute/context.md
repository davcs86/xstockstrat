# Context: watchlist-readiness-precompute  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Shipped a dedicated `run_readiness_materializer_forever` loop in `xstockstrat-analysis` that pre-warms `analysis.readiness_cache` for watchlist-bound `(owner, strategy, symbol)` pairs off the UI render path, plus a `bar_epoch`-aware rewrite of the interactive `EvaluateReadiness` FAST gate. Byte-identity between lazy and materialized rows is guaranteed by one extracted `compute_readiness_row`; one pure `is_readiness_row_fresh` predicate governs freshness for both read origins. No proto, no migration (reuses feature 177's migration 022), 4 no-seed config keys, loop ships default-OFF (kill-switch). No UI code changed.

**Why (irrecoverable rationale)**: The design nearly shipped "materialize inside the live loop" (Option A) twice — the Round-2 pivot after the operator's reframe made the live loop look like a free host. It was killed only when the adversary re-grepped and found the live loop fetches each strategy's *resolved universe* (`allowlist OR (watchlist ∪ held ∪ signals) − denied`), giving 0% coverage for allowlist-override live strategies — neither subset nor superset of the overlay's watchlist-bound pairs. The "free bars" premise was false.

**Rejected alternatives**:
- Option A (materialize inside the live loop) — host loop's key set ≠ reader's key set (0% allowlist coverage), FR-4 alert-latency regression on the serial `_eval_pair`, broken byte-identity.
- New privileged `ListAllWatchlistBindings` portfolio RPC — FR-6 + local live-owner enumeration + the existing owner-scoped drain already yield the warm-set; a cross-user RPC adds proto+authz surface and reopens the fails.md:1153 IDOR class for no gain.
- Longer `valid_until` alone (no gate change) — timing-fragile, two freshness policies under one gate.
- Full unify off the 30s window — deferred (YAGNI; touches 177's trader-page behavior).

**Scars & gotchas**:
- `GetDataCoverage` runs `SELECT MIN/MAX/COUNT(*)` over a symbol's full history (`marketdata_repo.go:213`), yet the `bar_epoch` memo needs only `.latest` and fires on every FAST read. The scan is bounded only because `GetDataCoverageRequest` exposes a `range` field (Step 3 passes a 10-day range). If that field is ever removed, the per-read gate silently reverts to a full-history scan per overlay poll.
- The FAST gate needed a `GetDataCoverage` mock added to `_cache_svc`; before that, feature 177's tests only mocked `GetBars`, so the new-bar-busts case falsely served FAST.

**Permanent deviations**:
- design said "reuse `live_loop._drain_watchlist`" → shipped reused the servicer's own `_drain_watchlist_bindings` (the live_loop method collapses each binding to a bare symbol and discards `strategy_id`).
- design component #3 said "DurableSchedule interval mode" → shipped wall-clock mode on a dedicated `analysis.readiness_materializer.refresh_hour_utc` anchor, because FR-7 makes readiness EOD-granular; the operator chose decoupling so tuning the opportunity hour never moves the readiness re-warm. Jitter/retry deliberately REUSE the opportunity knobs (`analysis.opportunity.startup_jitter_seconds`/`retry_seconds`) — only the daily anchor is dedicated, to keep the new-key surface minimal; that asymmetry is deliberate, not an oversight.
- Operator C-16 rule adjustment (FR-7): the intraday readiness re-eval that feature 177's 30s window forced was deliberately retired — readiness is now defined as changing only at daily-bar close / definition change. @AC-7 keeps the *behavior* but not the framing that this was an intentional narrowing of 177's semantics by operator decision, valid *only* because this is a 1d-bar platform.

**Cross-feature signal**: Features 176 (concurrency offload), 177 (readiness cache + DurableSchedule template), and 180 now cluster around `readiness_cache` and the DurableSchedule loop pattern. 180's `bar_epoch`-aware `is_readiness_row_fresh` is the single freshness authority across 177's lazy path and 180's materialized path — any future reader must go through it or recreate the two-policies-per-table C-16 dishonesty. The benchmark-newer-than-symbol "self-heals at the symbol's next daily bar" correctness argument holds only on a 1d-bar platform.

**Deferred follow-ons**: R5 — enforcing the live-only-binding invariant (rejecting a non-live watchlist binding at write time) is a separate follow-up. 180 only assumes FR-6 and skips (never fabricates) dangling bindings.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-09-16 entries. (Two design/reuse lessons — verify-the-host-loop-key-set and one-shared-compute-unit — were DUPs of this feature's earlier insights.md:3046-3078 and were not re-appended.)

**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* — `analysis.readiness_cache` has exactly one freshness authority, the pure `is_readiness_row_fresh(row, now, fingerprint, latest_bar_epoch)` in `app/services/readiness.py`; any new reader must gate through it, and materialized rows stamped `bar_epoch = max(symbol, benchmark)` assume 1d bars.

**Scenarios promoted (C-16)**: feature 180's `@AC-2..@AC-6` were promoted at archive time into a new suite `services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature` (5 NEW). `@AC-1` and `@AC-7` were OVERLAP — already guaranteed by `@feature-177` (and the `@feature-181 @feature-180` bar_epoch co-promotion) — and deliberately not re-written.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at a6029d9a.
