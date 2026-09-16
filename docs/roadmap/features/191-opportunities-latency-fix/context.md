# Context: opportunities-latency-fix  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

> Note: this feature was renumbered `183` → `191` on 2026-09-16 to resolve the `183` collision with `mcp-user-profile-roles` (operator-approved override of "immutable once launched"); see the 2026-09-16 renumber session block below and feature.md.

## Session 2026-09-16 — /sdd-archiver (collision renumber)

- **Renumbered `183` → `191`.** This feature shared the `183` prefix with `mcp-user-profile-roles` (a collision from two `/sdd-story` runs). Both were `launched`, so the numbering rule's "immutable once launched" invariant applied.
- **Operator override (explicit sign-off).** The operator authorized overriding that invariant to renumber the later-launched member (this feature, launched 2026-09-11, vs `mcp-user-profile-roles` launched 2026-09-09) to the next-free number `191` (`max(existing)+1`; `187`–`190` were taken). Recorded per the root CLAUDE.md Commandment-override rule.
- **Blast radius handled (full consistent renumber):** `git mv` of the dir; self-referential path lines; 12 `@feature-183` → `@feature-191` provenance tags across the three promoted C-16 suites (`services/xstockstrat-{marketdata,analysis,ui}/acceptance/opportunities-latency-fix.feature`); cross-feature `@feature-183` references in features 187 (recon.md, design.md) and 190 (recon.md). `CHANGELOG.md` and ledger `insights.md` key off the slug, so no change there. Slug and git branch unchanged.

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: A latency fix that eliminated per-symbol downstream-RPC serialization at three layers of the `ListOpportunities` cold path by adding two batch marketdata RPCs (BatchGetBars, BatchGetLatestPrice), parallelizing the 4 Phase-0 drains with `asyncio.gather`, raising the live-enrich memo TTL 10→20s, and adding a 30s BFF-side gRPC deadline. The original 2.9-min cold-compute path (which exceeded the DO proxy's ~120s timeout and threw `ECONNRESET`) was traced to ~100 per-symbol RPCs queued through a process-wide `_bars_fetch_sem=2`, contended by the live loop's 422 (strategy,symbol) pairs. Shipped clean in 13 steps, unattended, no rollback.

**Why (irrecoverable rationale)**: The decisive call was **batch at the RPC boundary rather than widen the semaphore** — raising `_bars_fetch_sem` 2→5 was explicitly rejected because it buys ~2.5× while collapsing ~100 sequential calls into 1–2 buys ~50–100×, and it never touches the root cause (per-symbol serialization) while adding PgBouncer contention.

**Rejected alternatives**:
- Streaming `BatchGetBars` — the worst-case payload (~3.2 MB) fits a unary response under an 8 MB receive limit, so server-streaming's backpressure/partial-failure complexity bought nothing and would break the all-unary marketdata RPC pattern.
- Flat `WHERE symbol = ANY($1)` without a per-symbol LIMIT — returns all bars for all symbols (millions of rows); a LATERAL JOIN pushes the per-symbol LIMIT into the index scan.
- Raise `_bars_fetch_sem` 2→5 — see Why above.

**Scars & gotchas**:
- **React Query v5 counts `refetchInterval` from query *completion*, not start** — this is why the TTL was set to 20s, not the 15s that "match the poll interval" naively implies: the effective interval is `15s + response_time (~2–5s)`, so a 15s TTL would still re-fetch every poll. Recon/product-spec both said "10→15"; design corrected to 20 during the debate.
- **`now_utc` must be captured AFTER `asyncio.gather`, not before** — it is the freshness reference timestamp; capturing it before the drains makes it stale by the duration of the slowest drain.
- **Batch bar responses blow the default 4 MB gRPC receive limit** — the analysis-side marketdata channel was raised to 8 MB (100 sym × 400 bars × ~80 B ≈ 3.2 MB, 2.5× headroom).
- **golangci-lint never actually ran during execute** — the env had Go 1.25 < the repo target 1.27, so both Go test steps skipped `golangci-lint` and fell back to `go vet`; the lint gate was deferred to CI.
- **Batch migration silently broke 10 pre-existing analysis tests** that asserted the old per-symbol concurrency shape; they had to be rewritten to assert batch usage.
- **Subtle semantic shift for muted symbols**: a muted symbol now appears in the BatchGetBars request because mute is resolved post-evaluation; the dedup-scale test moved from an exact-set to a superset assertion.

**Permanent deviations**:
- design said the LATERAL JOIN vs ROW_NUMBER choice would be validated by **EXPLAIN ANALYZE on staging before merge** → shipped WITHOUT any recorded staging EXPLAIN ANALYZE → the ~14-chunk lock-budget safety claim rests on the runbook reasoning (`docs/runbooks/ohlcv-lock-budget-tuning.md`) alone, never measured for this feature. An unverified load-bearing assumption.
- Recon flagged the Phase-2 benchmark bars fetch as also acquiring `_bars_fetch_sem` and a batching candidate → shipped code deliberately LEFT the benchmark path on per-symbol `_fetch_bars_paged`. Not all 5 semaphore sites were batched; the benchmark path remains per-symbol by choice.

**Cross-feature signal**: Third fan-out-batching fix on the opportunities/marketdata hot path (feature 141 semaphore-sizing, feature 178 quote-fanout singleflight coalescing, now this batch-RPC fix). The recurring root cause is per-symbol RPC fan-out through small semaphores; batch RPCs + singleflight are the emerging platform answer. `GetBarsMulti` had been implemented in Alpaca but sat unwired to any RPC until this feature — a pre-built capability waiting for a consumer.

**Deferred follow-ons**:
- No post-launch latency measurement is recorded — context ended at the 2026-09-11 promotion with no confirmation the 2.9-min path actually dropped in production.
- The Connect-es `timeoutMs`→`DeadlineExceeded` open risk was only partially discharged: tests assert `timeoutMs:30000` is threaded to the client, not that a real slow call emits `DeadlineExceeded` at runtime.
- Staging EXPLAIN ANALYZE of the LATERAL JOIN is still owed if the lock budget is ever questioned.
- The benchmark bars fetch remains a per-symbol fan-out candidate for a future batching pass.
- Arbitrary-timeframe batch bars deferred: the 1d-only restriction is a combinatorial lock-budget guard (retained in this file's history / shipped tests).

**Ledger entries written**: insights.md (4), fails.md (3) — see the 2026-09-09 `opportunities-latency-fix` entries (written by /sdd-execute at integration; slug-keyed, unaffected by the renumber).

**Runtime-invariant recommendations (→ /context-constitution)**: MARKETDATA-* — a LATERAL JOIN / batch bars query over N symbols across one time range locks ~14 TimescaleDB chunks (400 days ÷ 30-day chunks) regardless of N (the hypertable partitions by time, not symbol); already in `docs/runbooks/ohlcv-lock-budget-tuning.md`, tied to `@AC-1 @regression @feature-153`. MARKETDATA-*/ANALYSIS-* — batch marketdata RPC responses can exceed the default 4 MB gRPC receive limit; the analysis→marketdata channel is pinned at 8 MB (`app/main.py`) — worth a PLAT-*/module note so a future channel refactor doesn't drop it.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 5b193f2d.
