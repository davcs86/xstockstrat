# Implementation Spec: fix-ohlcv-chunk-lock-oom

**Status**: `pending`
**Created**: 2026-08-24
**Feature**: `docs/roadmap/features/153-fix-ohlcv-chunk-lock-oom/feature.md`
**Total Steps**: 3
**Feature Branch**: `feature/fix-ohlcv-chunk-lock-oom`

---

## Execution Summary

This is a **bug fix with no application-code change** (design.md § Chosen Approach: "with **no
application-code change**"). Both remediation pieces act globally on the shared `marketdata.ohlcv`
hypertable / DO cluster, covering **every** 400-day/365-day bars-query call site at once — not just
the `EvaluateReadiness` path observed failing.

- **Piece B (durable, in-repo)** → **Step 1**: a new marketdata migration `004` that widens the
  `ohlcv` chunk interval from 1 day to 30 days via `set_chunk_time_interval` (metadata-only,
  future-only, faithful `.down.sql`). This is the only source-tree change.
- **Piece A (immediate relief, out-of-repo)** → **Step 2**: the operator raise of the DO cluster's
  `max_locks_per_transaction` 64 → 1024, which the repo can only **document** (a runbook) and verify
  — it encodes no cluster parameter. **Already applied** (context.md § Session 2026-08-24 — Piece A
  applied): `db-cluster-update-psql-config` set `max_locks_per_transaction: 1024`, confirmed via
  `get-postgresql-config`; 0 `SQLSTATE 53200` in the post-restart window. Step 2's job is therefore
  "document + verify it is live and holding in staging," not "apply it."
- **Step 3** keeps the chunk-interval documentation consistent with the migration (the marketdata
  `CLAUDE.md` § Database "chunk = 1 day" and the `database.md` hypertable map both go stale for
  future chunks otherwise — Teardown / doc-drift).

**Consumer surface: none — internal/platform-only (C-14)**, restated per the rule below: the product
spec marked `## Consumer Surface(s)` as `None — internal/platform-only`, so no UI/Agent step is
required. This restores existing `GetBars`/`EvaluateReadiness`/`ListOpportunities` behavior; it adds
no RPC, field, config key, or UI/agent surface.

**No `service`/`test` code step, and why (C-08/C-15/P-06):** there is no application code to change,
so there is no non-frontend `service` step and therefore no paired unit-`test` step (C-08 pairing is
predicated on a `service` step existing — none does). Acceptance is verified exactly as the design's
F-05-respecting plan prescribes (design.md § Verification), **not** by a live-53200 reproduction (the
ledger trap this repo burned on twice — fails.md `2026-08-13 fundamentals-provider-alternative`,
recon.md:116-119):

## Scenario Coverage

- **AC-1** (a 400-day bars query locks few enough chunks to succeed, no 53200) → **Step 2**, as a
  *countable lock-budget invariant* proved by arithmetic from four grounded inputs (relation count,
  chunk count, `max_locks` value, DO connection count), documented in the runbook. Post-A:
  `1,600 ≤ 25,600` ✓; post-B future 30-day chunks: `~56 ≤ 25,600` ✓ (design.md § Verification).
- **AC-2** (the chunk-interval migration applies and reverses cleanly) → **Step 1**, via offline
  `up`/`down` file inspection at execute time; the real apply + `timescaledb_information.dimensions.
  time_interval` dimension assert (30 days after up, 1 day after down) runs in the `db-migrator`
  PRE_DEPLOY job at deploy (`.do/app.yaml:481-497`), never as a spun-up-DB step verification
  (offline-migration rule; F-05 verify-before-commit).

## Step Dependencies

- **Step 1 (migration 004)** is independent and may merge/deploy freely — it is inert-but-beneficial
  without Piece A (design.md § Deploy/acceptance ordering). It does **not** by itself resolve the
  SEV-2 on the existing 1-day back-history.
- **Step 2 (Piece A runbook + verification)** carries the actual SEV-2 relief. Acceptance is **not
  met** until "Piece A applied + holding in staging" is verified (design.md Open Risk 1 — a
  first-class gate, not a footnote). No ordering constraint against Step 1 (either may land first;
  1024 makes continued 1-day chunking survivable, and 004 resolves nothing prematurely).
- **Step 3 (doc consistency)** should land with or after Step 1 (it describes the interval Step 1
  sets). No runtime dependency.

---

### Step 1 — migration: widen the ohlcv chunk interval to 30 days (Piece B)

**Status**: `done`
**Service**: `xstockstrat-marketdata`
**Files**:
- `services/xstockstrat-marketdata/migrations/004_widen_ohlcv_chunk_interval.up.sql` — create
- `services/xstockstrat-marketdata/migrations/004_widen_ohlcv_chunk_interval.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, hypertable
partitioning strategy, run-order compliance with `scripts/db-migrate.sh`; xstockstrat-marketdata
(service owner) — OHLCV ingestion integrity, TimescaleDB hypertable partitioning.

**Codebase Evidence**:
- Next NNN is **004**, re-derived against the merged tree at spec time (stale-NNN ledger trap,
  recon.md:88, design.md Open Risk 4): `git ls-tree --name-only origin/main-dev
  services/xstockstrat-marketdata/migrations/` tops out at `003_canonicalize_ohlcv_timeframe.{up,
  down}.sql` (same on `origin/main` and the working tree). The `004_*` files that exist elsewhere are
  in **other** services (analysis/config/identity/indicators/ingest), not marketdata — confirmed via
  `git log --all --oneline --name-only | grep -i "004_"`.
- Current chunk interval is 1 day, set at hypertable creation:
  `services/xstockstrat-marketdata/migrations/001_marketdata_hypertables.up.sql:23-28`
  (`create_hypertable('marketdata.ohlcv', 'time', chunk_time_interval => INTERVAL '1 day', ...)`).
  `001` is applied and **must not be edited** (F-01) — a new numbered migration is the only lawful
  change.
- The `ohlcv` relation set a 400-day scan locks: heap + PK `(symbol, timeframe, time)`
  (`001:20`) + `idx_ohlcv_symbol_time` (`001:31`) + `idx_ohlcv_timeframe_time` (`001:33`) = 4
  relations per chunk. 30-day chunks put a 400-day scan at ~14 chunks × 4 ≈ ~56 locks.
- Reuse-with-subtraction of the `003` pattern (recon.md:62-64): `003`'s `DO $$` compressed-chunk
  pre-flight (`003_...up.sql:32-40`) and its `marketdata.ohlcv_remediation_003` audit log
  (`003_...up.sql:53-68`) exist **only because `003` moved/deleted rows**. A `set_chunk_time_interval`
  call is **metadata-only** (moves no rows), and this service has no compression
  (`services/xstockstrat-marketdata/CLAUDE.md` § Database: "compression policy planned, not yet
  applied"), so **neither guard is included** here (design.md § Chosen Approach, Piece B).
- Transaction discipline: golang-migrate's postgres driver wraps each file in its own transaction; no
  migration in this repo nests an explicit `BEGIN/COMMIT` (`003_...up.sql:27-28`). Match that — no
  explicit transaction control.

**TDD**: `N/A (migration — non-code-bearing; offline up/down verification, real apply at deploy)`

**Covers**: `AC-2`

**Instructions**:
1. Create `004_widen_ohlcv_chunk_interval.up.sql` with a header comment (mirroring `003`'s header
   style) that: names feature 153 and the SEV-2 defect; states this is **metadata-only and
   future-only** — it changes only the interval future chunks are created at, moves no existing rows,
   and does **not** re-chunk the existing 1-day chunks (they age out over ~400 days); explains that
   no `DO $$` pre-flight and no remediation-log table are needed precisely because no rows move (and
   there is no compression on this table); and notes the no-explicit-`BEGIN/COMMIT` convention. Body:
   `SELECT set_chunk_time_interval('marketdata.ohlcv', INTERVAL '30 days');`
2. Create `004_widen_ohlcv_chunk_interval.down.sql` with a matching header and body resetting the
   configured interval to the pre-migration value: `SELECT set_chunk_time_interval('marketdata.ohlcv',
   INTERVAL '1 day');`. Add a one-line note that this reverses the **configured** dimension interval
   only — any 30-day chunks physically created during an up-window remain 30 days wide after a down
   (benign: wider = fewer locks; design.md § Verification AC-2), so the down does not, and need not,
   restore physical chunk width.
3. Do **not** touch `001_marketdata_hypertables.up.sql` or any other applied migration (F-01).

**Verification** (offline — never starts a database; offline-migration rule):
```bash
ls services/xstockstrat-marketdata/migrations/004_widen_ohlcv_chunk_interval.up.sql \
   services/xstockstrat-marketdata/migrations/004_widen_ohlcv_chunk_interval.down.sql
grep -n "set_chunk_time_interval" services/xstockstrat-marketdata/migrations/004_widen_ohlcv_chunk_interval.up.sql   # → INTERVAL '30 days'
grep -n "set_chunk_time_interval" services/xstockstrat-marketdata/migrations/004_widen_ohlcv_chunk_interval.down.sql # → INTERVAL '1 day'
# Read both: confirm .down resets the interval .up sets (30 days ↔ 1 day), and that NEITHER file
# contains a DO $$ block, a remediation-log CREATE TABLE, or an explicit BEGIN/COMMIT.
```
The live apply + rollback + `timescaledb_information.dimensions.time_interval` dimension assert runs
in CI / the `db-migrator` PRE_DEPLOY job at deploy (`.do/app.yaml:481-497`; run order in
`docs/patterns/database.md` § Migration tooling) — that is where AC-2's apply half is proven, not in
the execute loop.

---

### Step 2 — docs: Piece A runbook (max_locks 64→1024) + lock-budget invariant + staging verification

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/ohlcv-lock-budget-tuning.md` — create
- `docs/runbooks/CLAUDE.md` — modify (add the index row for the new runbook)

**Reviewers**: none (docs).

**Codebase Evidence**:
- Piece A is 100% out-of-repo and CI cannot gate it (design.md Open Risk 1); the repo can only
  document it — "it encodes no cluster parameter" (design.md § Chosen Approach, Piece A).
- **Already applied** (context.md § Session 2026-08-24 — Piece A applied): DO cluster `xstockstrat`
  (`1b5ad082-8145-4e09-bdcf-936adfc21f2a`, `db-s-1vcpu-1gb`, PG 18) `max_locks_per_transaction`
  raised **64 → 1024** via `db-cluster-update-psql-config`; confirmed via `get-postgresql-config`
  (`max_locks_per_transaction: 1024`, now an explicit override). Single-node cluster → the change
  triggered a brief rolling restart; the transient ripple self-healed by 21:25:37 UTC; **0 SQLSTATE
  53200** post-restart (last was 19:51 UTC, pre-change).
- Lock arithmetic inputs (design.md § Chosen Approach + § Verification, all grounded): 4 relations per
  chunk (`001:20,31,33`); worst-case existing 400-day scan ≈ 400 chunks × 4 ≈ **1,600**
  AccessShareLocks; lock table = `max_locks_per_transaction × (max_connections +
  max_prepared_transactions)`; `max_prepared_transactions = 0` (confirmed via the DO config API);
  `max_connections ≈ 25` for `db-s-1vcpu-1gb` (a **named assumption**, insensitive between ~22 and
  ~25 — design.md Open Risk 3, to confirm at execute time). At stock 64 → ≈ 1,600 slots (a single
  400-day query nearly exhausts it); at 1024 → ≈ 25,600 slots ≈ 16 concurrent worst-case 400-day
  scans, memory ≈ 25,600 × ~270 B ≈ ~7 MB on the 1 GB instance.
- Assumption the invariant rests on (design.md § Verification AC-1): plan-time chunk exclusion holds
  because marketdata runs simple-protocol (`QueryExecModeExec` under PgBouncer,
  `services/xstockstrat-marketdata/internal/repository/pool.go:36-37`) with range bounds inlined; a
  future switch to extended-protocol/generic plans would lock all chunks and break the math.
- Blast radius the global lever covers (recon.md:49-58): `_compute_opportunities` (guarded),
  `EvaluateReadiness` (unguarded, the failing path), `_load_benchmark_bars_windowed`, backtest
  `_resolve_prefixed_bars`, `GetIndicatorSeries` benchmark, and the live loop's raw 365-day `GetBars`
  — a global server parameter fixes all of them at once (C-10), which is why the app-side semaphore
  extension was rejected as a partial fix (design.md § Rejected Alternatives).

**TDD**: `N/A (docs)`

**Covers**: `AC-1`

**Instructions**:
1. Create `docs/runbooks/ohlcv-lock-budget-tuning.md` documenting the recurring TimescaleDB "out of
   shared memory" (SQLSTATE 53200) lock-table exhaustion on `marketdata.ohlcv` 400-day bars queries
   and its two-piece remediation. Include:
   - **The root cause + the countable lock-budget invariant (AC-1):** the arithmetic above, written
     as `worst-case (chunks × 4 relations) × concurrent_scans ≤ max_locks_per_transaction ×
     (max_connections + max_prepared_transactions)`, with the four grounded inputs and the two named
     assumptions (plan-time chunk exclusion; `max_connections ≈ 25`). Show both checks: post-A on the
     existing 1-day chunks `1,600 ≤ 25,600` ✓, and post-B future 30-day chunks `~56 ≤ 25,600` ✓.
   - **The operator procedure:** raise `max_locks_per_transaction` 64 → 1024 on the DO cluster
     `xstockstrat` via `db-cluster-update-psql-config`; warn that on a single-node plan this triggers
     a **brief rolling DB restart** affecting both staging and production DBs, and that directly-
     connected Node services briefly reconnect (the observed, self-healing ripple).
   - **The verification / acceptance gate (design.md Open Risk 1 — a first-class gate):** confirm
     `db-cluster-get-postgresql-config` shows `max_locks_per_transaction: 1024`, and that a full
     staging readiness/opportunity cycle completes a 400-day scan with **0 SQLSTATE 53200**. Record
     that Piece A was applied 2026-08-24 and is holding (cross-reference context.md).
   - **Relationship to Piece B (migration 004):** 004 is future-only, so Piece A carries the
     transition until the existing 1-day chunks age out (~400 days); 004 alone does **not** resolve
     the SEV-2 on the back-history.
   - Keep all bash macOS/Homebrew-compatible per root CLAUDE.md (no GNU-only flags).
2. Add an index row for the new runbook to `docs/runbooks/CLAUDE.md`'s table (alongside the existing
   rows, matching their `| File | Purpose | Key trigger |` format), e.g. trigger "Recurring OHLCV
   `out of shared memory` (SQLSTATE 53200) / lock-table exhaustion on 400-day bars queries."

