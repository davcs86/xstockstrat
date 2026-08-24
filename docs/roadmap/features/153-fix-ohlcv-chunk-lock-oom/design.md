# Design: fix-ohlcv-chunk-lock-oom

**Created**: 2026-08-24
**Rounds**: 3 (full; termination: approved with an accepted open risk)
**Approved by**: user @ 2026-08-24 (chose the max_locks=1024 variant)
**Grounded in**: recon.md

---

## Chosen Approach

A **two-piece root-cause + immediate-mitigation** fix, with **no application-code change**. Both
pieces act globally on the shared `marketdata.ohlcv` hypertable / cluster, so they cover **every**
400-day/365-day bars-query call site at once (recon.md:49-58) — not just the `EvaluateReadiness` path
observed failing. Consumer surface: **none — internal/platform-only** (C-14); this restores existing
`GetBars`/`EvaluateReadiness`/`ListOpportunities` behavior, adding no RPC, field, or config surface.

**Piece A — immediate relief (operator/infra, out-of-repo): raise `max_locks_per_transaction`
64 → 1024** on the DO cluster `xstockstrat` (`1b5ad082-...`, `db-s-1vcpu-1gb`) via the
`db-cluster-update-psql-config` API (parameter confirmed present in that API's accepted-config schema).
This enlarges the shared lock table for **every** transaction on the cluster, so it protects all bars
query paths immediately, **on the existing 1-day chunks** — which Piece B cannot re-chunk. Applying it
triggers a DO **rolling restart** (brief downtime), so it is **user-gated**. The repo can only
*document* this step (a runbook); it encodes no cluster parameter (recon.md:95-96,127-128).

- Lock arithmetic (recon.md:14,109; product-spec.md:44-48): a worst-case existing 400-day scan locks
  ~400 chunks × **4 relations** (heap + PK `(symbol,timeframe,time)` + `idx_ohlcv_symbol_time` +
  `idx_ohlcv_timeframe_time`, `001:20,31,33`) ≈ **1,600 AccessShareLocks** in one transaction. The lock
  table holds `max_locks_per_transaction × (max_connections + max_prepared_transactions)` slots. At the
  stock 64 with `max_prepared_transactions=0` and ~25 connections that is ≈ **1,600** — a single query
  nearly exhausts it. At **1024** → ≈ **25,600** slots ≈ **16 concurrent** worst-case 400-day scans,
  memory ≈ 25,600 × ~270 B ≈ **~7 MB** on the 1 GB instance (negligible vs ~256 MB shared_buffers).
  The 1024 value (over the 512 the debate first landed on) was chosen by the user specifically to
  **eliminate the transition-window concurrency residual** below rather than accept it.

**Piece B — durable structural fix (repo: marketdata migration `004`): widen the ohlcv chunk interval.**
A new `004_widen_ohlcv_chunk_interval.{up,down}.sql` calling
`SELECT set_chunk_time_interval('marketdata.ohlcv', INTERVAL '30 days');` (down: reset to
`INTERVAL '1 day'`). This is **metadata-only and future-only** (recon.md:100) — it moves no rows, so:
no `003`-style remediation-log table and **no** `DO $$` compressed-chunk pre-flight (both existed in
`003` only because `003` rewrote/deleted rows; they are inert for a metadata-only call, and this
service has no compression anyway — recon.md:64). It mirrors `003`'s transaction discipline (golang-migrate
wraps each file; no explicit `BEGIN/COMMIT`) and ships a faithful `.down.sql`. Future chunks land 30 days
wide, so a full 400-day scan drops from ~400 chunks to ~14 (× 4 ≈ ~56 locks) as the existing 1-day
chunks age out (~400 days) — the system stops living at the lock ceiling. Piece A carries the transition.

- **Interval = 30 days** (honest rationale): 30d already puts a 400-day scan at ~56 locks — well within
  even the *stock* 64-lock table — and preserves **finer chunk-exclusion pruning** for the genuinely
  bounded-range reads (`QueryBars`: `WHERE time >= $3 AND time <= $4`, `marketdata_repo.go:101`;
  backtest/chart windows). It matches the value the product spec already reviewed (product-spec.md:71).
  Note: the discarded round-2 rationale that 30d helps `QueryRecentBars` is **false** and deliberately
  omitted — `QueryRecentBars` is `ORDER BY time DESC LIMIT` and opens ~1 chunk regardless of width; the
  real pruning benefit is on `QueryBars`' bounded range. 90d (~20 locks) is the runner-up on the lock
  axis only.

