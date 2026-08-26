# Defect: fundamentals signal producer's first cycle never fires under CI/CD (sleep-before-first-run resets on every redeploy)

**Date**: 2026-08-25
**Reporter**: davcs86@gmail.com (via Claude Code)
**Severity**: SEV-2
**Impact type**: behavior-correctness
**Environment**: dev / staging (and production under promotion-driven redeploys)
**Affected service(s)**: `xstockstrat-analysis` (fundamentals signal producer, feature 062 / 154)
**Config-only fix possible**: no

> Severity rationale: the fundamentals signal producer effectively **never runs** in any environment that redeploys more often than `run_interval_hours` (24h). The capability ships but produces no signals. Not a trading-safety issue, so not SEV-1.

## Summary

The fundamentals signal producer schedules its cycles with an **in-process `asyncio.sleep` placed *before* the first run**, and keeps **no persisted "last run" schedule**. Every process start therefore begins a fresh full-interval sleep (default 24h) before its *first* cycle. Because the platform's CI/CD redeploys `xstockstrat-analysis` on **every** push to `main-dev` (SHA-tagged, whole-app deploy), any push within a 24h window restarts the process and resets the timer — so the first cycle can be deferred indefinitely and, in practice, may never fire.

## Reproduction

1. Deploy `xstockstrat-analysis` with `analysis.fundsignal.enabled=true` and a non-empty universe.
2. Before `run_interval_hours` (24h) elapses, push anything to `main-dev` (a feature merge, a promotion back-merge, a docs change).
3. `deploy-dev.yml` (`on: push: branches: [main-dev]`) rebuilds SHA-tagged images and redeploys the whole app, restarting the analysis process.
4. The new process's `run_forever` sleeps a fresh 24h before its first `run_once`.
5. Result: no fundsignal cycle ever completes → the `fundamentals` (`derived`) signal source is never registered and no signals are emitted. Observed live: deployment `b14a43d7` active since 2026-08-25 05:06 UTC, `list_signal_sources` shows no `fundamentals` source hours later; config is correct (`enabled=true`, `universe_source=watchlists`, watchlists non-empty, composite formula set).

## Root cause (grounded)

- `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:98-100` — `run_forever` reads the interval then **sleeps before running**:
  ```python
  while True:
      interval_hours = self._cfg.get_int("analysis.fundsignal.run_interval_hours", default=24)
      await asyncio.sleep(max(1, interval_hours) * 3600)   # ← sleeps FIRST, then run_once
      ...
      await self.run_once(...)
  ```
  The schedule is purely in-memory (`asyncio.sleep`); there is no read of the last-run time. `analysis.fundsignal_runs` already records per-cycle timestamps but the loop never consults them at boot.
- `.github/workflows/deploy-dev.yml` — `on: push: branches: [main-dev]`; images are commit-SHA-tagged and the whole app redeploys (all services observed on the same tag `f56a24c5`), so a push that doesn't touch analysis still restarts it.

## Impact

- The fundamentals signal producer (feature 062, universe wired by feature 154) does not reliably emit in dev/staging, and would not in production either, given promotion-driven redeploys. The feature is effectively inert under normal CI/CD cadence.

## Proposed fix (for design)

Make the first cycle fire promptly and survive restarts. Options to weigh in `/sdd-design`:
1. **Run-then-sleep** — invoke `run_once` at loop entry (guarded by `enabled`), then sleep the interval. Simplest; fires ~immediately on boot. (Consider a small startup jitter/stagger so simultaneous restarts don't stampede FMP/marketdata.)
2. **Persisted-schedule catch-up** — at boot, read the most recent `analysis.fundsignal_runs.finished_at`; if `now - last_run >= interval`, run immediately, else sleep the remainder. Survives restarts without re-running an already-fresh cycle. Reuses the existing runs table (no new state).
3. Keep the same-day idempotency guard (`analysis.fundsignal_emitted` PK `(symbol, source, as_of_date)`) so any "run on boot" that lands the same day as a prior run emits nothing new and spends zero cache calls — the safety net that makes an eager first run cheap.

## Stopgap already applied (not the fix)

`analysis.fundsignal.run_interval_hours` was set to `1` in **staging** (2026-08-25, config version `1787692710368`) so each fresh process fires within ~1h of startup despite deploy churn. This is a mitigation, not a resolution — the durable fix is the boot-timing change above. The stopgap should be reverted to `24` once the fix lands.
