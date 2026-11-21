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

---

## Homelab deep indicator history

**Feature:** 341 (`fix-indicator-pane-warmup`) · **Applies to:** the homelab `staging` deployment only

Config key `ui` / `chart.indicator_history_bars` (int, default `200`, write bound [200, 1000]) sets how
many bars the `/trader` symbol page fetches for its indicator panes. The chart still draws the latest
200. A deeper fetch gives long-lookback indicators (SMA200) a full line, and it widens the implicit
marketdata `GetBars` window to three times the bar count, so every page load and 300 s poll scans more
`marketdata.ohlcv` chunks.

- **DigitalOcean stays at 200.** Staging and production share one managed database, so their scans
  add up against one lock table.
- **The homelab runs 1000.** It has its own database. Only its `staging` row is set; there is no
  homelab production deployment.
- Nothing but the key description, this runbook and the breach counter below stops an admin from
  setting 1000 on DigitalOcean. The write bound allows it.

### Budget of record

Same invariant as above; a window not aligned to chunk boundaries touches one chunk more than
`⌈window ÷ chunk_interval⌉`.

| Deployment | Depth | Implicit window | Locks per scan | Budget | Result |
|---|---|---|---|---|---|
| DigitalOcean (shared DB) | 200 | 600 days | at most 2,400 (1-day chunks) | 9,600 at 4 scans of 25,600 | unchanged from before feature 341 |
| Homelab (own DB) | 1000 | 3000 days | at most 404 (101 thirty-day chunks × 4) | 28,280 at c = 70 of 71,680 | passes |

- Homelab budget: `max_locks_per_transaction` 1024 × (`max_connections` 70 +
  `max_prepared_transactions` 0) = 71,680. Values of record: `homelab-edge`
  `roles/db_host/defaults/main.yml` (`max_connections`, `max_locks_per_transaction`);
  `max_prepared_transactions` is not set there, so it is the stock 0.
- The homelab gate certifies at c = `max_connections`, the worst case.
- 1-day chunks fail it: 8,280–12,000 locks per scan at a 3000-day window. A homelab database gets
  them only if it was restored from a DigitalOcean dump; a fresh deploy runs migration `004` before
  the first insert and creates 30-day chunks.
- **Rule:** feature 153 `@AC-1` (`services/xstockstrat-marketdata/acceptance/fix-ohlcv-chunk-lock-oom.feature`)
  is PRESERVE on DigitalOcean at 200 and **PRESERVE-at-risk** on any deployment that runs the
  1000-bar depth (operator sign-off 2026-11-15).

### Preconditions (read-only, in order)

1. **`homelab-edge` `verify` is green** with its PR #79 applied. Its task
   `roles/db_host/tasks/verify.yml` asserts `max_locks_per_transaction` = 1024. It does not assert
   `max_connections` or `max_prepared_transactions`, hence step 2. A rename of that task in
   `homelab-edge` silently removes this check.
2. **One `psql` read over SSH** against the staging database. For the SSH path and the database
   name (`xstockstrat-<env>`) see `homelab-edge` `docs/runbooks/db-host.md` § Manual access; for the
   general rules see `docs/runbooks/operator-db-access.md` § Safety. On the database host:

   ```sh
   sudo -u postgres psql -X -d xstockstrat-staging \
     -c "SHOW max_connections;" \
     -c "SHOW max_prepared_transactions;" \
     -c "SELECT range_end - range_start AS width, count(*) FROM timescaledb_information.chunks WHERE hypertable_schema = 'marketdata' AND hypertable_name = 'ohlcv' GROUP BY 1 ORDER BY 1;"
   ```

   Expected: `70`, `0`, and only `30 days` chunks. The chunk query is new; check its output by eye
   on first use.
3. **The key is seeded.** `list_config_keys` with namespace `ui` on the homelab MCP lists
   `chart.indicator_history_bars` (config migration `050_ui_chart_history_bars` is applied).

**A differing value** means recompute the inequality with the observed numbers. Any failure
escalates to the operator. Never ship 200 silently and never lower the gate.

### Launch steps

1. On the homelab MCP, with an admin session: `set_config` namespace `ui`, key
   `chart.indicator_history_bars`, `value_type` `int`, value `1000`, `create_key` left `false`, and a
   `reason`. Then `get_config` namespace `ui` and confirm `1000`. A `NOT_FOUND` means the seed
   migration is missing: do not create the key by hand.
2. Reload the LYFT symbol page (an open tab keeps the depth it read, 200) and confirm the SMA200
   line draws.
3. Observation, not a pass/fail load test: after loading several deep-history symbol pages, check
   that `marketdata.ohlcv.out_of_memory_errors{op="recent_bars"}` shows no increase or is absent.
   Positive control: `GetBars` spans or `marketdata.db.pool.empty_acquire_wait` show the reads ran.
   A readiness cycle is not this check: it uses the fixed 400-day window.

The counter counts every SQLSTATE 53200 on the bar paths, so it detects a breach; it does not
prevent one.
