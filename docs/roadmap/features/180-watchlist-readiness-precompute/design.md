# Design: watchlist-readiness-precompute

**Created**: 2026-09-05
**Status when written**: spec-ready → design-approved
**Debate**: full mode, 2 rounds + 1 operator reframe (proposer vs. design-adversary, mediated)
**Inputs**: `recon.md`, `product-spec.md` (incl. operator constraints FR-6, FR-7)

---

## Chosen Approach — Option B: dedicated readiness-materializer loop

A new background loop in `xstockstrat-analysis`, **isolated from the trading-critical live evaluation
loop**, pre-warms `analysis.readiness_cache` for watchlist-bound `(user, strategy, symbol)` pairs by
calling the **exact existing lazy readiness path** (byte-identity), bounded by its **own** semaphore,
and stamps materialized rows with a bar-close-aligned `valid_until`. A small, guarded **`bar_epoch`
extension to the shared FAST gate** makes a long `valid_until` safe against feature-177's `@AC-2`
("a new daily bar busts the cache") — implemented as a single well-named predicate, not inlined.

This is the recon's original recommendation, chosen over the Round-2 "inside the live loop" pivot
after the adversary verified (against code, re-grepped) that the live loop does **not** fetch bars
for the watchlist-bound pair set (it fetches each live strategy's *resolved universe* =
`allowlist OR (watchlist ∪ held ∪ signals) − denied`, `live_loop.py:103-105`), so the "free bars"
premise of Option A is false, and injecting readiness into the **serial** `_eval_pair`
(`live_loop.py:341-347`) would delay alert emission (FR-4 regression).

### Component decomposition (the "well-modularized, not spaghetti" mandate)

The user's explicit constraint: the `@AC-2` fix and the materializer must be cleanly modularized.
Concretely, no readiness logic is inlined into hot paths; every piece is a named, independently
testable unit:

