# Design: symbol-data-stage

**Created**: 2026-11-28
**Rounds**: 5 (full; round cap lifted by the operator; termination: pending operator approval)
**Approved by**: _pending — the operator's approval gate has not been passed_
**Grounded in**: recon.md
**Debate register**: debate.md (65 decisions, 27 rejected alternatives, 42 objections all closed, 4 petitions all granted)

---

## Chosen Approach

Paths are relative to `services/xstockstrat-<name>/` unless they start with `packages/`, `docs/` or
`scripts/`. Every citation was checked against the tree `origin/main-dev@bc497728`. Decision IDs
(`D-n`) refer to debate.md. Product-spec and scenario amendments listed in §20 are **not yet
applied**; the operator sees their exact text before they are.

**Consumer surface (C-14):** none. The stage is internal; its records are read by feature 369
(§17) and operators observe it through telemetry, logs and the tables.

### 1. Overview and job-kind table

This is a daily stage on the 367 job graph.
- **Run and passes.** Session S becomes one **run** row in `analysis.data_stage_runs`. A run has up to `PASSES`=4 **passes**. A pass is a three-level job tree with epoch `S#p` and run id `data_stage:S#p` (D-46).
- **Finality check.** The morning after a finished run, one **finality job** re-fetches a sample of 50 covered symbols. It compares them with what the vendor returned at stage time (D-58, D-59).
- **No `Verdict` anywhere (R-5).**

| kind | subject | epoch | run id | lane | children | terminal |
|---|---|---|---|---|---|---|
| `data_stage.universe` | `global` | `S#p` | `data_stage:S#p` (set at enqueue) | HELD | shards | succeeded; blocked if a shard is blocked |
| `data_stage.shard` | `str(k)` | `S#p` | inherited | inherited | data jobs | succeeded; blocked if a child failed or died |
| `data_stage.symbol` | symbol | `S#p` | inherited | HELD if any user holds it, else WATCHLIST | none (D-30) | succeeded (also on fetch failure, budget, superseded); `failed`/`dead` only for real defects |
| `data_stage.finality` | `global` | `S` | `data_stage_finality:S` | WATCHLIST (the lowest; `app/engine/job_graph.py:56-58`, as `PRUNE_LANE` `:63`) | none | succeeded; `failed`/`dead` only for real defects |

### 2. Daily ensure and the run row

**367 hook (D-39).**
- `JobGraphWorker(…, ensures=())`. Each entry runs as `await self._guarded("ensure", fn)` right after `_ensure_prune`, under the same `enabled()` check (`app/engine/job_graph.py:724-725`, `:730-735`).
- `app/main.py` passes `ensures=(data_stage_ensure.tick,)`.

**`DataStageEnsure`** is a new file, `app/engine/data_stage_ensure.py`. It holds:
- the shared `PipelineJobsRepository`;
- the service `db_pool`, used through `bounded_txn` (`app/repositories/read_budget.py`; no new pool, F-06);
- the marketdata stub, the settings, and injectable `now`/`monotonic`.

Its process caches are the calendar answer, the run row for S, "(S, p) enqueued", "finality enqueued for S" and the last pass-check time. The database can rebuild every one of them.

**One `tick` (D-51):**
1. **Ask.** At most once per 60 s, call `GetLastClosedSession(as_of=now)` with a 2 s timeout and cache `(S, closed_at, day_start, day_end)`.
   - On an error: one WARN, keep the cache (D-22).
   - With no cache: return.
2. **Run row.** If none is cached:
   - Return if the switch is off, or if local `now < closed_at + delay`. The local check is only a prefilter.
   - Otherwise one `bounded_txn(db_pool, 5)`: `INSERT INTO data_stage_runs (session_date, closed_at, day_start, day_end, delay_minutes, pass, pass_created_at) SELECT $1,$2,$3,$4,$5,1,now() WHERE now() >= $2 + make_interval(mins=>$5) ON CONFLICT (session_date) DO NOTHING`, then read the row back.
   - No row means it is too early by the database clock: return. The gate is decided once, in database time, and frozen on the row (D-45). `not_before` is not stored; it is `closed_at + delay_minutes` (D-53).
3. **Done.** If `done_at` is set, run the finality step (§9) and return.
4. **Enqueue.** If the switch is on and `(S, p)` is not marked enqueued, call `repo.enqueue("data_stage.universe","global",f"{S}#{p}", run_id=f"data_stage:{S}#{p}", lane=Lane.HELD)` (`app/repositories/pipeline_jobs.py:275`; `ON CONFLICT DO NOTHING`), then mark it. After a restart the call repeats as a no-op.
5. **Pass check.** At most once per 60 s, starting on the tick of the enqueue (not after the spacing): `repo.list_by_run(f"data_stage:{S}#{p}")` (`:400`).
   - **Zero rows:** clear the "enqueued" mark so step 4 enqueues again on the next tick. A pass with no job rows is never treated as finished.
   - **Any row not in `FINISHED_STATES`** (`:17`): return.
6. **Pending query**, one `bounded_txn(db_pool, 5)`. Pending means the marker (`data_stage_users` rows for S) is absent, or some snapshot symbol of S has no `symbol_coverage` row.
7. **Nothing pending, or p = 4:** `UPDATE … SET done_at=now() WHERE session_date=$1 AND pass=$p AND done_at IS NULL`, then INFO `data stage run done`. This runs whatever the switch says, because marking done creates nothing. Matched no row → re-read the run row: another instance advanced or finished the run (D-51).
8. **Pending and p < 4:**
   - Return if the switch is off.
   - Otherwise compare-and-set: `UPDATE … SET pass=p+1, pass_created_at=now() WHERE session_date=$1 AND pass=$p AND done_at IS NULL AND now() >= pass_created_at + interval '30 minutes'`. The spacing gates only this advance.
   - Matched → INFO `data stage pass started` (session, pass).
   - Matched no row → re-read the run row: another instance advanced it, or the spacing has not elapsed.

**Behaviour:**
- **Gate.** The run starts within about 5 s of `closed_at + delay` by the database clock.
- **Marketdata down.** At most one 2 s ask and one WARN per minute. Reap and settle run first (`job_graph.py:721-723`).
- **Idle cost:** none. During a run: one insert per session, one enqueue per pass per process, and at most one `list_by_run` plus one pending query per 60 s per instance.
- **Restart between passes.** The ensure re-reads the row, re-enqueues the pass as a no-op and spaces from the stored `pass_created_at`.
- **Missed session.** Analysis is down across close + delay, so there is no run (D-22).
- **Abandoned run.** S moves on while a run is undone. The old row keeps `done_at` NULL, gets no further pass and no finality check, and its created jobs still run.
- **`worker_enabled=false`.** No ensure runs.

### 3. Calendar RPC (D-4, D-28, D-50)

```proto
rpc GetLastClosedSession(GetLastClosedSessionRequest) returns (GetLastClosedSessionResponse);
message GetLastClosedSessionRequest { google.protobuf.Timestamp as_of = 1; }
message GetLastClosedSessionResponse {
  string session_date = 1;                 // YYYY-MM-DD, America/New_York
  google.protobuf.Timestamp closed_at = 2; // 16:00 NY of session_date
  google.protobuf.Timestamp day_start = 3; // 00:00:00 NY
  google.protobuf.Timestamp day_end = 4;   // 23:59:59 NY
}
```

**Server.**
- `ref, live := marketsession.Reference(as_of)`; if `live`, then `ref = PrevTradingDay(ref)` (the rule of `internal/timeframe/timeframe.go:108-111`).
- `closed_at = marketsession.Close(ref)`, which exports the existing `closeAt` (`packages/proto/marketsession/marketsession.go:41-44`).
- `day_start` comes from `marketsession.DayStart` (`:33`); `day_end = day_start + 1 day − 1 s`.
- The RPC is ungated (`internal/service/authz.go:26-29`).

**Cases:**
- Before 16:00 on a trading day → the previous trading day.
- At or after 16:00 → today.
- Weekend or holiday → the last trading day.
- Half day → modelled as 16:00, so the run starts at 16:00 + delay.
- An unlisted closure reads as a session, so it becomes universe-wide `no_vendor_data`. The fix is the marketdata closure-table rule.

### 4. Universe job

- **Owners.** `SELECT DISTINCT user_id FROM analysis.strategies` in `job.db(5)`, filtered by `is_real_owner` (D-13).
- **Reads (identity per §16).** The system-scope signals first, then per owner, sorted: held positions, the watchlist drain and own signals.
  - The drains move to `app/engine/universe_reads.py` and raise `UniverseReadError(partial, reason∈{rpc,page_cap})` (D-21).
  - `_drain_positions_paged` gains `timeout=None`; the stage passes 10 s per page, and the legacy callers pass nothing (D-49).
  - The read phase runs under `asyncio.timeout(300)`.
- **Attempt policy (D-19, D-49).**
  - If `job.attempts < max_attempts`, the first failed read or the budget expiring raises a transient error before any write.
  - On the last attempt, a user with any failed source contributes no rows and gets `snapshotted=false` with `failed_source` set to the first failure.
  - A user not fully read when the budget expired gets `failed_source='budget'`.
  - The system set is stored under `system` (D-33).
