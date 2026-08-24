# Runbook: OHLCV lock-budget tuning (`out of shared memory`, SQLSTATE 53200)

**Owner:** xstockstrat-marketdata · **Feature:** 153 (`fix-ohlcv-chunk-lock-oom`) · **Severity:** SEV-2

Use this when `xstockstrat-marketdata` bars queries fail with — or callers surface —
`internal: query bars: ERROR: out of shared memory (SQLSTATE 53200)` (seen in analysis logs as
`EvaluateReadiness: bars fetch failed for <SYM>` / `_compute_opportunities: bars fetch failed`).

---

## Root cause

`SQLSTATE 53200` on a hypertable scan is **lock-table exhaustion**, not a memory leak. The shared
lock table holds a fixed number of slots:

```
lock_table_slots = max_locks_per_transaction × (max_connections + max_prepared_transactions)
```

Every relation a transaction touches takes one `AccessShareLock` slot. `marketdata.ohlcv` is a
TimescaleDB hypertable; each **chunk** is a child table with its own indexes, so a scan locks
`chunks_in_range × relations_per_chunk`. On `marketdata.ohlcv` that is **4 relations per chunk**:
the heap + the PK `(symbol, timeframe, time)` + `idx_ohlcv_symbol_time` + `idx_ohlcv_timeframe_time`
(`services/xstockstrat-marketdata/migrations/001_marketdata_hypertables.up.sql:20,31,33`).

The analysis readiness/opportunity paths scan a **400-day** window per symbol
(`_READINESS_LOOKBACK_DAYS = 400`, `services/xstockstrat-analysis/app/handlers/servicer.py:250`).
While `marketdata.ohlcv` is chunked at **1 day**, that single query plans across **~400 chunks**:

```
~400 chunks × 4 relations ≈ 1,600 locks in ONE transaction
```

On the managed DO cluster `xstockstrat` (`db-s-1vcpu-1gb`, PG 18, `max_prepared_transactions = 0`,
`max_connections ≈ 25`) the **stock** `max_locks_per_transaction = 64` gives only
`64 × 25 ≈ 1,600` slots — so a *single* 400-day scan nearly exhausts the whole table, and any
concurrency across the (unguarded) bars-query call sites tips it into 53200.

---

## The countable lock-budget invariant (AC-1)

The fix is proven by arithmetic, **not** by reproducing a live 53200 (that would be a fragile,
disproportionate live-DB gate — see `docs/roadmap/ledger/fails.md`). The invariant:

```
worst-case (chunks_in_range × 4 relations) × concurrent_scans
        ≤ max_locks_per_transaction × (max_connections + max_prepared_transactions)
```

Grounded inputs: relation count = 4 (DDL above); `chunks_in_range` = `⌈window ÷ chunk_interval⌉`;
`max_locks_per_transaction` = the DO value; `max_connections ≈ 25` (see **Assumptions**);
`max_prepared_transactions = 0` (DO config API).

Two remediation levers move the two sides of the inequality:

| Lever | Effect on the inequality | Where |
|---|---|---|
| **Piece A** — raise `max_locks_per_transaction` 64 → 1024 | grows the right-hand budget | DO cluster param (this runbook) |
| **Piece B** — widen the ohlcv chunk interval 1d → 30d | shrinks `chunks_in_range` on the left | migration `004_widen_ohlcv_chunk_interval` |

Checks after each:
- **Post-A**, existing 1-day chunks: `1,600 ≤ 1024 × 25 = 25,600` ✓ (≈16 concurrent worst-case scans).
- **Post-B**, future 30-day chunks: `⌈400 ÷ 30⌉ × 4 ≈ 56 ≤ 25,600` ✓.

**Assumptions** (state them; don't bury them):
1. **Plan-time chunk exclusion** bounds locks to in-range chunks. This holds because marketdata runs
   simple-protocol (`QueryExecModeExec` under PgBouncer,
   `services/xstockstrat-marketdata/internal/repository/pool.go:36-37`) with range bounds inlined at
   plan time. A future switch to extended-protocol/generic plans would lock **all** chunks and break
   this math — re-derive before assuming it holds.
2. `max_connections ≈ 25` for `db-s-1vcpu-1gb`. The conclusion is insensitive between ~22 and ~25
   (`22 × 1024 = 22,528` still ≫ 1,600). Confirm the plan's real value if in doubt.

---

## Piece A — operator procedure (immediate relief)

`max_locks_per_transaction` is a **Postgres server parameter, not** a `WatchConfig` config key — the
repo encodes no value for it. Raise it on the DO cluster (requires the DO API / MCP tools or `doctl`,
and a maintainer with database access):

1. Confirm the current value (it prints only when overridden; absence = stock default 64):
   - MCP: `db-cluster-get-postgresql-config` for cluster `xstockstrat`
     (`id 1b5ad082-8145-4e09-bdcf-936adfc21f2a`).
2. Set it to **1024**:
   - MCP: `db-cluster-update-psql-config` with `{ "max_locks_per_transaction": 1024 }`.
3. **Downtime warning:** the cluster is **single-node** and hosts **both** `xstockstrat-staging` and
   `xstockstrat-production` databases. Applying a server-parameter change triggers a **brief rolling
   restart** of the DB. Directly-connected Node services (ledger, identity, config, notify) drop and
   reconnect their DB connections; expect a short burst of `Connection refused` / `UNAVAILABLE` in
   dependent services (e.g. analysis's pnl-consumer/live-loop `StreamEvents` to ledger) that
   **self-heals** within ~30s. Schedule outside a live-trading window if that matters.

Memory cost is negligible: `1024 × 25 × ~270 B ≈ ~7 MB` on the 1 GB instance (vs ~256 MB
`shared_buffers`).

---

## Verification / acceptance gate

Piece A is 100% out-of-repo; CI cannot gate it. Acceptance is **not met** until it is applied **and
holding in staging** — a first-class checkpoint, not a footnote:

1. `db-cluster-get-postgresql-config` shows `max_locks_per_transaction: 1024` (now an explicit
   override).
2. A full staging readiness/opportunity cycle completes a 400-day scan with **0 `SQLSTATE 53200`**
   (watch `xstockstrat-analysis` RUN logs for `bars fetch failed … 53200` — expect none).

**Applied 2026-08-24:** `max_locks_per_transaction` raised 64 → 1024 on cluster `xstockstrat`;
confirmed via the config API; the restart ripple self-healed; 0 `SQLSTATE 53200` in the post-restart
window (last occurrence 19:51 UTC, pre-change). See feature 153 `context.md`.

---

## Relationship to Piece B (migration `004`)

Migration `004_widen_ohlcv_chunk_interval` is **future-only** (`set_chunk_time_interval` changes only
the interval new chunks are created at; it does not re-chunk existing data). So **004 alone does not
resolve the SEV-2** on the existing 1-day back-history — those chunks age out over ~400 days while
**Piece A carries the transition**. Re-chunking existing data was rejected as additive-to-Piece-A and
operationally risky (see feature 153 `design.md` § Rejected Alternatives).

If 53200 ever recurs after both pieces are in place, check assumption 1 above (protocol/plan change)
and the concurrency term before re-tuning — do not re-guess.
