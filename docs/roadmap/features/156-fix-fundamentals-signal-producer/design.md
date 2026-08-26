# Design: fix-fundamentals-signal-producer

**Created**: 2026-08-25
**Rounds**: 2 (quick mode + one operator-steered expansion round; termination: approved)
**Approved by**: user @ 2026-08-25 (operator steer + gate answers recorded in context.md)
**Grounded in**: recon.md

---

## Chosen Approach

Fix the boot-timing bug with a **durable, crash-safe schedule row** for the fundamentals producer,
plus **startup jitter**, and surface the **already-existing** `RunFundamentalsScan` admin RPC through
a new **MCP agent tool** and a new **UI control**. Scope spans three services (analysis, agent, ui),
one new migration, and two new config keys. This is an operator-expanded scope beyond the original
Track-C bug fix (recorded in context.md per principle #2 / C-11).

### 1. Durable schedule (analysis) — the core fix

- **Migration `019_fundsignal_schedule`** creates `analysis.fundsignal_schedule (job_name TEXT PRIMARY
  KEY, blocked_until_ms BIGINT NOT NULL, process_name TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT
  now())`. New numbered migration (highest applied is `018_backtest_runs_fill_model`, so `019` is free
  — F-01/C-07 honored). Style mirrors `migrations/016_...up.sql:1-5` header + `003_fundsignal_runs.down.sql`
  down. Reuses the loop's existing `self._db` pool — **no new pool, budget stays 2** (F-06).
- **Semantics — write-after-completion, never a pre-run lease.** `blocked_until_ms` is "no scheduled
  run before this epoch-ms" (the next-due time). It is advanced **only after** a cycle finishes, never
  before it runs. This is the crash-safety property the round-2 adversary required: a hard crash
  (OOM/SIGKILL/redeploy) mid-run leaves `blocked_until_ms` at its old (past) value, so the restarted
  process is immediately due and re-runs promptly — instead of the rejected CAS-lease design, which
  set `blocked_until_ms = now + LEASE_HOLD` *before* running and wedged a crashed schedule ~1h.
- **`process_name`** (`os.environ.get("HOSTNAME") or socket.gethostname()`) records the last runner —
  a **diagnostic** column (and a forward-looking fence field if analysis ever scales past one
  instance). It is **not** load-bearing today: analysis is `instance_count: 1` (`.do/app.yaml:219`,
  `.do/app.dev.yaml:219`) and the in-process `asyncio.Lock` (`fundsignal_loop.py:79`) already prevents
  overlap. Kept per explicit operator request; the design does not rely on it for correctness.
- **`run_forever` rewrite** (`fundsignal_loop.py:96-110`), extracting a testable seam:
  - At boot: self-seed the row with `INSERT INTO analysis.fundsignal_schedule (job_name,
    blocked_until_ms) VALUES ('fundsignal', 0) ON CONFLICT DO NOTHING` (mirrors the
    `ledger_stream_cursor` runtime self-seed, `pnl_pattern_consumer.py:397`). A fresh deploy seeds `0`
    ⇒ immediately due ⇒ first cycle fires promptly; an existing row keeps its future due-time ⇒ a
    redeploy does **not** reset the clock (the bug).
  - Sleep the one-shot **startup jitter** (§2) once, before the first tick.
  - Loop over an awaitable seam `_next_sleep_seconds()` that: reads `blocked_until_ms`; if
    `now_ms < blocked_until_ms`, returns the remainder (**compute-sleep-until-due, no polling** — the
    current code's zero-DB-traffic sleep shape is preserved, avoiding the write-churn the adversary
    flagged); if due, checks `analysis.fundsignal.enabled` — **false ⇒ do not run and do not advance
    the schedule**, sleep one `run_interval_hours` and re-check (the manual trigger, §3, is the
    "enable then run now" path); true ⇒ run `run_once` under the retained `self._lock` (preserve the
    "previous cycle still running — skipping" log and the "never let one bad cycle kill the loop"
    try/except), then persist the outcome: on success `blocked_until_ms = now_ms +
    run_interval_hours*3600_000`; on caught exception `blocked_until_ms = now_ms +
    retry_seconds*1000` (§2) so a transient failure retries in minutes, not a day.
- **Idempotency unchanged.** `run_once`, `_finish`, and the `fundsignal_emitted` PK guard
  (`:172-183`, `_already_emitted` `:293-299`) are untouched — a same-UTC-day re-run still emits nothing
  and spends zero cache calls, so an eager boot run is safe by construction. The manual RPC still calls
  `run_once` directly (`servicer.py:2737-2742`) and **never reads or writes the schedule row**, so a
  `dry_run`/manual scan can never contaminate the scheduled cadence (the round-1 contamination
  objection is structurally closed).

### 2. Startup jitter + retry cadence (analysis) — two new config keys

- `analysis.fundsignal.startup_jitter_seconds` (int, default `30`), read via `get_int_present`
  (`app/config/watcher.py:103`) — `0` = disable jitter is legitimate, so the `get_int` zero-trap is
  wrong here. `await asyncio.sleep(random.uniform(0, jitter))` once at loop entry.
- `analysis.fundsignal.retry_seconds` (int, default `300`), read via `get_int_present`. The
  crash-retry cadence during an incident — an operator-tunable-without-redeploy value, consistent with
  every other `analysis.fundsignal.*` tunable (C-05). Both keys registered in the analysis `CLAUDE.md`
  config table and the `docs/patterns/config-governance.md` per-feature log.

### 3. Manual trigger — two consumer surfaces (C-14), no proto change

The `RunFundamentalsScan` RPC already exists (`analysis.proto:29-30`, req `force`/`dry_run`/`symbols`
`:502-506`, resp `:508-516`), admin-scoped via `_has_admin_scope` (`servicer.py:418-431`, ADMIN bit
`& 0x04`). Both surfaces wrap it — **no proto/servicer change**.

- **MCP agent tool** `run_fundamentals_scan` (`services/xstockstrat-agent/app/tools.py`, registered in
  `register_tools`, mirroring the admin-gated `trigger_backfill`), backed by a `client.py` wrapper
  mirroring `set_strategy_live` (`client.py:1224`, `ANALYSIS_ENDPOINT`, `_metadata`). It forwards the
  caller's **derived** scope via `_caller_access_scope(ctx, "run_fundamentals_scan")` (`tools.py:102`,
  feature-092 pattern) — **never fabricates the admin bit**; the backend gate rejects a non-admin with
  `PERMISSION_DENIED`.