**Verification**:
```bash
ls docs/runbooks/ohlcv-lock-budget-tuning.md
grep -n "max_locks_per_transaction" docs/runbooks/ohlcv-lock-budget-tuning.md   # 64→1024 documented
grep -n "25,600\|1,600\|53200" docs/runbooks/ohlcv-lock-budget-tuning.md         # AC-1 invariant + gate present
grep -n "ohlcv-lock-budget-tuning" docs/runbooks/CLAUDE.md                        # index row added
```
Confirm by reading the runbook that the AC-1 lock-budget invariant, the operator procedure, and the
"Piece A applied + holding in staging" acceptance gate are all present.

---

### Step 3 — docs: keep the chunk-interval references consistent with migration 004

**Status**: `pending`
**Service**: `docs/patterns/` + `services/xstockstrat-marketdata/`
**Files**:
- `services/xstockstrat-marketdata/CLAUDE.md` — modify (§ Database)
- `docs/patterns/database.md` — modify (§ Schema & Hypertable Map)

**Reviewers**: none (docs).

**Codebase Evidence**:
- `services/xstockstrat-marketdata/CLAUDE.md` § Database states `Hypertable marketdata.ohlcv:
  partition by time, chunk = 1 day` — goes stale for future chunks once Step 1 lands (Teardown /
  doc-drift rule).
