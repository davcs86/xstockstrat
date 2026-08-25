# Product Spec: fix-fundamentals-signal-producer

**Type**: bug
**Defect Report**: `docs/reports/2026-08-25-fundsignal-first-cycle-resets-on-redeploy-defect.md`
**Severity**: SEV-2
**Created**: 2026-08-25

---

## Problem Statement

**Observed:** The fundamentals signal producer (`xstockstrat-analysis`, feature 062 / 154) never
completes its first cycle in any environment that redeploys more often than
`analysis.fundsignal.run_interval_hours` (default 24h). No `fundamentals` (`derived`) signal source
is registered and no signals are emitted, even with `enabled=true`, a non-empty universe, and a
scoring formula configured. Live evidence: deployment `b14a43d7` active since 2026-08-25 05:06 UTC,
`list_signal_sources` shows no `fundamentals` source hours later, while config is fully correct.

**Expected:** With `analysis.fundsignal.enabled=true` and a non-empty resolved universe, the
producer runs its first cycle promptly after startup and registers the `fundamentals` source /
emits signals, regardless of how frequently the service redeploys.

**Root cause:** `run_forever` reads the interval then `await asyncio.sleep(...)` **before** the
first `run_once`, and the schedule is purely in-memory — the loop never consults the existing
`analysis.fundsignal_runs` timestamps at boot. Because `deploy-dev.yml` (`on: push: branches:
[main-dev]`) SHA-tags and redeploys the whole app on every push, each restart resets the full
sleep, so the first cycle is deferred by up to a full interval on every deploy and, under normal
CI/CD cadence, may never fire.

## Reproduction Steps

1. Deploy `xstockstrat-analysis` with `analysis.fundsignal.enabled=true` and a non-empty universe.
2. Before `run_interval_hours` (24h) elapses, push anything to `main-dev` (feature merge, promotion
   back-merge, or docs change).
3. `deploy-dev.yml` rebuilds SHA-tagged images and redeploys the whole app, restarting the analysis
   process.
4. The new process's `run_forever` sleeps a fresh 24h before its first `run_once`.
5. No fundsignal cycle ever completes → no `fundamentals` source registered, no signals emitted.

## Root Cause Hypothesis

- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:98-100` — `run_forever` sleeps
  before running; no read of last-run time (`analysis.fundsignal_runs` is written but never
  consulted at boot).
- `.github/workflows/deploy-dev.yml` — `on: push: branches: [main-dev]`, whole-app SHA-tagged
  redeploy on every push, so a push not touching analysis still restarts it.

## Affected Services

- `xstockstrat-analysis` (fundamentals signal producer + durable schedule + config keys)
- `xstockstrat-agent` (MCP tool wrapping the existing `RunFundamentalsScan` RPC)
- `xstockstrat-ui` (config-ui admin trigger control)

## Consumer Surface(s) (C-14)

- **MCP agent tool** `run_fundamentals_scan` (`xstockstrat-agent`) — admin-scoped manual trigger.
- **UI control** — an admin-only "Run fundamentals scan" card in the **/config-ui** segment.
- The scheduled producer itself remains internal/platform (background loop, no direct surface).

## Fix Scope (operator-expanded 2026-08-25 — see context.md steer; was a minimal bug fix)

- [x] No proto changes — `RunFundamentalsScan` (req `force`/`dry_run`/`symbols`, resp fields) already
  exists; both surfaces wrap it.
- [ ] **One new database migration** — `019_fundsignal_schedule` creates
  `analysis.fundsignal_schedule (job_name PK, blocked_until_ms, process_name, updated_at)`, the durable
  crash-safe schedule row. Reuses the existing analysis pool (budget stays 2).
- [ ] **Two new config keys** — `analysis.fundsignal.startup_jitter_seconds` (default 30) and
  `analysis.fundsignal.retry_seconds` (default 300), both `get_int_present`. (The staging stopgap that
  changed `run_interval_hours`'s *value* is separate and reverts to 24 after launch.)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior (first
cycle deferred a full interval on boot) and pass after the fix (first cycle fires promptly / catches
up on boot), per Constitution **C-15**. Plus: existing analysis tests pass; the producer smoke-tested
on dev (a fresh deploy emits within the expected window).

## Proposed Fix Directions (for /sdd-design)

1. **Run-then-sleep** — invoke `run_once` at loop entry (guarded by `enabled`), then sleep the
   interval. Simplest; fires ~immediately on boot. Consider a small startup jitter so simultaneous
   restarts don't stampede FMP/marketdata.
2. **Persisted-schedule catch-up** — at boot read the most recent
   `analysis.fundsignal_runs.finished_at`; if `now - last_run >= interval` run immediately, else
   sleep the remainder. Survives restarts without re-running a fresh cycle; reuses the existing runs
   table (no migration).
3. Keep the same-day idempotency guard (`analysis.fundsignal_emitted` PK) so any boot-time run that
   lands the same day as a prior run emits nothing and spends zero cache calls — the safety net that
   makes an eager first run cheap.

## Out of Scope

- Refactoring the universe-resolution / FMP-gating logic (feature 154) unrelated to boot timing.
- Changing the CI/CD deploy trigger (`deploy-dev.yml`) — the fix makes the producer robust to
  restarts rather than reducing deploy frequency.
- Reverting the staging stopgap `analysis.fundsignal.run_interval_hours=1` back to `24` — that is a
  config action to perform once the fix lands, tracked in context.md, not a code change here.