- **UI control** in **/config-ui** (justified: the producer is operator/admin-facing and its
  `analysis.fundsignal.*` keys already live there; the trust boundary is cleaner than /insights'
  owner-scoped analysis surface). Register **only** `runFundamentalsScan` on `configUiBff.ts` via
  `forwardAdmin` (do **not** copy the whole `insightsBff.ts` AnalysisService block — connect-node
  leaves unlisted RPCs unimplemented, so no other analysis RPC is exposed); config-ui browser
  `analysisClient` uses `baseUrl:'/config-ui/api'`. An admin-only "Run fundamentals scan" card
  (force/dry-run/symbols → response summary), nav-reachable on a named config-ui page (C-10(a)
  reachability assertion). `forwardAdmin`→`requireAdminScope` (`bffShared.ts`) is the real gate;
  `hasAdminScope` (`src/lib/auth.ts`) only hides the control cosmetically.

## Rejected Alternatives

- **Full distributed lock (CAS claim + `LEASE_HOLD_MS` + polling), as first proposed** — rejected: at
  `instance_count:1` the mutual-exclusion machinery is unused (the in-process `_lock` already
  suffices), it *degrades* crash recovery (a hard crash wedges the schedule ~1h because the lease is
  taken before the run), and the poll loop turns a zero-DB sleep into perpetual write-churn.