- `docs/patterns/database.md:9` Schema & Hypertable Map row: `| xstockstrat-marketdata | marketdata |
  ohlcv | time (1 day chunks) |` — same staleness.
- Both are the human-first docs the Teardown rule (root CLAUDE.md) requires catching before the PR.

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
1. In `services/xstockstrat-marketdata/CLAUDE.md` § Database, update the `marketdata.ohlcv` chunk
   line to record that **new** chunks are created 30 days wide as of feature 153 (migration
   `004_widen_ohlcv_chunk_interval`), while existing 1-day chunks stay 1-day until they age out — and
   why (lock-table budget on the 400-day bars scan). Keep the existing "compression policy planned"
   note intact.
2. In `docs/patterns/database.md` § Schema & Hypertable Map, update the `ohlcv` row's Partition-By
   cell to reflect the 30-day interval for new chunks (e.g. `time (30 day chunks; 1-day for
   pre-feature-153 chunks)`), with a short pointer to migration `004` / the marketdata `CLAUDE.md` as
   authoritative — mirroring the existing pointer style used for `ohlcv_remediation_003` at
   `database.md:16-18`.
3. Do not restate the full arithmetic here — it lives in the Step 2 runbook; these edits are
   consistency pointers only.

**Verification**:
```bash
grep -n "30 day" services/xstockstrat-marketdata/CLAUDE.md docs/patterns/database.md
grep -n "153\|004_widen" services/xstockstrat-marketdata/CLAUDE.md   # feature/migration cross-ref present
```
Confirm by reading both edits that neither still asserts a bare "1 day chunk" for `ohlcv` without the
30-day future-chunk note.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