**Deploy/acceptance ordering (P-03/C-11):** migration `004` is **inert without Piece A** — it does not
by itself resolve the SEV-2 on the existing back-history. So the PR may merge/deploy 004 freely (it is
harmless and beneficial-forward), but **acceptance is not met until "Piece A applied and holding in
staging" is verified** — a first-class checkpoint, not a footnote. There is no reverse hazard: 004
resolves nothing prematurely, and Piece A at 1024 makes even continued 1-day chunking survivable.

**Verification (no live-53200 reproduction as a gate — F-05 trap, recon.md:116-119):**
- **AC-1** as a *countable lock-budget invariant*: worst-case `(chunks × 4 relations) × concurrent
  scans ≤ max_locks_per_transaction × (max_connections + max_prepared_transactions)`, proved by
  arithmetic from four grounded inputs — relation count (DDL `001:20,31,33`), chunk count (the migration
  interval, or the pre-migration 400-day bound), the `max_locks` value, and the DO plan's connection
  count. Post-A: `1,600 ≤ 25,600` ✓; post-B future chunks: `~56 ≤ 25,600` ✓. **Stated assumptions:**
  (i) it relies on **plan-time** chunk exclusion, which holds because marketdata runs simple-protocol
  (`QueryExecModeExec` under PgBouncer, `pool.go:36-37`) with range bounds inlined — a future switch to
  extended-protocol/generic plans would lock all chunks and break the math; (ii) the lock-table sizing
  uses `max_connections ≈ 25` for `db-s-1vcpu-1gb` (`max_prepared_transactions=0` confirmed via the DO
  config API) — a named assumption, not a verified constant; at ~22 the conclusion is unchanged.
- **AC-2**: clean local `up`+`down` via `scripts/db-migrate.sh` against local TimescaleDB (F-05
  verify-before-commit); assert `timescaledb_information.dimensions.time_interval` = 30 days after `up`,
  1 day after `down`. This asserts the **configured dimension interval**, not physical chunk width — 30d
  chunks physically created during an up-window stay 30d after a down (benign: wider = fewer locks =
  strictly better); AC-2 need not (and does not) verify physical chunk width in production.

## Rejected Alternatives

- **Re-chunk the existing ohlcv data (out-of-band)** — rejected: the lock-safe form (batched per-window
  copy in separate transactions) is a bespoke multi-statement procedure racing the always-on ingester
  (`InsertBars`, `StartBarIngestPoller`), effectively irreversible and **unverifiable pre-deploy**
  against the F-05 review-only bar; the simple `INSERT INTO new SELECT * FROM ohlcv` form reads all ~400
  chunks in one txn (~1,600 locks) so it **itself needs Piece A applied first** → additive to A, never a
  substitute; the drop+recreate+re-backfill-from-Alpaca variant (`BackfillBars`,
  `marketdata_service.go:128`) adds irreversible data loss + per-symbol orchestration + Alpaca
  rate-limit dependence. Its only unique payoff — erasing the transition residual — is delivered more
  cheaply by the 1024 lock budget. Kept as a documented rejected alternative.
- **App-side time-windowed fetch** (split the 400-day `GetBars` into ~30-day sub-requests in
  `_fetch_bars_paged`, `servicer.py:1041`) — rejected as over-build and **partial**: it misses
  `live_loop.py`'s raw un-paged 365-day `GetBars` (recon.md:58), reopening a C-10 gap that global A+B
  avoids; adds ~13× round-trips + code to multiple sites for relief the global levers already provide.