- **Write (D-33).**
  1. Block 1 runs `DELETE … WHERE session_date=S` (it clears a crashed attempt's partial rows), then the first chunk.
  2. Further `job.db(30)` blocks insert at most 5,000 rows each.
  3. A last block writes all `data_stage_users` rows. This is the marker.
  - If the marker is present at round 0 (a later pass, a takeover or a requeue), the job skips reads and writes.
- **Retention (D-20, D-35).** Pass 1, round 0 only. Batches of 5,000 rows, one `job.db(30)` each, stopping after the first batch that ends 120 s after round 0 began.
  - Session-keyed tables (runs, users, universe, coverage, bar, finality) are pruned below `S − max(30, retention_days)`.
  - Holes are pruned when `last_session < S − 730`; filings rows when `next_check_on < S − 365`.
- **Kill switch at round 0** → `Succeeded`, INFO `data stage disabled; session S pass p skipped` (D-17).
- **Park.** `N = count(DISTINCT symbol)`; N = 0 → `Succeeded` (`job_graph.py:172-173`). Otherwise park on shards 0..⌈N/500⌉−1, which stays within 10,000 children for N ≤ 5,000,000 (`:174-175`).
- **Bound:** see §19 (O-41).

### 5. Shard job

- **Read.** One `job.db(5)` takes slice k of the snapshot (`GROUP BY symbol, bool_or(held) ORDER BY symbol OFFSET k·500 LIMIT 500`), minus the symbols that already have a `symbol_coverage` row for S.
- **The slice is fixed** because the snapshot is immutable. The filter cannot change before the park commits, for two reasons:
  - only this shard's children write records for its slice in this pass;
  - the next pass starts only after this one has finished.
- **Children:** `Child("data_stage.symbol", sym, f"{S}#{p}", HELD if held else WATCHLIST)`.
- A filtered-empty slice → `Succeeded`. A WARN is written only when the unfiltered slice is empty.
- `SHARD_SIZE=500` is a local constant (`tests/test_job_handler_contract.py:67-68`).

### 6. Data job

**Constants.**
- `W = 730 d` (D-32); `cov_end = S T16:00Z` (D-8); `cov_start = cov_end − W`.
- A gap bound's date is its UTC date.
- One `trace = uuid4().hex` per attempt.

**Steps.**
0. **Parse the epoch.** S and p come from the epoch; `last = (p == 4)`. A malformed epoch → `PermanentJobError`.
1. **Read, `job.db(10)`, in this order:**
   - A coverage row `(sym, S)` exists → `Succeeded` (D-34).
   - Read `pass, done_at, day_start, day_end, (now() − pass_created_at) > interval '30 minutes' AS over_budget` from the run row. A missing row → `PermanentJobError`.
   - `row.pass ≠ p` or `done_at IS NOT NULL` → **superseded**: INFO `data stage job superseded`, `Succeeded`, no call and no write (§7). This is an early-out; the binding check is the locked read in step 9 (D-62).
   - `over_budget` → fetch failure with reason `budget`, and no call is made (§7, D-61). This reads the database clock only; it reads no config key and never raises (it refines D-45).
   - Read the hole rows and the filings-check row.
2. **Final call (D-56).** `BackfillBars([sym], 1D, [day_start, day_end], return_bars=true)`, 120 s timeout, with the quiet caller header (§14) → outcome F.
   - **Captured bar:** the one returned bar with `time ∈ [day_start, day_end]`.
   - If there is not exactly one such bar, nothing is captured.
3. **Coverage₁.** `GetDataCoverage(sym, 1D, [cov_start, cov_end])`, 30 s timeout.
4. **Unconfirmed set U.** The pre-S gaps of coverage₁, clipped to end at or before S − 1 d, that no stored run contains (D-26).
5. **History, only if U is non-empty.**
   - `BackfillBars([sym], 1D, [min U start, day_start − 1 s])`, 120 s, with the quiet caller header and **without** `return_bars` (the server refuses that flag on a range over 7 days, §9.2) → outcome h. Then coverage₂ with the same range as coverage₁, and G = coverage₂.
   - Otherwise G = coverage₁ and h = none. A symbol with nothing to repair costs one coverage scan.
6. **Holes R** (only if h ∈ {written, EMPTY}): each G gap, clipped to [history start date, S − 1 d]. "Long" means more than 30 d.
7. **Verdict (D-10, D-56):**

| F | `latest(G)` = S | pre-S gap not in stored ∪ R | verdict |
|---|---|---|---|
| written | yes | none | `covered` + bar record |
| written | yes | some (h = SKIPPED) | `no_vendor_data` |
| written | no | – | `no_vendor_data` + WARN |
| EMPTY / SKIPPED | – | – | `no_vendor_data` |

8. **Fundamentals step (§8).**
9. **Write, one `job.db(10)`, in this order (D-52):**
   1. `SELECT pass, done_at FROM analysis.data_stage_runs WHERE session_date=$S FOR SHARE`. If `pass ≠ p` or `done_at IS NOT NULL` → INFO `data stage job superseded`, leave the block with nothing written and return `Succeeded` (D-62). The ensure's updates of that row take its row lock, so they wait for this block (at most its 10 s) and the read sees the latest committed row. Shared locks do not conflict with each other, so data jobs do not contend.
   2. `INSERT INTO symbol_coverage … ON CONFLICT DO NOTHING RETURNING 1`. No row back means a concurrent writer won: leave the block without further statements (nothing was written, so no rollback is needed) and return `Succeeded`.
   3. The holes: `DELETE` the stored runs inside the history range (D-37), then upsert on `(symbol, first_session)` keeping `GREATEST(last_session)`.
   4. The filings upsert.
   5. If covered: `INSERT INTO symbol_bar (…, open, high, low, close, volume) … ON CONFLICT DO NOTHING`, with the captured bar, or NULLs if none was captured.

   Telemetry is recorded after the commit.

**Fetch failure.**
- `rpc`: a gRPC error from `BackfillBars` or `GetDataCoverage` with any code except `INVALID_ARGUMENT`, including our own `DEADLINE_EXCEEDED`.
- `symbol`: a per-symbol `FAILED` (`internal/service/marketdata_service.go:1595-1600`, `:1612-1618`).
- `budget`: see step 1.

An attempt stops at its first fetch failure.

**Real defects.**
- `PermanentJobError` → `failed`: `INVALID_ARGUMENT`, a malformed epoch, a missing run row.
- Transient through 367 (→ `dead` after `max_attempts`): `job.db` errors, gate timeouts, lease loss.

**Tail gap.** It is never contained, so the symbol makes one history call from the gap start every session. That is ≤ 1 extra call and 1 extra scan per day per such symbol (estimate ≤ 1% of the universe).

**Worst-case attempt:** 20 + 120 + 30 + 120 + 30 + 160 + 20 = 500 s, under the 900 s deadline (`job_graph.py:32`).

### 7. Retry passes and the pass budget (D-41, D-42, D-46, D-55)

**Fetch failure handling.**
- **Attempt 1** (`rpc`/`symbol`): raise a transient error; 367 retries after about 5–6 s.
- **Attempt ≥ 2** (`FETCH_ATTEMPTS_PER_PASS`=2), and `budget` on any attempt:
  - **Passes 1–3:** `fetch_deferred{reason}` +1 and `Succeeded`, writing nothing. The symbol stays pending.
  - **Pass 4:** write `bar_verdict='fetch_failed'` with `fail_reason`. No hole, no bar record, no filings call.
    - For `rpc`/`symbol`, the fundamentals state is read (D-47).
    - For `budget`, no call at all is made, so `fundamentals_state='unavailable'` (refinement, §24).

**Pass budget, the exact rule.** A data-job attempt whose step-1 read finds database `now() − pass_created_at > 30 min` makes no call.
- **One clock.** The comparison runs inside the step-1 `job.db` read, so the database clock alone decides it, the same clock that gated the run.
- **Which pass.** The job compares against its own pass, by this invariant: the ensure advances the row from p only after `list_by_run` shows every pass-p job finished (§2 step 5). So while a pass-p attempt runs, `row.pass = p`.
- **The one exception** is an operator requeue after the advance, or after done. The job is then superseded: step 1 catches it early, and the locked read at the start of the write block (§6 step 9, D-62) catches a requeue that races the ensure. So after `done_at`, no data-stage job creates a coverage or bar record for S. The operator accepted the consequence (D-65): once a run is done, requeueing its jobs cannot repair that session's records; the next session's run repairs the stored bars only.
- **The last pass gets the same budget.** Without it, a slow outage would push `done_at` out by hours (R-23).

**Timing consequences.**
- A pass's calls end by `pass_created_at` + 30 min + one attempt's call time (≤ about 460 s).
- Jobs claimed after the budget finish in milliseconds. So a pass that hit the budget ends shortly after its 30th minute. By then its spacing has elapsed, and the next pass starts at the next pass check (≤ 60 s).
- Passes are therefore contiguous under load and spaced under fail-fast outages.
- The HELD lane is claimed first, so a budget-cut pass covers held symbols first.

**Throughput ceiling (condition, estimates).** Symbols that can start in one pass ≤ min(slot bound, vendor bound):
- **Slot bound:** instances × `worker_concurrency` × 1,800 s / t. With t ≈ 0.5 s per symbol: 14,400 per instance at c = 4.
- **Vendor bound:** plan rate × 30 / ≈1.1 requests per symbol. On 200/min that is ≈ 5,450 per pass, shared with the warm poller and the ingester. On 10,000/min it is slot-bound.

| Universe on 200/min | Outcome |
|---|---|
| 10k symbols (a healthy day) | Pass 1 covers ≈ 5,450; ≈ 4,550 count `fetch_deferred{budget}`; pass 2 starts ≈ 17:01–17:08 and finishes them; done ≈ 17:35. Nothing is lost. |
| Above ≈ 4 × 5,450 ≈ 21,800 symbols a day | Pass 4 records the remainder as `fetch_failed{budget}`: loud, counted, queryable. |

**Bounds per symbol per session** (each from the invariants above):
- passes ≤ 4;
- `BackfillBars` calls ≤ 2 per attempt;
- fetch-failing attempts ≤ 2 per pass;
- so calls ≤ 16 from fetch failures, and ≤ 8 for a symbol whose first call is rejected.

The last pass is created ≥ 90 min after `closed_at + delay`.

**Outage timeline** (delay 30, fail fast, outage 16:25–17:05; estimates: ≈ 2.6 control transactions per failing symbol at ≈ 50/s; drain ≈ 180 symbols/min on 200/min):

| | 1k symbols | 10k symbols |
|---|---|---|
| Pass 1 at 16:30, all symbols defer | ends ≈ 16:32 | ends ≈ 16:40 |
| Pass 2 at 17:00 | all defer; ends ≈ 17:02 | ≈ 5,700 defer before 17:05; ≈ 4,300 covered by ≈ 17:29 |
| Pass 3 at 17:30 | covers all; done ≈ 17:36 | ≈ 5,400 covered, ≈ 300 defer on budget; ends ≈ 18:02 |
| Pass 4 | – | at ≈ 18:02, covers the rest; done ≈ 18:04 |
| Outage never ends | pass 4 at 18:00 writes `fetch_failed{rpc}`; done ≈ 18:03 | done ≈ 18:11 |

**Slow outage** (every call hangs to its timeout, never ends): about 30 symbols per instance get calls in each pass, the rest defer on budget, and each pass lasts ≈ 38 min. Done ≈ 19:05, with `fetch_failed{rpc}` or `fetch_failed{budget}`.

**Dead data jobs** block their shard and universe job. The pass still finishes, and the next pass retries the symbol under a new key. After pass 4, the run is done with that symbol unrecorded.

### 8. Fundamentals step (D-12, D-25, D-31, D-40, D-44, D-54)

**Read.** `GetHistoricalFundamentals(sym, range_start=S−190 d, page_size=50)`, 10 s timeout, no `as_of_date`. An empty page is followed by an unranged `page_size=1` read. P = the newest `period_end`.

**State:**
- read error → `unavailable`;
- P ≥ S − 190 → `fresh`;
- something stored but older → `stale`;
- nothing stored → `unavailable`.

**Schedule.**
- `w = crc32(symbol) % 5`, mapped with Python `date.weekday()`: **0 = Monday … 4 = Friday**.
- `shift(d) = d + ((w − d.weekday()) mod 7)` days, so every scheduled date lands on weekday w, 0–6 days later.
- **No row:** `next = shift(P+105)`, or `shift(S)` if P + 105 ≤ S. With no stored filings, `next = shift(S)`.
- **Due** means `next_check_on ≤ S`.
- **After a call:**
  - fresh and not overdue → `shift(P+105)`;
  - overdue, stale, error or `disabled` → `shift(S+7)`;
  - no stored filings → `shift(S+28)`.

**Call.** `BackfillFundamentals([sym])` with defaults, 120 s timeout. Outcomes:
- a missing result entry = `written`; otherwise `EMPTY`/`SKIPPED`/`FAILED`;
- `FailedPrecondition` = `disabled`; any other gRPC error = `error`.

It runs only on a `covered` or `no_vendor_data` verdict. It is wrapped in `except Exception`, bounded at 160 s, and emits no ledger event.

**Peak (estimate).** About 1,130 calls a day at 10k symbols, and about 3–6 GB of SEC download. The call duration is measured in staging before launch (§9.7). A per-run call cap is the lever if it is slow (D-54).

### 9. Bar finality and the automated drift check (D-56, D-58)

#### 9.1 Finality argument

`symbol_bar(sym, S)` exists ⇒ in the committing attempt:
- (a) the S call over exactly `[day_start, day_end]` returned written;
- (b) the attempt began after the run row was inserted, and that insert required database `now() ≥ closed_at + delay`;
- (c) G showed `latest = S` with every pre-S gap confirmed.

A CHECK enforces `covered ⇒ final_outcome='written' AND latest_bar=session_date`. What remains unproven is whether the vendor's bar is still the same later. §9.2–9.6 measure that every day.

#### 9.2 What is compared

- **No read RPC can be used.** Every bars or quotes read RPC marks the symbol warm: `GetBars` `:301` and `BatchGetBars` `:854` through `markWarmIfServable`, which runs on every servable request; `GetLatestQuote` `:651`, `GetLatestQuotes` `:681`, `GetLatestPrice` `:794` and `BatchGetLatestPrice` `:971`. `GetDataCoverage` (`:516`) carries no values. So option (b) does not exist.
- **(c) rejected.** A new `GetStoredDailyBar` RPC, or a `no_warm` flag on `GetBars`, adds an RPC or a second path through the warm logic.
- **(d) rejected.** Sampling only held symbols would not cover watchlist-only symbols, and it would depend on another loop's warm state.
- **Chosen, (a).** `BackfillBars` already holds the fetched bars in memory before `InsertBars` (`internal/service/marketdata_service.go:1593`, `:1612`), and it never marks warm (no `markWarm` between `:1543` and `:1639`). Its response has no values (`packages/proto/marketdata/v1/marketdata.proto:166-171`).
  - **Additive request field:** `bool return_bars = 6;` (fields 1–5 are used, `:157-164`).
  - **Additive response field:** `repeated Bar bars = 5;`, using the existing `Bar` (`:84-98`).
  - **When set,** the server appends each written symbol's inserted bars. A request whose range exceeds 7 calendar days returns `INVALID_ARGUMENT`, so a response cannot balloon. When the field is unset, behaviour is byte-identical.
- **Only the S call sets the flag.** The history call never sets `return_bars`: its range exceeds the 7-day cap and would be refused.
- **Stage capture.** The data job's S call sets `return_bars`. The one S bar (o/h/l/c/v) is stored on the bar record (§11). `vwap` and `trade_count` are not compared.

#### 9.3 When

**Trigger:** the run row has `done_at` set, the switch is on, and database `now() ≥ closed_at + 16 h` (08:00 New York the next calendar day; 07:00 or 09:00 across a DST change).
- **Ensured once.** The ensure's done branch (§2 step 3) does three things:
  - a local prefilter;
  - one `bounded_txn` reading `now() >= closed_at + interval '16 hours'`;
  - `repo.enqueue("data_stage.finality","global", S, run_id=f"data_stage_finality:{S}", lane=Lane.WATCHLIST)`, which is idempotent on its key across instances. A process flag stops repeat enqueues.
- **S is still the cached session at the trigger.** The next close is ≥ 24 h after `closed_at` (16 h < 24 h). Weekends and holidays only lengthen that gap. Friday's check runs Saturday 08:00.
- **Late done.** If `done_at` comes later than +16 h, the check is enqueued at done.
- **No check** for an abandoned or undone run, or while the switch is off. The switch gates creations (D-17), so no second switch is needed.

#### 9.4 Sample

- **Size and selection.** K = 50, one `job.db(10)`: `SELECT symbol, open, high, low, close, volume FROM analysis.symbol_bar WHERE session_date=$S AND close IS NOT NULL ORDER BY md5(symbol || $S::text) LIMIT 50`.
- **Properties.** The sample is deterministic per session, so a replay picks the same set, and it rotates across sessions. A session with fewer covered symbols checks all of them.
- **Why 50.** A systematic finality defect (bars built too early) hits most symbols and is detected almost surely. Drift affecting a fraction f of symbols is missed with probability (1−f)^50: 7.7% at f = 5%, 0.5% at f = 10%.
- **Vendor cost:** 50 Alpaca requests a day.
- **Results** go to `analysis.data_stage_finality`, one row per sampled symbol with the re-fetched values. They are retained with the session tables (§4).

#### 9.5 Tolerance and result states

Per sampled symbol, comparing captured values c with re-fetched values n, with r_f = n_f / c_f for f ∈ {O, H, L, C}. Both sides come through the same path with no rounding in marketdata (`internal/alpaca/client.go:450-459`):

| Result | Rule |
|---|---|
| `unavailable` | The re-fetch gave no single S bar: gRPC error, `FAILED`/`EMPTY`/`SKIPPED`, or the 300 s check budget expired before this symbol |
| `match` | Every \|r_f − 1\| ≤ 1e-6 and \|n_V − c_V\| ≤ 1% of c_V |
| `adjusted` | With r̄ = n_C / c_C: (i) \|r̄ − 1\| > 1e-6; (ii) for every f ∈ {O, H, L}: \|n_f − r̄·c_f\| ≤ 0.011 + 1e-4·n_f (one cent of vendor rounding on each side plus relative slack); (iii) volume unchanged within 1% (a dividend), or \|n_V·r̄ − c_V\| ≤ 1% of c_V (a split, where volume scales inversely). This is the signature of an `alpaca.adjustment=all` rewrite (D-60) |
| `drift` | Anything else |

`adjusted` is not counted as drift. Condition (iii) is what keeps the check sensitive: a late print or a vendor correction changes volume, while an adjustment rewrite does not. Residual: a correction that rescales O/H/L/C by one factor and leaves volume unchanged reads as `adjusted`.

#### 9.6 Finality job

**Steps.**
1. One `job.db(10)`:
   - finality rows for S already exist → `Succeeded`, so a replay counts nothing twice;
   - read the run row's day bounds; a missing row → `PermanentJobError`;
   - select the sample; an empty sample → `Succeeded` with INFO.
2. **Re-fetch** each sampled symbol in sequence under `asyncio.timeout(300)`: `BackfillBars([sym], 1D, [day_start, day_end], return_bars=true)`, 30 s timeout, quiet caller, `SYSTEM_READ_META` + trace.
   - Each error becomes that symbol's `unavailable`. No transient error is raised for vendor failures, so there is no retry storm.
   - The re-fetch overwrites marketdata's stored S bar with the vendor's current values for the sampled symbols only. For an `adjusted` symbol that moves the adjustment-basis break by one session; it is unavoidable through `BackfillBars` and neutral.
3. **Classify, then write** in one `job.db(10)`: `INSERT … ON CONFLICT DO NOTHING`.
4. **After commit:**
   - `analysis.data_stage.finality{result}` +1 per row;
   - WARN `data stage finality drift` per drifted symbol (≤ 50 lines) with the symbol and both values;
   - WARN `data stage finality unavailable` when all rows are `unavailable`.

**How drift is raised (D-63).** No notify alert is emitted, so no user sees anything and the job registry needs no notify stub. The operator is paged by a Grafana alert rule on `increase(analysis.data_stage.finality{result="drift"}) > 0`; the rule's definition is documented in the service docs (`docs/data-stage.md`). The rule lives in Grafana, outside the repo's tests; the counter, the logs and the table are tested.

**Effects.**
- It changes no verdict, coverage record or bar record, and it delays nothing.
- **No re-evaluation.** 369 evaluated on the old bar and is not re-run.
- **Non-sampled bars** for S stay as captured. The operator can run an admin backfill of S if needed.
- Lane WATCHLIST; no children.
- Worst case 10 + 300 + 10 s, under the 900 s deadline.
- 369 may ignore all of this.

**What the operator does when the drift rule fires:**
1. Read `SELECT f.*, b.open, b.high, b.low, b.close, b.volume FROM analysis.data_stage_finality f JOIN analysis.symbol_bar b USING (symbol, session_date) WHERE f.session_date=$S AND f.result='drift'`.
2. If drift recurs, raise `data_stage_delay_minutes` (for example 30 → 60).

#### 9.7 Pre-launch staging verification

Run the stage in staging for 3 sessions. The pass condition has two parts:
- the finality table shows 0 `drift` across 3 × 50 samples (`adjusted` and `unavailable` excepted, with `unavailable` < 50%);
- the `BackfillFundamentals` duration is measured (D-54).

Repeat it monthly by querying the same table.

### 10. Hole visibility (D-36)

- WARN `data stage: long hole confirmed` for each run longer than 30 d.
- `holes_confirmed{kind short|long}`.
- `bars_in_window` and `confirmed_gaps` on the coverage record.
- The service docs carry the find query (covered with `bars_in_window < 400`) and the clear statement (`DELETE FROM analysis.symbol_bar_hole WHERE symbol=$X`). `symbol_bar` rows are never deleted by hand.

### 11. Tables (analysis migration 032; no foreign key and no job-table text, D-7)

```sql
CREATE TABLE IF NOT EXISTS analysis.data_stage_runs (
  session_date date PRIMARY KEY, closed_at timestamptz NOT NULL,
  day_start timestamptz NOT NULL, day_end timestamptz NOT NULL,
  delay_minutes integer NOT NULL CHECK (delay_minutes BETWEEN 5 AND 360),
  pass smallint NOT NULL CHECK (pass BETWEEN 1 AND 4),
  pass_created_at timestamptz NOT NULL, done_at timestamptz NULL,
  CHECK (day_end > day_start AND closed_at > day_start AND closed_at < day_end));
CREATE TABLE IF NOT EXISTS analysis.data_stage_users (
  session_date date NOT NULL, user_id text NOT NULL, snapshotted boolean NOT NULL,
  failed_source text NULL CHECK (failed_source IN ('held','watchlist','signals','system_signals','budget')),
  symbol_count integer NOT NULL CHECK (symbol_count >= 0),
  CHECK (snapshotted = (failed_source IS NULL)), PRIMARY KEY (session_date, user_id));
CREATE TABLE IF NOT EXISTS analysis.data_stage_universe (
  session_date date NOT NULL, user_id text NOT NULL, symbol text NOT NULL, held boolean NOT NULL,
  PRIMARY KEY (session_date, user_id, symbol));
CREATE INDEX IF NOT EXISTS idx_data_stage_universe_session_symbol ON analysis.data_stage_universe (session_date, symbol);
CREATE TABLE IF NOT EXISTS analysis.symbol_coverage (
  symbol text NOT NULL, session_date date NOT NULL, run_id text NOT NULL,
  pass smallint NOT NULL CHECK (pass BETWEEN 1 AND 4),
  bar_verdict text NOT NULL CHECK (bar_verdict IN ('covered','no_vendor_data','fetch_failed')),
  fail_reason text NULL CHECK (fail_reason IN ('rpc','symbol','budget')),
  earliest_bar date NULL, latest_bar date NULL,
  bars_in_window integer NULL CHECK (bars_in_window >= 0),
  confirmed_gaps integer NULL CHECK (confirmed_gaps >= 0),
  history_outcome text NULL CHECK (history_outcome IN ('written','empty','skipped','failed')),
  final_outcome text NULL CHECK (final_outcome IN ('written','empty','skipped','failed')),
  fundamentals_state text NOT NULL CHECK (fundamentals_state IN ('fresh','stale','unavailable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((bar_verdict = 'fetch_failed') = (fail_reason IS NOT NULL)),
  CHECK (bar_verdict = 'fetch_failed' OR (final_outcome IN ('written','empty','skipped')
         AND bars_in_window IS NOT NULL AND confirmed_gaps IS NOT NULL)),
  CHECK (bar_verdict <> 'covered' OR (final_outcome = 'written' AND latest_bar = session_date)),
  PRIMARY KEY (symbol, session_date));
CREATE INDEX IF NOT EXISTS idx_symbol_coverage_session ON analysis.symbol_coverage (session_date, bar_verdict);
CREATE TABLE IF NOT EXISTS analysis.symbol_bar (
  symbol text NOT NULL, session_date date NOT NULL, run_id text NOT NULL,
  open double precision NULL, high double precision NULL, low double precision NULL,
  close double precision NULL, volume bigint NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((close IS NULL) = (open IS NULL) AND (close IS NULL) = (high IS NULL)
         AND (close IS NULL) = (low IS NULL) AND (close IS NULL) = (volume IS NULL)),
  PRIMARY KEY (symbol, session_date));
CREATE INDEX IF NOT EXISTS idx_symbol_bar_session ON analysis.symbol_bar (session_date);
CREATE TABLE IF NOT EXISTS analysis.symbol_bar_hole (
  symbol text NOT NULL, first_session date NOT NULL, last_session date NOT NULL,
  confirmed_on date NOT NULL, CHECK (last_session >= first_session), PRIMARY KEY (symbol, first_session));
CREATE TABLE IF NOT EXISTS analysis.symbol_filings_check (
  symbol text PRIMARY KEY, next_check_on date NOT NULL, last_checked_on date NULL,
  last_outcome text NULL CHECK (last_outcome IN ('written','empty','skipped','failed','disabled','error')));
CREATE TABLE IF NOT EXISTS analysis.data_stage_finality (
  session_date date NOT NULL, symbol text NOT NULL,
  result text NOT NULL CHECK (result IN ('match','drift','adjusted','unavailable')),
  open double precision NULL, high double precision NULL, low double precision NULL,
  close double precision NULL, volume bigint NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((result = 'unavailable') = (close IS NULL)),
  CHECK ((close IS NULL) = (open IS NULL) AND (close IS NULL) = (high IS NULL)
         AND (close IS NULL) = (low IS NULL) AND (close IS NULL) = (volume IS NULL)),
  PRIMARY KEY (session_date, symbol));
```

- The down migration drops all eight tables.
- The `symbol_bar` and `data_stage_finality` CHECKs keep the five bar values all set or all NULL.

**Rows per session:**
- 1 run row;
- ≤ 4 universe jobs and ≤ 4·⌈N/500⌉ shards;
- data jobs N + Σ_{p≥2} pending_p, ≤ 4N;
- 1 finality job;
- ≤ 50 finality rows;
- ≈ 11k universe rows and ≤ 10k coverage and bar rows, at the estimated D-13 sizes.

### 12. Config and fixed invariants

**Keys:**

| Key | Type | Default | Reader |
|---|---|---|---|
| `analysis.pipeline.data_stage_enabled` | bool | `true` (`get_bool(…, default=True)`) | `JobGraphSettings.data_stage_enabled()`; seeded by config 062 |
| `analysis.pipeline.data_stage_delay_minutes` | int | 30, bounds [5, 360] | `JobGraphSettings.data_stage_delay_minutes()`, read only by the ensure and frozen on the run row; 062 plus a `SCALAR_BOUNDS_REGISTRY` entry (D-27) |
| `marketdata.fundamentals.snapshot_source` | string | default `vendor` → `edgar` | D-6 |

The finality check adds **no key**.

**Operator-signed invariants:**
- W = 730 d (D-32);
- shard size 500 (D-29);
- fundamentals 190 / 105 / 7 / 28 d and the weekday offset (D-44);
- pass budget 30 min (D-55);
- passes up to 3 more at 30-min spacing (D-41);
- finality check (D-64): sample K = 50; trigger at run done and close + 16 h; price equality 1e-6 relative; volume 1%; adjusted tolerance 0.011 absolute + 1e-4 relative; `return_bars` range cap 7 days.

**Implementation constants, one sign-off item:**
- `PASSES`=4, `PASS_SPACING`=30 min, `FETCH_ATTEMPTS_PER_PASS`=2.
- Ask and pass-check period 60 s; ask timeout 2 s.
- Call timeouts: coverage 30 s, `BackfillBars` 120 s, `GetHistoricalFundamentals` 10 s, `BackfillFundamentals` 120 s, snapshot page 10 s, universe read budget 300 s.
- DB budgets: ensure 5 s, owners/N/slice 5 s, data steps 10 s, snapshot and retention blocks 30 s.
- Snapshot block 5,000 rows; fundamentals page 50.
- Retention: batch 5,000, self-stop 120 s, horizons max(30, `retention_days`) / 730 / 365 d; long hole > 30 d.
- Coverage end 16:00Z; permanent code set {INVALID_ARGUMENT}.
- Finality job: per-call timeout 30 s; job budget 300 s.
- Moved unchanged: drain caps 50 × 1,000.

### 13. FR-7 default flip (D-6, D-15), unchanged

- `snapshotSource()` default and unknown-value fallback become edgar (`marketdata_service.go:2036-2053`); about 40 tests pinned with `cfg.strings`.
- Config 062: `UPDATE … SET default_value='edgar' WHERE default_value='vendor'` with the 041 audit row; `value_data` untouched; guarded down; seed test.
- Regenerate `scripts/config-wiring-stored.json`; update `scripts/config-heal/catalog.tsv`; the three docs.
- The twelve promoted scenarios get Given `snapshot_source is "vendor"`.

### 14. Side effects, ledger suppression, FR-11 wording

**Ledger suppression (D-43, D-48).**
- Grant `{callerID: "analysis-data-stage", rpc: "BackfillBars.ledger_quiet", peerSAN: "xstockstrat-analysis"}` (`internal/service/authz.go:26-29`).
- `BackfillBars` skips the started, completed and failed events (`:1578`, `:1625-1633`) when quiet.
- The stage appends the header on every `BackfillBars` call, including the finality re-fetch, and on nothing else.
- Metrics and logs remain. Ingest-driven backfills are unchanged.

**Effects per day, 1k / 10k symbols (estimates):**

| Effect | 1k | 10k |
|---|---|---|
| Alpaca bar requests | ≈ 1.1k + 50 | ≈ 11k + 50 |
| Coverage reads | ≈ 1.1–2k | ≈ 11–20k |
| Backfill ledger events | 0 | 0 |
| EDGAR calls (peak) | ≈ 113 | ≈ 1,130 |

No warm-set change, no ingest job and no snapshot quota (D-23).

**FR-11 wording:** "…removes no loop and changes no analysis RPC response. Its externally visible effects are:
- post-close daily bars and filled history in marketdata, including a next-morning re-fetch of at most 50 session bars;
- newly stored filings and the EDGAR snapshot refresh they cause;
- FR-7;
- Alpaca and SEC requests;
- marketdata backfill metrics and logs (no ledger events);
- fundamentals-backfill failure logs for non-filers;
- once per strategy owner who never had one, the system signal list portfolio creates on a first watchlist read."

C-14 stays **None**: no notify alert is emitted (D-63) and no UI or agent surface changes.

### 15. Telemetry (D-24, D-34, D-42)

No symbol, user or run labels (R-4).

| Instrument | Labels | Recorded when |
|---|---|---|
| `analysis.data_stage.symbols` | `verdict` covered\|no_vendor_data\|fetch_failed | a coverage row is inserted |
| `…fundamentals` | `state` | a coverage row is inserted |
| `…backfills` | `kind` history\|final, `outcome` | a coverage row is inserted |
| `…filings` | `outcome` | a call was committed |
| `…snapshot_users` | `outcome` ok\|failed | after the marker block |
| `…holes_confirmed` | `kind` | per run written |
| `…fetch_deferred` | `reason` rpc\|symbol\|budget | a pass 1–3 defer |
| `…finality` | `result` match\|drift\|adjusted\|unavailable | a finality row is committed |

There is no `passes` counter (D-53).

**Logs:**
- INFO: `data stage pass started`, `data stage run done`, `data stage job superseded`;
- WARN: `data stage finality drift`, `data stage finality unavailable`, `data stage: long hole confirmed`.

The authoritative counts are SQL on the tables.

### 16. Identity (D-18)

- `SYSTEM_READ_META` moves from `live_loop.py:78` to `app/identity.py`.
- Owner reads use `owner_metadata(u)` + trace.
- System signals and every marketdata call use `SYSTEM_READ_META` + trace. `BackfillBars` also carries the appended `analysis-data-stage` caller.
- One trace per attempt and per ask.
- `tests/test_owner_header_guard.py` gains the snapshot path.

### 17. Seam for feature 369 (D-57)

**369 may rely on:**
- At most one bar record per `(symbol, S)`, inserted once together with `covered` and satisfying §9.1.
- An immutable snapshot whose `data_stage_users` rows name the users not snapshotted.
- **Run done** = `SELECT done_at IS NOT NULL FROM analysis.data_stage_runs WHERE session_date=$S`, set once no further pass will run. After it, no data-stage job creates a coverage or bar record for S, because a requeued job is superseded under the row lock (§6 step 9, D-62).
- `bar_verdict`, which tells `fetch_failed` from `no_vendor_data`.

**369 must not assume:**
- that done implies a snapshot exists (the universe job died in every pass);
- that every snapshot symbol gets a record;
- that a `fetch_failed` symbol ever gets a bar record for that session. The next run's history call repairs the stored bars, but the old session keeps no bar record.
- that stored OHLC never changes. The captured columns on `symbol_bar` are what the vendor returned at stage time, not necessarily what marketdata stores later. They exist only for the finality check and are not a price source: read prices from marketdata.
- that every session has a run, or that every run reaches done;
- that any job state is a barrier.

**Other points:**
- Reading bars through `GetBars`/`BatchGetBars`/`BatchGetLatestPrice` makes the symbol warm.
- 369 may ignore `data_stage_finality`.

### 18. Changes to the 367 runtime (D-39)

1. `ensures=()` plus the loop in `maintenance_tick` (`job_graph.py:715-728`).
2. Two `JobGraphSettings` accessors.
3. `build_registry(settings, *, marketdata=None, portfolio=None, ingest=None)` (`app/jobs/__init__.py:7`); the stage kinds are registered only when the stubs are given.
4. One shared repository instance.

The repository SQL and the contract test are unchanged. Outside the runtime: the ensure receives `db_pool`; `_drain_positions_paged` gains `timeout`; `app/identity.py`; `universe_reads.py`.

### 19. Load and timing

**Analysis DB.** `job.db(B)` bounds the gate wait and the transaction separately (`job_graph.py:314-315`, `:341-347`), so one block takes ≤ 2B.

**Universe round-0 bound (O-41).** Worst case:
- retention ≤ 120 s plus one overrunning block (60 s) = 180 s;
- marker check 10 s; owners 10 s; reads 300 s; N 10 s;
- snapshot blocks 60 s each.

That is 900 − 510 = 390 s for snapshot blocks, which allows ≤ 6 blocks: 5 data blocks + the marker.
- **Guaranteed in one attempt:** ≤ 25,000 snapshot rows. The D-13 estimate of 11,000 rows needs 4 blocks.
- **Tested:** 100,000 rows (`real_pg`). Typical blocks are far below 30 s (estimate ≤ 1 s for 5,000 rows).
- **Above what fits:** the attempt hits the 900 s deadline and retries, and block 1 clears the partial rows. If it keeps failing, the universe job dies, the marker stays absent, each later pass retries, and the run is done after pass 4 with no snapshot. That is loud: a dead job and no `snapshot_users` points. Cross-attempt snapshot writes are not part of this design (C-18).

**Control lane.** About 1.3 transactions per symbol and pass (≈ 2.6 when failing, ≈ 3 for a budget defer). `list_by_run` runs ≤ once a minute.

**Marketdata pool and locks (O-41).**
- **Pool.** Marketdata's client pool is 2 connections per instance (`marketdata.db.pool.*` gauges), so ≤ 2 bar scans or inserts run per marketdata instance. Across M instances that is ≤ min(2M, PgBouncer 5) at once.
- **Locks.** A 730-day scan touches ≈ 2,420 locks, so 5 × 2,420 = 12,100 ≤ 25,600 (`docs/runbooks/ohlcv-lock-budget-tuning.md:47-63`). This assumes plan-time chunk exclusion.
- **Queueing.** A stage running 4·A slots puts at most 4·A DB operations in front of interactive `GetBars` reads, served 2 at a time. The added wait is ≈ (stage operations queued / 2) × operation time; with about 4 queued and ≈ 100 ms each (estimate), that is ≈ 200 ms during the drain. Most slot time is spent in Alpaca calls, not the DB.
- **Watch** `marketdata.db.pool.empty_acquire_wait`. The lever is `pipeline.worker_concurrency`.

**Drain per plan** (estimates; 4 slots, 1 instance): 200/min → ≈ 5.5 min (1k) and ≈ 55 min (10k), split by the budget across passes 1–2 (§7). 10,000/min → ≈ 2 min and ≈ 21 min.

**Finality:** 50 requests a day in the WATCHLIST lane; worst case 20 + 300 + 20 = 340 s, under the 900 s deadline.

### 20. Spec and scenario amendments (IDs append-only)

#### FRs

- **FR-2:** "one data job per symbol, session and pass, keyed by symbol and `S#p`"; re-enqueuing the same symbol, session and pass creates no second job.
- **FR-4:** the data job calls `BackfillBars` itself: S first, then gaps-only history (D-30, D-56).
- **FR-5:**
  - three verdicts;
  - a fetch failure is retried in later passes;
  - `fetch_failed` (reason rpc | symbol | budget) is written only on the last pass;
  - the dead-letter state is kept for real defects.
- **FR-6:** the state comes from stored filings (D-31), with the D-44 cadence.
- **FR-8:** "…Re-running the job for the same symbol and session leaves the existing record unchanged and creates no second one." This matches D-34.
- **FR-10:** the gate is fixed per run, in database time.
- **FR-11:** the §14 wording.
- **FR-12:** adds `fetch_failed`, `fetch_deferred` and the finality results.
- **FR-13 (new), automated vendor-finality check:** "For a session whose run is done, while the stage is enabled and analysis runs between 16 hours after the close and the next close, the stage re-fetches the session's daily bar for a deterministic sample of at most 50 covered symbols. It compares that bar with the bar the vendor returned at stage time and records `match`, `drift`, `adjusted` or `unavailable` per symbol, and counts each result in telemetry. The check changes no verdict, coverage record or bar record, marks no symbol warm, appends no ledger event and emits no alert to users."
- **Affected Services:** marketdata gains the RPC (4 fields), `return_bars`, the quiet grant and the default flip. Ingest and portfolio are read only, with no code change. Notify is not involved.

#### Amended scenarios

- **@AC-1:** Given u1 owns a strategy.
- **@AC-3:** u1's watchlist read fails on every attempt → on attempt 5, u2's rows are written and u1 is `snapshotted=false` with `failed_source` watchlist.
- **@AC-4:** Then exactly 1 data job exists for MSFT with epoch `2026-11-27#1`.
- **@AC-6:** Then the final fetch returned written, one coverage read, no history call, and the bar record carries the fetched close.
- **@AC-7, @AC-8:** a history call covering 2026-11-25..26, or 2026-11-23.
- **@AC-9:** the final and history calls are both `EMPTY`.
- **@AC-10:** Given every `BackfillBars` for NVDA fails UNAVAILABLE → after 4 passes the record is `fetch_failed` (rpc), with no bar record and no hole, and every NVDA data job succeeded.
- **@AC-11:** Given AAPL's check row is due on 2026-11-27 and MSFT has no row with a newest period 30 days old → a call for AAPL only; MSFT gets `next_check_on = shift(P+105)`.
- **@AC-12:** Given AAPL is covered, due, its period ended 2026-08-10, and the call fails → covered, `fresh`, next = `shift(2026-12-04)`.
- **@AC-18:** already-created jobs run to completion.
- **@AC-20:** counts come from the coverage table.
- **@AC-22:** Given history disabled and TSM's period is 200 days old → `stale`, `disabled`, next = `shift(S+7)`.
- **@AC-23:** final `SKIPPED`.

#### New scenarios, part 1

- **@AC-24:** a confirmed hole is not fetched again and the symbol is covered.
- **@AC-25:** a forming S bar whose final fetch returns `EMPTY` is not covered.
- **@AC-26:** no run row exists before close + delay.
- **@AC-27:** a due filing is checked at most once per 7 days.
- **@AC-28:** a symbol with no filings is checked at most once per 28 days and reads `unavailable`.
- **@AC-29:** a user without strategies is not snapshotted.
- **@AC-30:** a system-scope signal is in every snapshotted user's universe.
- **@AC-31:** an empty universe succeeds with no data jobs.
- **@AC-32:** the live-loop page-cap drain is unchanged (no failure counted, same symbols).
- **@AC-33:** a replay after a committed `no_vendor_data` starts no second backfill.
- **@AC-34:** 1,200 symbols → 3 shards, each with at most 500 data jobs.
- **@AC-35:** a dead data job does not stop its siblings.
- **@AC-36:** session rows older than max(30, `retention_days`) days are pruned, including finality rows.
- **@AC-37 (marketdata):** `GetLastClosedSession` at 16:15 New York on 2026-11-27 returns `2026-11-27` with `closed_at` 21:00Z, `day_start` 05:00Z and `day_end` 2026-11-28 04:59:59Z.
- **@AC-38 fixed gate:** a run is created at 16:30 with delay 30; the delay key is set to 120 at 16:40 → the run row keeps `closed_at` 16:00 New York and `delay_minutes` 30, and no data job fails.
- **@AC-39 missed session:** Given analysis is down from 2026-11-25 15:00 NY to 2026-11-27 17:00 NY, delay 30, and NVDA's latest bar is 2026-11-24 with vendor bars 11-25..27 → no run row for 11-25, a run row for 11-27, and NVDA's history call covers 2026-11-25.
- **@AC-40 switch at round 0:** a pass-1 universe job exists and the switch turns false → it succeeds with no snapshot and no shards.
- **@AC-41 marker reuse:** the marker exists and the universe job is requeued → no portfolio or ingest read, the same shards, the snapshot unchanged.
- **@AC-42 long hole:** the vendor has no TINY bars 2026-09-01..10-30 → WARN `long hole confirmed`, `holes_confirmed{long}` +1, `confirmed_gaps` 1.
- **@AC-43 half day:** 2026-11-27 closes at 13:00 → the run row is created at 16:30 New York.
- **@AC-44 non-last attempt:** u1's watchlist read fails on attempt 1 of 5 → nothing is written and the attempt is retried.
- **@AC-45 retry pass:** Given delay 30, spacing 30, max_attempts 5, NVDA in the snapshot, and every marketdata call UNAVAILABLE from 16:25 to 17:05 NY → passes 1 (16:30) and 2 (17:00) write no NVDA record, pass 3 (17:30) records `covered`, and `done_at` is set.
- **@AC-46 deferred:** pass 1 of 4, NVDA's fetch fails on attempts 1 and 2 → the job succeeds and writes nothing; pass 2 creates a data job only for NVDA.
- **@AC-47 dead retried:** NVDA's pass-1 job is dead → pass 2 runs NVDA under epoch `2026-11-27#2`.
- **@AC-48 (marketdata) no ledger events:** a `BackfillBars` call carrying the `analysis-data-stage` caller from SAN `xstockstrat-analysis` appends no `marketdata.backfill.*` event; a call without it appends started and completed.
- **@AC-49** is unused.
- **@AC-50 run done:** all 4 passes finished with ZZZZ's job dead in pass 4 → `done_at` is set and ZZZZ has no record.

#### New scenarios, part 2

- **@AC-51 match:** run 11-27 done; AAPL sampled with a captured bar; at 2026-11-28 08:00 NY the vendor returns an identical bar → `match`; the drift counter does not move.
- **@AC-52 drift:** AAPL and MSFT sampled; AAPL's close changes from 190.00 to 190.40 and MSFT's volume rises 5% → two `drift` rows, `finality{result=drift}` +2, no notify alert, and the coverage and bar records unchanged.
- **@AC-53 adjusted:** the vendor returns O/H/L/C all × 0.5 with volume × 2 (a 2:1 split) → `adjusted`; a 3.00 stock rescaled by 0.995 and cent-rounded with unchanged volume → `adjusted`; neither counts as drift.
- **@AC-54 unavailable:** marketdata is unavailable at 08:00 → 50 `unavailable` rows, the job succeeds, nothing counts as drift, one WARN.
- **@AC-55 trigger:** two instances; the run is done; 2026-11-28 07:59 NY → no finality job; at 08:00 → exactly one. An undone run or switch off → none.
- **@AC-56 no warm:** the finality job and the data jobs call no `GetBars`, `BatchGetBars`, `GetLatestQuote(s)`, `GetLatestPrice` or `BatchGetLatestPrice`.
- **@AC-57 sample bound:** 1,200 covered symbols → exactly 50 are sampled, and a replay samples the same 50 and writes no second row.
- **@AC-58 (marketdata) `return_bars`:** a one-day call with `return_bars` returns the written bar; without it, `bars` is empty; a 10-day range with `return_bars` → INVALID_ARGUMENT.
- **@AC-59 budget defer:** pass 1 created 16:30; NVDA's attempt starts 17:01 → no marketdata call, nothing written, `fetch_deferred{budget}` +1, and pass 2 creates a data job for NVDA.
- **@AC-60 budget, last pass:** a pass-4 NVDA attempt starts 31 min after pass 4 began → a `fetch_failed` record with reason `budget` and `fundamentals_state` `unavailable`, and no marketdata call.
- **@AC-61 abandoned run:** the 11-25 run is at pass 2 with `done_at` NULL and the last closed session becomes 11-27 → a run row for 11-27, no pass 3 for 11-25, and 11-25's `done_at` stays NULL.
- **@AC-62 budget source:** on the last attempt, u1's position pages stall until the 300 s read budget expires → u1 `snapshotted=false` with `failed_source='budget'`; u2 is snapshotted.
- **@AC-63 superseded:** after `done_at`, an operator requeues NVDA's pass-2 job → it succeeds with no call and no record.
- **@AC-64 done at once:** pass 1 records every symbol → `done_at` is set within 65 s of pass 1 finishing, before 30 min.
- **@AC-65 lost pass:** the run row is at pass 2 and no job row exists for `data_stage:S#2` → the ensure enqueues the pass-2 universe job.
- **@AC-66 conflict:** two data jobs race for AAPL → one coverage row, and the loser changes no hole or filings row.

### 21. Affected services, proto and migration touchpoints

**Proto (additive; `buf breaking` passes):**
- `GetLastClosedSession` plus its two messages;
- `BackfillBarsRequest.return_bars = 6`;
- `BackfillBarsResponse.bars = 5` (repeated `Bar`).

**Marketdata:**
- the RPC and the `Close` export;
- `return_bars` with the 7-day cap;
- the quiet grant;
- the FR-7 flip and the docs (the Ledger Events table exception).

**Analysis:**
- `data_stage_ensure.py`, `app/jobs/data_stage.py` (four handlers), `universe_reads.py`, `app/identity.py`;
- `build_registry`, the settings accessors, `app/main.py`.

**Migrations:** config `062` (two keys and the default) and analysis `032` (eight tables).

**Ingest, portfolio, notify:** no code change.

### 22. Test strategy

**Unit** (virtual clocks, in-memory repository):
- the ensure: database-time gate; pass check from the enqueue; done at once; the spacing CAS; the re-read after a non-matching CAS; re-enqueue on zero rows; the switch gating only creations; the finality trigger at +16 h, once;
- the data job: order and verdict; the fetch matrix (attempt × pass × reason incl. `budget`); superseded;
- the finality classifier table: match; a close-only change with volume +2% → drift; a 2:1 split → adjusted; a 3.00 stock × 0.995 cent-rounded with unchanged volume → adjusted; unavailable;
- the `shift` weekday mapping;
- the D-21 regression; `timeout=None`.

**Contract:**
- the handler contract covers the new modules;
- the header guard;
- a marketdata-stub allowlist test (@AC-56).

**`real_pg`:**
- 100k-row snapshot; marker reuse; retention self-stop;
- the D-37 replace; the D-52 conflict;
- a 500-child park;
- end-to-end with 2,000 symbols over a 4-pass outage;
- the finality sample determinism;
- two ensures racing the CAS;
- the 032 text against `conftest.py:519-525`.

**Go:**
- the RPC table (DST Sunday);
- `return_bars` (set, unset, cap);
- quiet suppression;
- the FR-7 pins.

**Config:** 062 and the wiring check.

**Acceptance:** a step for each amended or new @AC.

**Staging:** §9.7.

### 23. Assumptions and open risks

**Assumptions:**
1. The managed database clock is NTP-accurate.
2. Daily bars are stamped 00:00 NY, inside `[day_start, day_end]`.
3. The Alpaca source fills `Bar.symbol` (needed to map `return_bars` results).
4. Plan-time chunk exclusion holds.
5. About 30% of symbols are non-filers, and a companyfacts file is 3–5 MB.
6. Tail-gap symbols are ≤ 1%.
7. Control throughput is ≈ 50 transactions/s and t ≈ 0.5 s per symbol (estimates behind §7 and §19).
8. 16 h after the close is late enough for the vendor's corrections. The check measures exactly this.
9. Marketdata is deployed before analysis, so `return_bars` is honoured. Before that, captures are NULL and those rows are excluded from the sample.

**Open risks:**
- Drift on non-sampled symbols is detected only statistically (§9.4).
- `adjusted` shows that a corporate action has rewritten history. Stored bars outside the re-fetched ranges keep the old adjustment basis. This is a pre-existing platform matter, made visible here.
- Above the throughput ceiling (§7), symbols reach `fetch_failed{budget}` every day.
- The shared Alpaca budget is busy for ≈ 1 h at 10k symbols on the 200/min plan.
- SEC volume in the first week and at peak.
- An unmodelled closure.
- An abandoned run.
- A finality check is missed when analysis is down from close + 16 h until the next close.
- The drift alert rule lives in Grafana, outside the repo's tests.
- A vendor correction that rescales O/H/L/C uniformly with unchanged volume reads as `adjusted`.

## Rejected Alternatives

- `R-1` Port the trading calendar to Python — rejected because: Second hand-maintained holiday table; breaks FR-10 and the DRY guard rail.
- `R-2` Derive the last closed session from `GetDataCoverage` on a sentinel symbol — rejected because: Answers about a symbol, not the calendar; treats the session as closed from 16:00 (`timeframe.go:108-111`).
- `R-3` One batched admin multi-symbol backfill job per session — rejected because: Widens what a background job may do, loses per-symbol dedup, one `FAILED` job hits many symbols (ingest `servicer.py:589-590`).
- `R-4` A `run_id` label on telemetry — rejected because: Identifier label; breaks platform 294 `@AC-41`.
- `R-5` The backfill child returns `Verdict("no_vendor_data")` — rejected because: Blocks the data job for good (367 `@AC-9`), so nobody can write the coverage record FR-8 requires.
- `R-6` Drive the backfill through ingest's self-serve path under a universe member's identity — rejected because: Attributes ledger events to a user who asked for nothing, raises untargeted alerts, needs polling (O-2, O-7). Operator chose D-9.
- `R-7` A SAN-bound `system` grant on ingest `TriggerBackfill` — rejected because: Ingest change, a CHANGE to 343 `@AC-15`, and polling of an asynchronous job. Operator chose D-9.
- `R-8` Start the run after New York midnight — rejected because: Results and later alerts would arrive overnight. Operator chose D-11.
- `R-9` Strict FR-3: any interior hole blocks coverage — rejected because: Excludes illiquid and halted symbols for about two years on the IEX feed. Operator chose D-10.
- `R-10` Snapshot every user through a new cross-user owner read — rejected because: Adds a service, proto and grant change for users who have nothing to evaluate. Operator chose D-13.
- `R-11` Exclude system-scope signals from the universe — rejected because: Diverges from what the live loop covers, which 369 compares against. Operator chose D-14.
- `R-12` Fundamentals: re-derive only, defer new filings to program feature 6 — rejected because: Operator chose D-12.
- `R-13` The universe job enqueues data jobs directly instead of parking on them — rejected because: Handlers cannot enqueue, and run id and lane are inherited only through a park; it would need a new 367 primitive (analysis `tests/test_job_handler_contract.py:67-68`; `app/repositories/pipeline_jobs.py:101-108`).
- `R-14` A fetch child under every data job — rejected because: Doubles job rows and control-lane work and needs an outcome-passing table, for no isolation gain (O-30). Operator chose D-30.
- `R-15` One universe job parking directly on every data job — rejected because: Fails the whole session permanently above 10,000 symbols. Operator chose D-29.
- `R-16` The fundamentals state reflects the served snapshot (`GetFundamentals` per symbol) — rejected because: Spends vendor quota while production is on `vendor` and marks the whole universe warm. Operator chose D-31.
- `R-17` The history window follows `analysis.backtest.max_range_days` — rejected because: Raising the backtest key would silently enlarge every daily fetch. Operator chose D-32.
- `R-18` Outage recovery by a documented manual requeue only — rejected because: An outage would need an operator before 369 can evaluate the session. Operator chose D-41.
- `R-19` A fetch that keeps failing ends in the dead-letter state (FR-5 as first written) — rejected because: A daily-failing symbol blocks the run every day and hides real outages. Operator chose D-42.
- `R-20` Accept the backfill ledger events of stage calls — rejected because: About 2,200 to 22,000 append-only rows a day. Operator chose D-43.
- `R-21` Fundamentals thresholds and intervals as config keys — rejected because: Operator signed them as fixed invariants (D-44).
- `R-22` An in-memory outage breaker per instance — rejected because: Watches the wrong signal, resets on restart and can misfire under load (O-39). Operator chose D-55.
- `R-23` No bound on a slow outage — rejected because: Passes and the done signal would slip to the next morning. Operator chose D-55.
- `R-24` Vendor finality as a documented risk with a manual staging comparison only — rejected because: Operator requires an automated check (D-58).
- `R-25` Capturing the stage-time bar through a bars read RPC, a new stored-bar RPC or a no-warm flag on `GetBars` — rejected because: Every bars and quotes read marks the symbol warm; a new RPC or a second path through the warm logic is more than an additive response field (D-59).
- `R-26` An untargeted notify alert on drift — rejected because: Listed in every signed-in user's alert list (`services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:254`), which would make the feature user-visible. Operator chose D-63.
- `R-27` A notify alert targeted at each admin through identity — rejected because: Adds an analysis-to-identity connection, a grant and an env var. Operator chose D-63.

## Open Risks

- [ ] Vendor finality is measured, not proven: drift on symbols outside the daily sample of 50 is detected only statistically, and a uniform rescale with unchanged volume reads as `adjusted` — observed through the finality table and the Grafana rule; revisit after the staging verification step.
- [ ] The drift alert rule lives in Grafana, outside the repo's tests — the docs step ships its definition; creating it is a launch checklist item.
- [ ] Above the throughput ceiling of §7 (about 21,800 symbols a day on the 200 requests a minute vendor plan) symbols reach `fetch_failed{budget}` every day — watch `fetch_deferred{reason=budget}`; the lever is `pipeline.worker_concurrency` or the vendor plan.
- [ ] The bar vendor's budget is shared with marketdata's warm poller and ingester for about an hour at 10,000 symbols on the slowest plan — measured in feature 369's shadow run.
- [ ] `BackfillFundamentals` duration is unmeasured and the first week downloads company facts for the whole universe — measured in the staging verification step; a per-run call cap is the lever (D-54).
- [ ] An NYSE closure missing from `marketsession` makes one session `no_vendor_data` for every symbol — existing closure-table maintenance rule.
- [ ] A session whose close + delay passes while analysis is down gets no run, a run still undone when the next session closes is abandoned, and a finality check is missed if analysis is down from close + 16 h to the next close — feature 369 must tolerate all three (§17).
- [ ] A symbol whose fetch failed on every pass has no bar record for that session, and once a run is done its records cannot be repaired by requeueing (D-65) — documented in the service docs step.
- [ ] A user's universe larger than the snapshot bound of §19 (25,000 rows guaranteed per attempt) kills the universe job for that session — loud (dead job, no snapshot rows); revisit if the D-13 sizing is exceeded.
- [ ] Portfolio creates the system signal watchlist once for a strategy owner who never read their watchlists — accepted side effect, listed in FR-11.

## Constitution Rules Touched

- `C-03` / PLAT-4 — honored by: every outbound call carries the owner's identity or the system-read identity plus a fresh trace id (§16, D-18); the header-guard test gains the snapshot path.
- `C-04` — honored by: no new closed-set string in proto; the new fields are a bool, a repeated `Bar` and timestamps; the session date is a string by the `common.proto` precedent (D-4).
- `C-05` — honored by: two new keys in namespace `analysis`, stored namespace-relative, seeded by config `062`; the changed default on `marketdata` / `fundamentals.snapshot_source` updates `default_value` only (D-6, D-27).
- `C-07` — honored by: analysis `032` and config `062`, each the next number, up and down pairs; numbers re-derived at execute time.
- `C-08` / `P-06` — honored by: the test strategy of §22 pairs every service change with tests, red before green.
- `C-09` — honored by: additive proto only (`GetLastClosedSession`, `return_bars`, `bars`); `buf lint`, `buf breaking`, `./scripts/buf-gen.sh`.
- `C-10` — honored by: no value is surfaced through a duplicated read path; the legacy drains keep their behaviour through wrappers with a regression test (D-21).
- `C-11` / `P-03` — honored by: every assumption is listed in §23; every product fork went to the operator at a gate and is recorded in context.md.
- `C-13` — honored by: test doubles come from analysis `tests/conftest.py` and marketdata `internal/testdata`.
- `C-14` — honored by: Consumer Surface stays "None"; no notify alert is emitted (D-63); the user-facing view is deferred to the named follow-up `pipeline-cutover`.
- `C-15` — honored by: §20 lists every amended and new `@AC`; IDs are append-only and each FR-1 to FR-13 is covered.
- `C-16` — honored by: see Business Rules Touched; the one CHANGE (twelve marketdata scenarios pinned to `vendor`) is operator-signed (D-15).
- `C-18` — honored by: no fetch child (D-30), no breaker (R-22), no `passes` counter and no stored `not_before` (D-53), no second calendar (R-1), no third drain copy (D-21), fixed invariants instead of keys where the operator signed them (D-32, D-44, D-64).
- `P-01` / `P-02` — honored by: the orchestrator wrote every file and mediated every round.
- `P-04` / `P-05` — honored by: each gate decision is recorded in context.md and debate.md as it was taken.
- `F-01` — honored by: no applied migration is edited; config `030` stays as it is and `062` updates the row.
- `F-04` — honored by: every path and symbol comes from recon or a verified round; new files are named as new.
- `F-06` — honored by: no new database pool; handlers use `job.db` on the service pool, the ensure uses the same pool through `bounded_txn`, the job repository keeps its control pool (§2, §19).
- `F-07` — honored by: tunables are config keys; every other constant is a fixed invariant listed in §12, the product-relevant ones signed by the operator (D-29, D-32, D-41, D-44, D-55, D-64) and the implementation constants presented as one sign-off item at the approval gate.
- `F-11` — honored by: no Floor breach was flagged in any of the five rounds.

## Business Rules Touched (C-16)

- PRESERVE `@AC-1 @AC-2 @AC-3 @AC-4 @feature-367` enqueue idempotency, fenced lease, takeover, stale-report rejection (`services/xstockstrat-analysis/acceptance/pipeline-job-graph.feature`) — not regressed by: the stage uses the existing enqueue and park; one universe job per session and pass.
- PRESERVE `@AC-5 @AC-6 @AC-7 @feature-367` retry, permanent failure, dead after `max_attempts` — not regressed by: fetch failures never reach the dead-letter state (D-42, D-46); real defects still do.
- PRESERVE `@AC-8 @AC-9 @feature-367` park and unsatisfiable child — not regressed by: no handler returns a `Verdict` (R-5); a data job has no child (D-30).
- PRESERVE `@AC-10 @AC-12 @AC-13 @AC-18 @feature-367` lane order, retention, queue metrics — not regressed by: held symbols run in the `held` lane; the finality job in the lowest lane; job rows are pruned by 367 unchanged.
- EXTEND `@AC-11 @feature-367` "Jobs are grouped by universe run" — new case added: data-stage jobs carry `data_stage:S#p`.
- EXTEND `@AC-15 @feature-367` "The daily prune runs once across instances" — new case added: one run row and one universe job per session and pass across instances.
- PRESERVE `@AC-14 @AC-16 @AC-17 @feature-367` kill-switch scenarios — not regressed by: `worker_enabled=false` skips the ensures; `data_stage_enabled` only gates creation (D-17).
- PRESERVE `@FR-2 @regression @feature-367` boot tasks through `spawn`, `@FR-8 @regression @feature-367` `host.provider` — not regressed by: no new boot task; new instruments use the existing wrappers.
- EXTEND `@FR-9 @regression @feature-367` pipeline keys seeded (`services/xstockstrat-config/acceptance/pipeline-job-graph.feature`) — new case added: `pipeline.data_stage_enabled`, `pipeline.data_stage_delay_minutes`.
- EXTEND `@AC-14 @feature-295`; PRESERVE `@AC-24 @AC-29 @feature-295` (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature`) — not regressed by: `062` changes `default_value` only and leaves every stored value.
- CHANGE `@AC-1 @AC-2 @AC-3 @AC-5 @AC-6 @AC-9 @feature-255`, `@AC-2 @AC-4 @feature-340`, `@AC-1 @AC-2 @AC-5 @AC-7 @feature-254` (marketdata suites) — altered: an explicit Given `snapshot_source is "vendor"`, outcomes unchanged; signed off by user @ 2026-11-28T06:40Z (context.md, D-15).
- PRESERVE `@AC-4 @AC-10 @feature-255`, `@AC-4 @AC-10 @feature-231`, `@AC-7 @feature-215`, `@AC-6 @AC-7 @feature-211` — not regressed by: they set the source explicitly; the stage calls no snapshot RPC (D-23).
- PRESERVE `@AC-1 @AC-2 @AC-3 @AC-4 @feature-364`, `@AC-7 @AC-15 @feature-343`, `@AC-2 @AC-3 @feature-261` (ingest suites) — not regressed by: ingest is not in the bar path (D-30); no grant or envelope changes (R-6, R-7).
- PRESERVE `@AC-9 @AC-11 @AC-23 @AC-26 @feature-352` (marketdata), `@AC-7 @AC-10 @feature-352` (portfolio) — not regressed by: a flagged symbol's `SKIPPED` outcome maps to `no_vendor_data`; nothing is removed from a user's list.
- PRESERVE `@AC-1 @AC-2 @feature-154` (portfolio) — not regressed by: no new portfolio RPC or grant (D-13, R-10).
- PRESERVE `@AC-1 … @AC-10 @feature-356`, `@AC-2 @feature-180` (analysis) — not regressed by: the drains are extracted, the legacy wrappers behave as today, pinned by a regression test (D-21, D-49).
- PRESERVE `@AC-3 … @AC-9 @feature-154`, `@AC-1 @AC-2 @AC-3 @AC-7 @AC-8 @AC-9 @feature-158`, `@AC-1 … @AC-4 @feature-259` (analysis) — not regressed by: no existing loop is changed or removed.
- PRESERVE `@AC-7 @AC-41 @feature-294`, `@AC-3 @feature-337`, `@AC-36 @feature-279` (`docs/sdd/business-rules/platform.feature`) — not regressed by: no new loop name, no symbol, user or run label (R-4), `host.provider` on every instrument, no new pool.