1. **`ReadinessComputer` (extract, don't duplicate).** Extract the SLOW body of `_readiness_for`
   (`servicer.py:2786-2818` — bars fetch, `evaluate_conditions_traced`, `bar_epoch` stamp, row
   staging) into one shared coroutine, e.g. `compute_readiness_row(definition, symbol, *, rule,
   bars_sem) -> ReadinessRow`. Both the on-demand `EvaluateReadiness` handler **and** the
   materializer call it. This is the only way to guarantee byte-identity (same fingerprint, same
   `bar_epoch`, same `readiness_json`) — DRY guard rail; kills the Round-2 Option-A benchmark-loader
   / un-paged-`GetBars` / 365-vs-400-lookback divergence class entirely because there is one code
   path, not two.

2. **`readiness_freshness` module — the FAST-gate predicate.** The `@AC-2` bust logic lives in ONE
   pure, unit-tested function, e.g. `is_readiness_row_fresh(row, *, now, latest_bar_epoch) -> bool`
   returning `row.def_fingerprint == fingerprint AND now < row.valid_until AND row.bar_epoch >=
   latest_bar_epoch`. The `EvaluateReadiness` FAST gate (`servicer.py:2780`) is refactored to call
   this predicate instead of the inline `and` — so both the lazy 30s rows and the materialized
   long-`valid_until` rows are governed by **one** freshness semantic (no two-policies-per-table
   trap). `latest_bar_epoch` comes from a cheap per-`(symbol)` last-bar lookup, memoized per request
   (C-08 discipline: fill the memo before the per-symbol loop, not lazily within it).

3. **`ReadinessMaterializer` loop — orchestration only.** A `run_readiness_materializer_forever`
   coroutine mirroring `run_opportunity_refresh_forever` (`servicer.py:3780`) + `DurableSchedule`
   interval mode: `.enabled` gate, startup jitter, `retry_seconds`, per-cycle `try/except`. It only
   *orchestrates* — sources the warm-set, gates on freshness, calls `ReadinessComputer`, upserts —
   holding no compute logic of its own.

4. **`readiness_valid_until(now, calendar)` helper.** Bar-close-aligned TTL in one place (default a
   generous window via `analysis.readiness_materializer.valid_window_hours`), so the correctness of
   `@AC-2` rests on the `bar_epoch` predicate (#2), not on TTL timing precision.

### Warm-set sourcing (no new cross-user RPC)

FR-6 (watchlists bind live strategies only) collapses the relevant owners to those with live
strategies — which analysis owns locally (`analysis.strategies WHERE live_enabled`, `strategies.py:19`).
The loop enumerates those owners, then **reuses the live loop's existing owner-scoped watchlist
drain** (`live_loop._drain_watchlist`, `live_loop.py:483`, which already calls portfolio's
owner-scoped `ListWatchlists` with `metadata=[("x-user-id", owner)]`) to obtain each owner's
`(strategy_id → {symbols})` bindings. This yields the exact overlay read-set (`rule="entry"`),
**owner-scoped by construction** — no privileged `ListAllWatchlistBindings` RPC, no new proto, no
`authz.go` grant, and the fails.md:1153 IDOR surface never opens. A binding whose `user_id` does not
own the strategy is **skipped**, not fabricated (P-03).

### Resource bounding (fixes the Round-1 objections)

- **Own semaphore** `analysis.readiness_materializer.max_concurrent_bars_fetches` (default 2),
  **never** the interactive `_bars_fetch_sem` (`servicer.py:395`) — this preserves the feature-176
  priority-inversion guard (`servicer.py:402` precedent): a background pre-warm can never starve an
  interactive `EvaluateReadiness` SLOW call.
- **Skip-fresh gate first** (fails.md:118 "nothing changed is the steady state"): each cycle reads
  existing rows via `read_many` and skips any pair already fresh under predicate #2 — so steady-state
  cost is a cheap read, and a full recompute happens only after a daily bar close or a definition
  change.
- Shared `asyncpg` pool (F-06), no new pool.

---

## Option A vs Option B — performance sizing (P = users × live-strategies × bound-symbols)

| Axis | Option A (inside live loop) — REJECTED | **Option B (dedicated loop) — CHOSEN** |
|---|---|---|
| Marketdata 400-day pulls | "free reuse" **false** — allowlist/`denied` bound pairs get 0 bars (`live_loop.py:103-105`), 0% coverage for allowlist-override live strategies | Bounded re-pull via own semaphore; deterministic, predictable |
| Indicator RPC load | **~doubles** — 2nd `evaluate_conditions_traced` fan-out per pair inside the loop | Isolated, independently bounded |
| Alert-loop latency (FR-4) | **Regression** — serial `_eval_pair` (`:341-347`); readiness compute + 2 DB ops delay alerts, trip overlap-skip guard (`:239-241`) | **Zero** trading-loop impact — separate loop |
| Byte-identity (C-16) | **Breaks** — benchmark widening (`live_loop.py:527`) vs lazy fixed window (`servicer.py:1400`); un-paged `GetBars` vs `_fetch_bars_paged`; 365→400 unify alters `_replay_state` in-position seeding | **Preserved** — one shared `ReadinessComputer`, exact lazy path |
| Owner-scoping (IDOR) | Structurally sound | Sound; reuses owner-scoped drain, no new RPC |
| Scaling as P grows | Rides live loop rotation; worsens FR-4 as P grows | Own cadence/rotation; degrades to FR-5 SLOW fallback for the uncovered tail only |
| Blast radius | Modifies trading-critical loop | New isolated loop + one guarded FAST-gate predicate refactor |

**Decision: Option B.** The "free bars" that motivated Option A do not exist for the pairs that
matter, and its price is a trading-hot-path regression plus broken byte-identity. Option B's honest
cost is a bounded extra bars pull.

---

## @AC-2 reconciliation (C-16 boundary)

Feature 177's FAST gate keys only on `(def_fingerprint, now < valid_until)` and **ignores
`bar_epoch`** (`servicer.py:2780`); the 30s window is the sole mechanism forcing re-eval after a new
bar. A long materialized `valid_until` under that gate would serve a stale cross-bar verdict — a
`@AC-2` regression. **Resolution (operator-approved): make the FAST gate `bar_epoch`-aware** via the
`readiness_freshness` predicate (#2 above): a row is fresh only if its `bar_epoch` is not behind the
symbol's latest bar. Then:

- `@AC-1` (fresh within window) — **PRESERVED** (predicate still enforces `now < valid_until`).
- `@AC-2` (a new daily bar busts the cache) — **PRESERVED and strengthened**: the bust is now
  correct-by-construction from `bar_epoch`, for both lazy and materialized rows, independent of TTL
  length or timing.
- FR-7 (intraday same-timestamp 1d-bar OHLC mutation is *not* a readiness requirement) — this is the
  operator's explicit C-16 rule adjustment, recorded in `context.md` and product-spec FR-7. On 1d
  bars the `bar_epoch` (last bar `time.seconds`) advances at each daily close, which is exactly the
  granularity FR-7 says readiness needs. The retired behavior is only the *intraday* re-eval that the
  30s window forced; the lazy path may keep its 30s window (harmless) or adopt the same predicate.

This keeps **one** freshness semantic across the table (no origin-dependent policy), satisfying the
adversary's honesty objection, and confines the shared-gate change to a single guarded predicate that
177's owner reviews (approval gate below).

---

## Rejected Alternatives

1. **Option A — materialize inside the live evaluation loop.** Rejected: live loop's universe ≠
   watchlist bindings (0% coverage for allowlist-override live strategies), FR-4 alert-latency
   regression on the serial hot path, and broken byte-identity (benchmark/pagination/lookback
   divergence). See sizing table.
2. **New privileged `ListAllWatchlistBindings` portfolio RPC** (Round-1 proposal). Rejected: FR-6 +
   local live-owner enumeration + the existing owner-scoped `_drain_watchlist` already yield the
   warm-set; a cross-user RPC adds proto + authz surface and re-opens the IDOR class for no gain.
3. **Longer `valid_until` alone, no gate change** (bar-close TTL only). Rejected: timing-fragile
   (close-to-ingest gap can serve a stale cross-bar row) and creates two freshness policies under one
   gate — the C-16 dishonesty FR-7 warns against.
4. **Unify both paths off the 30s window entirely.** Deferred, not chosen: cleanest single model but
   largest blast radius (changes 177's on-demand behavior incl. the trader page). The `bar_epoch`
   predicate already gives one semantic without forcing that change now (YAGNI).
5. **Verdict pre-warm on a 30s cadence** (Round-1 base). Rejected: cannot refresh P pairs per rolling
   30s under a bounded semaphore; FR-7 dissolves the need (readiness is EOD, not 30s).

---

## Open Risks (carry into context.md Open Threads → resolve at /sdd-spec or execute)

- **R1 — Rotation/coverage lag vs FR-1.** After a daily close all P pairs go stale at once;
  re-warming takes `ceil(P/batch) × interval`. Openers in that window hit the FR-5 SLOW fallback.
  → FR-1 must be **rescoped to eventually-consistent** ("warm within one rotation period; SLOW
  fallback covers the gap"). Fold into product-spec/acceptance at /sdd-spec. Target: spec.
- **R2 — `latest_bar_epoch` lookup cost.** The `bar_epoch`-aware gate needs the symbol's latest bar
  epoch on every FAST read; must be cheap (a lightweight marketdata metadata read or a cached
  per-cycle map), memoized per request (C-08), or it re-introduces a per-read fetch. Target: spec.
- **R3 — Shared FAST-gate change touches feature 177.** The predicate refactor modifies 177's
  on-demand read path → 177 service-owner + `@AC-1/@AC-2` regression tests must pass unchanged.
  Target: execute (RED tests first).
- **R4 — Merge order.** 180 depends on 176 (concurrency offload) and 177 (readiness cache + migration
  022/023), both `code-completed` not `launched`. Sequence **176 → 177 → 180**; add the
  `merge-order.md` row (done this session). Target: spec/merge.
- **R5 — Non-live binding invariant (FR-6).** This feature *assumes* watchlist→live-strategy; whether
  the platform should *enforce* it (reject a non-live binding at write) is a **separate** follow-up,
  not solved here. Note in context.md; do not silently widen scope.

---

## Constitution Rules Touched

- **C-11** (SDD design gate) — satisfied: full debate, this doc.
- **C-14** (consumer surface) — `/insights` overlay; no new UI code (warm cache serves the same RPC).
- **C-16** (business-rule regression) — feature-177 `@AC-1/@AC-2` explicitly preserved via the
  `bar_epoch` predicate; FR-7 records the operator's intraday-sensitivity rule adjustment.
- **P-03** (no silent deviation / no fabrication) — dangling bindings skipped, not fabricated; FR-1
  rescope surfaced, not hidden.
- **F-06** (shared DB pool) — reused, no new pool.
- **F-07** (config via WatchConfig) — new keys are watcher-read.
- **DRY guard rail** — single `ReadinessComputer` shared by handler + materializer.
- **No Floor breach** — confirmed by the adversary in both rounds.

Config keys (final): `analysis.readiness_materializer.enabled` (bool, default `false`),
`analysis.readiness_materializer.valid_window_hours` (int, default 24),
`analysis.readiness_materializer.max_concurrent_bars_fetches` (int, default 2). Migration: none
(reuse `readiness_cache` 022). Proto: none.