- **Extend feature 141's `_bars_fetch_sem`/dedup to `EvaluateReadiness`** — rejected as over-build
  (CLAUDE.md behavior #2): Piece A is global; feature 141 already showed concurrency-limiting alone is
  insufficient (recon.md:110-111). Named runner-up only if telemetry later shows sustained high
  concurrency.
- **max_locks = 512** — the debate's first landing; superseded by the user's 1024 choice to remove the
  transition residual outright (512 → ~8 concurrent scans; 1024 → ~16) at ~3.5 MB extra shared memory.
- **max_locks = 256** — conservative floor (~4 concurrent scans); rejected as too little transition-window
  headroom while 1-day chunks still exist.
- **90-day chunk interval** — fewer locks (~20 vs ~56) but coarser bounded-range pruning and no
  retention/compression to make it worthwhile; immaterial to correctness. Runner-up on the lock axis only.
- **Quotes hypertable widening** (1-hour chunks, `001:49-52`) — out of scope: `GetLatestQuote` is a
  `LIMIT 1 ORDER BY time DESC` latest-read (~1 chunk), no multi-hundred-day quotes scan exists, and
  widening it would edit `001` (F-01) speculatively.

## Open Risks

- [ ] **Immediate relief is 100% out-of-repo (Piece A) and CI cannot gate it.** If the DO restart is
      deferred/reverted — or `max_locks` turns out capped below 1024 on `db-s-1vcpu-1gb` — Piece B
      (future-only) gives no immediate relief on existing 1-day chunks and the bug persists for ~400
      days. Mitigation: acceptance treats "Piece A applied + holding in staging" as a first-class gate.
      → addressed at the operator/infra step + verification step.
- [ ] **Transition-window concurrency residual (largely eliminated at 1024, not provably zero).** Even
      at 1024 (~16 concurrent worst-case 400-day scans), `EvaluateReadiness` remains unguarded with no
      per-user lock (recon.md:54); a pathological >16 concurrent readiness burst on the existing 1-day
      chunks could still trip 53200 until chunks age out. Judged not realistic (readiness cadence is
      scheduler-driven/roughly serial; `_compute_opportunities` is already sem-bounded at 2,
      `servicer.py:374-376`). → accepted; re-introduce the app guard only if telemetry shows sustained
      high concurrency.
- [ ] **`max_connections ≈ 25` is an assumed constant** for the lock-table arithmetic, not read from the
      DO API in recon. → confirm the DO plan's `max_connections` at spec/execute time; conclusion is
      insensitive between ~22 and ~25.
- [ ] **Re-derive migration NNN `004` against the merged tree at `/sdd-spec` time** (stale-NNN ledger
      trap). → addressed at /sdd-spec.

## Constitution Rules Touched

- `F-01` — honored: migration `004` is a **new** numbered file; `001` (the applied hypertable
  definition) is never edited; quotes stays out of scope precisely to avoid editing `001`.
- `F-05` — honored: acceptance gates on SQL/DDL review + clean local `up`/`down` + the arithmetic
  invariant, **not** a live-53200 reproduction (the ledger trap this repo has burned on twice).
- `F-06` — honored: no pool change, no new DB connection; `max_locks` is a server parameter, the
  migrator reuses the existing PRE_DEPLOY direct connection (`.do/app.yaml:482-501`).
- `F-07` — honored: `max_locks_per_transaction` is a Postgres server parameter, not a `WatchConfig`
  key; no config value hardcoded; Piece B introduces no config key.
- `C-01` — honored: every claim cites recon `path:line`; the unsound 30-vs-90 `QueryRecentBars`
  rationale was identified and **excluded** from durable memory (adversary round 2).
- `C-08` — honored: AC-1 is a provable countable invariant with its assumptions named; AC-2 is a
  concrete local up/down + dimension assert.
- `C-10` — honored: the global server-parameter + hypertable-level fixes cover the **entire** blast
  radius (backtest, `GetIndicatorSeries` benchmark, live-loop 365d, readiness) at once — the reason A+B
  beats a per-path app semaphore.
- `C-11` / `P-03` — honored: the out-of-repo/deferred-relief fork and the concurrency residual were
  surfaced to the user (not silently resolved); the user chose the 1024 variant.
- `C-14` — n/a: internal/platform-only, no consumer surface.
- `F-11` — no Floor breach at any round.

## Business Rules Touched (C-16)

- **None.** No promoted `@AC-*` covers the bars/OHLCV/readiness/opportunities path (recon.md § Existing
  Business Rules) — the only marketdata suite guarantees vendor-credential resolution (feature 147),
  unrelated. This fix **preserves** (does not alter) observable `GetBars`/`EvaluateReadiness`/
  `ListOpportunities` behavior; nothing to regress and nothing changed.
