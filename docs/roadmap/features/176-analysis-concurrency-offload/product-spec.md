# Product Spec: analysis-concurrency-offload

**Created**: 2026-09-04

---

## Problem Statement

Under concurrent multi-user load the platform's decide-surface reads (Opportunities list, Watchlist
readiness) get slow, and one user's heavy compute can stall the service for everyone. Root cause
(see `docs/reports/2026-09-04-performance-bottlenecks-audit.md` § Track A): `xstockstrat-analysis`
performs serial cross-service RPC fan-out and runs CPU-bound / blocking work directly on a single
asyncio event loop; `xstockstrat-indicators` runs a blocking `subprocess.run` on its event loop.
The serialization points are process-global, so latency scales with active-user count.

## User Story

As a platform operator launching xstockstrat for multiple concurrent users, I want the analysis and
indicators services to parallelize their cross-service fan-out under a bounded concurrency limit and
to run CPU-bound / blocking work off the event loop, so that list loads stay fast and per-user
latency stays flat as concurrency grows instead of degrading linearly.

## Functional Requirements

FR-1. `_compute_opportunities` fan-out over the candidate universe (currently the serial
`for c in selected:` loop, `servicer.py:3385`) runs concurrently, bounded by an explicit concurrency
limit, without changing the resulting opportunity set or its ranking versus the serial baseline.
FR-2. `EvaluateReadiness` per-symbol fan-out (currently the serial `for symbol in request.symbols`
loop, `servicer.py:2702`) runs concurrently under the **same** bounded limit that already guards the
opportunity bars-fetch path (`analysis.opportunity.max_concurrent_bars_fetches`), which it currently
bypasses entirely.
FR-3. The `StrategyEvaluator` per-component indicator fan-out (`evaluator.py:234-276`) issues its
`ComputeIndicator`/`ExecuteFormula` calls concurrently per component rather than strictly serially,
under the same bound, preserving deterministic evaluation output.
FR-4. CPU-bound compute in analysis (backtest simulators / `_apply_fill` per-bar loops, `ScreenSymbols`
scans, cold `ListOpportunities` compute) runs off the asyncio event loop (executor / `to_thread`), so
a long-running compute for one user does not block other users' RPCs on the shared loop.
FR-5. The `xstockstrat-indicators` sandbox execution (`sandbox.py:188` `subprocess.run`) runs off the
event loop so concurrent `ExecuteFormula`/`ComputeIndicator` calls are no longer serialized to one at
a time; the existing `indicators.sandbox.timeout_ms` timeout semantics are preserved and, per the
service CLAUDE.md, `indicators.sandbox.max_concurrent` is enforced as the offload bound.
FR-6. All parallelized fan-out preserves the existing **per-user owner-scoping** (no cross-user data
leakage — see Known Trap) and the existing bars-fetch concurrency ceiling that protects TimescaleDB.

## Out of Scope

- Caching / poll-cadence changes (empty-universe recompute, unconditional warm enrichment, client
  `staleTime`) — those are **feature 177 (readiness-caching-poll-discipline)**.
- Portfolio→marketdata quote N+1 batching and marketdata cold-symbol single-flight — **feature 178
  (quote-fanout-batching)**.
- Horizontal scaling of analysis beyond `instance_count:1` (the per-process recompute guards).

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-analysis` — Python; owns `_compute_opportunities`, `EvaluateReadiness`, the
  `StrategyEvaluator`, backtest simulators, and `ScreenSymbols`.
- `xstockstrat-indicators` — Python; owns the formula sandbox (`ExecuteFormula`/`ComputeIndicator`).

## Consumer Surface(s)

_Constitution **C-14**._
- [x] **UI** — `xstockstrat-ui` `/insights`: no new page/control, but the Opportunities list and
  Watchlist readiness panes are the observable beneficiaries (faster list population). Reachability
  already established; this feature changes latency, not surface.
- [ ] **Agent** — no new/changed tool (existing `list_opportunities`, `run_backtest`,
  `screen_symbols`, `test_formula` become faster; response shape unchanged).
- [ ] **None**

This is a performance/behavior change behind existing surfaces; the acceptance criteria assert
**equivalence of output** and **absence of head-of-line blocking**, not a new user-visible feature.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [ ] No new config keys
- Reuses `analysis.opportunity.max_concurrent_bars_fetches` (extend its coverage to readiness) and
  `indicators.sandbox.max_concurrent` (enforce it). A **new** analysis executor-pool-size key
  (`analysis.compute.max_worker_threads` or similar) is likely — to be settled in `/sdd-design`
  against the 2-connection DB pool budget. Final key list is a design output.

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/analysis-concurrency-offload` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — analysis owner + indicators owner (`service` category, no proto)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A
- [ ] config owner — only if a new executor-size config key is introduced (design output)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Known trap (fails.md:1153 — IDOR):** `_compute_opportunities` became per-user under feature
  133 (strategy ownership); `list_live_enabled()` is owner-scoped. Parallelizing the fan-out must
  **not** reintroduce a global/unscoped read — every concurrent branch must carry the same `user_id`
  owner scope. Design + review must assert no cross-user attribution.
- [ ] **Known trap (feature 141 — TimescaleDB shared memory):** the `_bars_fetch_sem = 2` bound
  exists because unbounded concurrent `GetBars` caused a SEV-2 "out of shared memory" on TimescaleDB.
  Parallelization must happen **under** a bound, not by removing it; the design must choose limits
  that raise throughput without recreating that exhaustion.
- [ ] What is the correct executor model for the Python CPU-bound work — `asyncio.to_thread`
  (GIL-bound; fine for I/O-releasing NumPy, not for pure-Python per-bar loops) vs a
  `ProcessPoolExecutor` (real parallelism, serialization cost)? Settle in `/sdd-design`.
- [ ] Should the readiness bound and the opportunity bound share one semaphore instance or be sized
  independently (readiness is interactive; backtest compute is batch)?