- **`MAX(finished_at)` catch-up (round-1 Option B)** — rejected: `_finish` writes `finished_at`
  identically for a scheduled cycle, a manual scan, and a `dry_run` (`:136-138`), so the schedule is
  contaminated by non-scheduled runs, with no inline predicate to separate them.
- **No table at all — pure run-then-sleep (round-1 Option A)** — genuinely sufficient for the *bug*
  (the `fundsignal_emitted` PK already makes a restart re-run a zero-emit no-op; only the run *time*
  drifts toward restart time), but the operator explicitly asked for a durable schedule row with
  `process_name`/`blocked_until_ms`, which this design delivers crash-safely.
- **`RETRY_MS`/`LEASE_HOLD_MS` as code constants** — rejected for the retry cadence: promoted
  `retry_seconds` to a config key (operator-tunable during an incident, C-05 consistency). No
  lease-hold constant exists in the chosen design.
- **UI control in /insights** — rejected: /insights' AnalysisService surface is deliberately
  owner-scoped (`forward`, feature-133); an admin operational mutation belongs in /config-ui with the
  operator audience (accepting the one-method BFF registration there).

## Open Risks

- [ ] **Disabled-window re-check latency** — while `enabled=false` the loop sleeps one
  `run_interval_hours` without advancing the schedule, so flipping `enabled=true` may take up to an
  interval to auto-fire; the manual UI/MCP trigger is the immediate path. Confirm acceptable at
  `/sdd-spec` (target: scheduler step).
- [ ] **`_finish` → `RunFundamentalsScanResponse` field mapping** assumed clean (recon
  `analysis.proto:508-516`) — verify at `/sdd-spec` when wiring the MCP/UI response surface (target:
  MCP + UI steps).
- [ ] **Clock source** — schedule math uses `now_ms` computed in SQL (`extract(epoch from now())*1000`)
  or a single app-clock read consistently; do not mix. Verify at `/sdd-spec` (target: scheduler step).

## Constitution Rules Touched

- `C-05` — honored: two new keys follow `<service>.<category>.<key>`
  (`analysis.fundsignal.startup_jitter_seconds`, `analysis.fundsignal.retry_seconds`), registered in
  the analysis CLAUDE.md table + config-governance per-feature log.
- `C-07` / `F-01` — honored: `019_fundsignal_schedule` is a new numbered migration; no applied
  migration is edited.
- `C-08` / `P-06` — honored: each code-bearing step (scheduler, MCP tool, UI control, BFF gate) gets a
  paired red-before-green test.
- `C-13` — honored: analysis tests reuse `tests/test_fundsignal_loop.py` module helpers / add to
  `tests/conftest.py`; agent tests use the Python `conftest.py` home; UI tests use `e2e/fixtures/` +
  `INVENTORY.md` and vitest for the BFF gate.
- `C-14` — honored: both consumer surfaces (MCP tool, UI control) named and each earns its own
  implementation + test step; the UI card is nav-reachable (C-10(a)).
- `F-06` — honored: the schedule row reuses the loop's existing `self._db` pool; budget stays 2.
- `F-07` — honored: no config value hardcoded in source; jitter and retry are config keys, the schedule
  interval stays the existing `run_interval_hours` key.
- `P-03` — honored: the "disabled re-check latency" and response-mapping unknowns are logged as open
  risks with target steps, not guessed.

## Business Rules Touched (C-16)

None — `xstockstrat-analysis` has no durable `acceptance/*.feature` suite, so there is no existing
`@AC-*` guarantee to preserve/extend/change. This feature introduces net-new behavior; its own
`acceptance.feature` scenarios are the first, to be promoted into a new
`services/xstockstrat-analysis/acceptance/fundsignal.feature` at launch (C-16 write side).
